# Spec — Backend Efficiency Overhaul

**Status:** Draft for review
**Date:** 2026-06-14
**Scope guardrail:** Argus is built **only** for the PRD core workflows (§4.3): **Create Job**, **Execute Job** (cron → executor → Graph → report-engine → dispatch → log), **Manual Run ("Run Now")**, and **Mailbox Setup**. This spec makes those existing flows faster and more correct. It adds **no new product features**. Every change must preserve current behavior and pass the existing 92 unit + 8 E2E tests.

---

## 1. Why

A live read of the backend surfaced concrete inefficiencies and one correctness bug in the core flows. None are cosmetic; each maps to a PRD requirement that is currently under-delivered.

| # | Finding | Location | PRD ref |
|---|---------|----------|---------|
| F1 | **Scheduler runs a stale job snapshot.** `cron.schedule(expr, () => runJob(job))` captures `job` at boot. Jobs created/edited/deleted after start are never picked up (run old params, keep firing when deleted, never start when new) until full restart. | `src/services/scheduler.ts:37` | §1 "edit jobs without redeployment", §4.3 |
| F2 | **Graph reports read only the first page.** `fetch()` returns `page.value` and ignores `@odata.nextLink` → silent truncation on large tenants. | `src/services/reports/*.ts`, `graph/client.ts` | §4.2 "pagination, delta queries" |
| F3 | **No `$select`.** Reports pull full Graph objects (heavy payloads, slower, more throttling). | `src/services/reports/*.ts` | §4.2, NFR perf |
| F4 | **New Graph `Client` per request.** `createGraphClient()` runs on every `transport.get()` — rebuilds the middleware chain each call. | `graph/client.ts:33` | NFR-6 reuse |
| F5 | **No DB indexes on hot FK columns.** `executions.jobId`, `logs.executionId`, `baselines(jobId, metric)` are unindexed → full table scans on every `forJob` / `forExecution` / baseline `history`. | `src/db/schema.ts` | NFR perf |
| F6 | **Logs inserted one row at a time.** Executor calls `logsDao.append()` ~8–10× per run = 8–10 separate write transactions. | `executor.ts`, `dao/executions.ts` | NFR perf |
| F7 | **Missing SQLite perf PRAGMAs.** Only WAL + FK + busy_timeout set. No `synchronous=NORMAL`, `cache_size`, `temp_store=MEMORY`, `mmap_size`, `wal_autocheckpoint`. | `src/db/client.ts:48` | §4.2 WAL, NFR perf |
| F8 | **`baselinesDao.prune(90)` on every run** = full scan each execution. | `executor.ts:116` | NFR perf |
| F9 | **No concurrency control.** When N jobs share a fire time (e.g. all "daily" at 08:00) they all hit Graph at once → throttling. Same job can also overlap itself on a long run. | `scheduler.ts` | §4.2 throttling |
| F10 | **`settingsDao.get()` called 2–3× per run** (re-query each time). | `executor.ts:119,121` | minor |

Research basis (authoritative external sources): SQLite WAL tuning (synchronous=NORMAL is corruption-safe in WAL, temp_store=MEMORY, mmap, cache_size); Microsoft Graph best practices ($select, follow @odata.nextLink as opaque URL, $batch ≤20 requests, honor Retry-After on 429). See Sources at the end.

---

## 2. Out of scope (explicit)

- No new reports, UI, or endpoints.
- **Delta queries (full implementation)** — deferred. Delta pairs with webhooks/change-notifications, which is a larger design; flagged for the discussion, not built here. Pagination (F2) is the immediate correctness fix.
- **$batch** — implement the transport capability only if an existing report needs >1 Graph call; otherwise add the seam but leave reports unchanged.
- No schema changes beyond adding indexes (no column adds/renames).
- No swap of node-cron, Drizzle, or bun:sqlite.

---

## 3. Acceptance criteria

### AC-DB — Database layer
- **AC-DB1** `getDb()` sets, in addition to current pragmas: `synchronous = NORMAL`, `temp_store = MEMORY`, `cache_size = -16000` (≈16 MiB), `mmap_size = 268435456` (256 MiB), `wal_autocheckpoint = 1000`. WAL, `foreign_keys=ON`, `busy_timeout=5000` remain. A unit test asserts each pragma's runtime value via `getRawDb()`.
- **AC-DB2** Indexes exist (created by a new migration) on: `executions(jobId)`, `executions(startedAt)`, `logs(executionId)`, `logs(timestamp)`, `baselines(jobId, metric, recordedAt)`. A test confirms `EXPLAIN QUERY PLAN` for `executionsDao.forJob` and `logsDao.forExecution` uses an index (no `SCAN TABLE`).
- **AC-DB3** A single execution's logs are written in **one** transaction/multi-row insert, not one-per-message. Behavior (log order, contents) is unchanged; a test asserts the same log rows are persisted as today.
- **AC-DB4** `PRAGMA optimize` runs on `closeDb()` (and is safe to call when no DB is open).

### AC-GRAPH — Graph connection layer
- **AC-G1** The live transport reuses a **single** `Client` instance across requests (lazily created, rebuilt only after credential change / `clearTokenCache`). A test asserts the factory is invoked once across N `get()` calls.
- **AC-G2** `transport.get()` **follows `@odata.nextLink`** until exhausted, concatenating `value` arrays, with a safety cap (default 50 pages) and a logged warning if the cap is hit. Latency is the sum across pages. Existing single-page report tests still pass (fake transport returns no nextLink).
- **AC-G3** Report definitions pass `$select` for the fields they actually use (sign-in-anomalies, etc.). Output of `summarize()` is byte-for-byte unchanged for the same input rows (tests use existing fixtures).
- **AC-G4** A Graph `429`/`503` with a `Retry-After` header is honored by `withRetry` (extend the existing `retryAfterMs` extraction from the token path to the Graph path). Test: a 429 with `Retry-After: 2` retries after ~2 s (injected sleep).
- **AC-G5** (Capability seam, no behavior change) `GraphTransport` gains an optional `batch()` method on the live transport implementing JSON `$batch` with ≤20 requests/chunk. No report is required to use it yet; covered by a focused unit test.

### AC-SCHED — Scheduler & execution layer
- **AC-S1** At fire time the scheduled callback **re-fetches the job by id** (`jobsDao.findById`) and runs the current row; if the job is missing or inactive it is skipped and its task removed. Test: edit a job's params after scheduling → next fire uses new params.
- **AC-S2** Job **create/update/delete via the API reschedules** the scheduler: `addOrReplaceJob(id)` and `removeJob(id)` are called from the jobs route handlers. Tests: creating a job adds a task; deleting removes it; editing the schedule replaces the task with the new cron.
- **AC-S3** A **concurrency cap** limits simultaneous `runJob` executions (default 4, configurable) via a small in-process queue/semaphore; excess runs queue rather than fire in parallel. A job already running is **not** started again concurrently (per-job lock); the overlap is logged and skipped. Test: 10 jobs firing at once never exceed 4 in flight.
- **AC-S4** `settingsDao.get()` is read **once** per `runJob` and threaded through (no functional change). `baselinesDao.prune(90)` no longer runs every execution — it runs at most once/day (timestamp-gated) or on a daily scheduler tick. Test: two back-to-back runs trigger at most one prune.

### AC-REG — Regression gates (apply to all of the above)
- **AC-R1** `bunx tsc --noEmit` = 0 errors.
- **AC-R2** `bun test tests/` — all existing tests pass; new tests added for each AC above; coverage stays ≥ 80%.
- **AC-R3** `bun run build` succeeds (webpack pin retained).
- **AC-R4** `E2E_BASE_URL` Playwright suite (8 journeys) passes against a fresh Docker container.
- **AC-R5** No new secrets, no plaintext credential logging; vault/crypto untouched.

---

## 4. Non-goals / risks

- **Risk:** rescheduling on every edit could thrash node-cron. Mitigation: replace only the affected task, not the whole set.
- **Risk:** pagination cap hiding truncation. Mitigation: warn-level log + execution note when cap hit.
- **Risk:** index migration on an existing DB. Mitigation: `CREATE INDEX IF NOT EXISTS` via a numbered Drizzle migration; idempotent.
- **Decision needed (discussion):** whether to invest in **delta query + change notifications** now (F2 long-term) or ship pagination first and revisit. Recommend: pagination now, delta as a follow-up spec.

---

## Sources
- [SQLite PRAGMA reference](https://sqlite.org/pragma.html) · [phiresky — SQLite performance tuning](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/) · [Database School — recommended PRAGMAs](https://databaseschool.com/articles/sqlite-recommended-pragmas) · [SQLite for production](https://oneuptime.com/blog/post/2026-02-02-sqlite-production-setup/view)
- [MS Graph — best practices](https://learn.microsoft.com/en-us/graph/best-practices-concept) · [MS Graph — paging](https://learn.microsoft.com/en-us/graph/paging) · [MS Graph — JSON batching](https://scomnewbie.github.io/posts/usegraphapibatching/) · [Avoid Graph throttling](https://dev.to/playfulprogramming/how-to-avoid-microsoft-graph-api-throttling-and-optimize-network-traffic-5c2g)
