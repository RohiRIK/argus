# Plan — Backend Efficiency Overhaul

Pairs with `spec-backend-efficiency.md`. Ordered by **risk-adjusted value**: low-risk/high-value DB wins first, the correctness-critical scheduler fix next, Graph layer last (most surface). Each task is independently committable and gated by tests. Nothing here adds product features.

**Sequencing rule:** one phase per commit; `tsc` + `bun test tests/` green before moving on. Final phase re-runs build + Docker E2E.

---

## Phase 1 — Database fast wins (low risk)
*Maps to AC-DB1, AC-DB2, AC-DB4, AC-DB3.*

1. **PRAGMAs** (`src/db/client.ts`): add `synchronous=NORMAL`, `temp_store=MEMORY`, `cache_size=-16000`, `mmap_size=268435456`, `wal_autocheckpoint=1000`. Add `PRAGMA optimize` in `closeDb()`. → AC-DB1, AC-DB4
2. **Index migration**: `bun run db:generate` after adding `index()` definitions to `src/db/schema.ts` for executions(jobId), executions(startedAt), logs(executionId), logs(timestamp), baselines(jobId,metric,recordedAt). Commit the generated `000X_*.sql`. → AC-DB2
3. **Batched logs**: introduce a per-execution log buffer. Two viable shapes — **decide in discussion**:
   - (a) `logsDao.appendMany(rows[])` + executor collects messages and flushes in `finalize()` (one insert). Simple; logs appear only at end.
   - (b) keep streaming `append` but wrap the whole `runJob` in a single `db.transaction()` so the N inserts commit once. Logs still ordered; least code churn. **(recommended)**
   → AC-DB3
4. Tests: pragma assertions via `getRawDb()`, `EXPLAIN QUERY PLAN` index check, log-parity test.

**Gate:** tsc 0, unit green.

---

## Phase 2 — Scheduler correctness + concurrency (correctness-critical)
*Maps to AC-S1, AC-S2, AC-S3, AC-S4. Fixes F1 (the real bug).*

1. **Fresh job at fire time** (`scheduler.ts`): callback does `const fresh = jobsDao.findById(id); if (!fresh || !fresh.active) { removeJob(id); return; } runJob(fresh)`. → AC-S1
2. **Mutation hooks**: export `addOrReplaceJob(id)` / `removeJob(id)`; call from `POST /api/jobs`, `PATCH/DELETE /api/jobs/[id]`. Replace only the affected task. → AC-S2
3. **Concurrency**: tiny semaphore (`maxConcurrent=4`) + per-job in-flight `Set` to prevent overlap; queue excess. Pure in-process, no deps. → AC-S3
4. **Executor tidy**: read `settingsDao.get()` once, thread through; gate `baselinesDao.prune(90)` to ≤1/day (store `lastPrunedAt` in settings or a module timestamp). → AC-S4
5. Tests: stale-edit, add/remove on CRUD, concurrency cap, single-prune.

**Gate:** tsc 0, unit green.

---

## Phase 3 — Graph connection efficiency (largest surface)
*Maps to AC-G1, AC-G2, AC-G3, AC-G4, AC-G5.*

1. **Client singleton** (`graph/client.ts`): module-level lazy `Client`, reset by `clearTokenCache()` / credential change. → AC-G1
2. **Pagination**: `transport.get()` loops on `@odata.nextLink` (opaque URL), concatenates `value`, caps at 50 pages with a warn log, sums latency. → AC-G2
3. **`$select`** per report (`reports/*.ts`): add the minimal field list each `summarize()` consumes; verify summarize output unchanged against fixtures. → AC-G3
4. **Retry-After on Graph**: extract `retry-after` from 429/503 onto `GraphApiError.retryAfterMs` (mirror the token path); `withRetry` already honors it. → AC-G4
5. **`$batch` seam**: add `transport.batch(requests[])` chunking ≤20; unit-test only (no report wired yet). → AC-G5
6. Tests: factory-once, multi-page concat + cap, $select shape, 429 Retry-After timing, batch chunking.

**Gate:** tsc 0, unit green.

---

## Phase 4 — Verify & ship
*Maps to AC-R1..R5.*

1. `bunx tsc --noEmit` → 0.
2. `bun test tests/` → all green, coverage ≥80%.
3. `bun run build` (webpack) → success.
4. Docker: rebuild image, `compose up`, `E2E_BASE_URL=http://localhost:8100 bunx playwright test` → 8/8.
5. `/simplify` pass on changed files; `code-reviewer` + `security-reviewer` on the diff.
6. Log outcome to LTM; tear down container; final report.

---

## Open questions for the discussion (before building)
1. **Log batching**: shape (a) flush-at-end vs (b) single transaction streaming — recommend (b).
2. **Delta queries**: build now or defer to a follow-up spec? — recommend defer; ship pagination first.
3. **Concurrency cap value**: 4 a sane default for a single-container self-host? Make it env-configurable (`ARGUS_MAX_CONCURRENT_RUNS`)?
4. **$batch**: add the seam now (AC-G5) or drop until a multi-call report exists? — low cost to add the seam.
5. Anything in the PRD core flows you consider sacred / off-limits to touch?
