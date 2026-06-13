# Argus — Technical Specification

> Companion to [`prd.md`](./prd.md). The PRD defines *what* and *why*; this spec
> defines *how* it is built and *how we know it works* (acceptance criteria).
> Phased delivery is in [`plan.md`](./plan.md).

**Status:** Living document · **Last updated:** 2026-06-13

---

## 1. Overview

Argus is a single-container Next.js (App Router) application running on Bun. It
schedules Microsoft Graph queries, renders HTML reports, evaluates conditional/
baseline rules, and emails results from a least-privilege shared mailbox — or, when
suppressed, posts to configured webhooks. State lives in one SQLite file via Drizzle.

The application has three runtime surfaces sharing one process:

1. **Web/API** — Next.js routes (UI + REST under `/api/*`).
2. **Scheduler** — an in-process `node-cron` loop that polls active jobs and runs the
   execution engine. Started once on server boot (guarded against HMR double-start).
3. **Background services** — vault, Graph client, report engine, baseline, dispatchers.

## 2. Goals (engineering)

- G1. One required secret (`ARGUS_MASTER_KEY`); all other credentials are UI-entered and encrypted at rest.
- G2. Deterministic, testable core services (vault, baseline math, condition evaluation, template rendering) with no network dependency in unit tests.
- G3. Every external call (Graph, SMTP/sendMail, webhooks) wrapped with retry + exponential backoff and structured error capture.
- G4. Immutable execution + log history; jobs editable without losing history.
- G5. `docker compose up` boots a working instance with a persisted SQLite volume.

## 3. Functional requirements

Inherited verbatim from PRD §4 and §10. This spec does not restate them; it adds the
cross-cutting strategies the PRD leaves open (§7–§9 below). Build order in `plan.md`.

## 4. Non-functional requirements

From PRD §5, made testable:

| ID | Requirement | Acceptance check |
|----|-------------|------------------|
| NFR-1 | Dashboard < 2s load | Lighthouse/`curl -w` TTFB on `/dashboard` with 50 seeded jobs < 2s locally |
| NFR-2 | Report gen < 5s for <10k records | Bench `renderReport()` with 10k synthetic rows < 5s |
| NFR-3 | Least-privilege only | No `Mail.Send` granted broadly; RBAC scope present; audited by `/api/mailbox/validate` |
| NFR-4 | Secrets encrypted at rest | No plaintext secret in DB; vault rows have iv+tag; master key never logged |
| NFR-5 | Retries 3× w/ backoff | Unit test asserts 3 attempts with increasing delay before failure |
| NFR-6 | SQLite WAL | `PRAGMA journal_mode` returns `wal` on boot |
| NFR-7 | i18n EN + HE RTL | `dir` flips to `rtl` for `he`; date formatting localized |
| NFR-8 | Single env var deploy | Container boots with only `ARGUS_MASTER_KEY` set |

## 5. Tech stack

Per PRD §6. Pinned in `package.json`: Next 14.2.18, React 18.3, Drizzle 0.36.4 (`drizzle-orm/bun-sqlite`), Tailwind 3.4, zod 3.23, node-cron 3, `@microsoft/microsoft-graph-client` 3. Tests use the built-in `bun test` runner.

## 6. Data model

Per PRD §7 (9 tables: jobs, executions, logs, baselines, templates, vault, integrations, webhooks, settings). Implemented in `src/db/schema.ts`. Conventions:

- Primary keys are app-generated UUIDv4 strings (`crypto.randomUUID()`).
- JSON columns stored as `text` with Drizzle `{ mode: "json" }` typing.
- Timestamps stored as ISO-8601 `text` (UTC). `createdAt`/`updatedAt` default to `now`.
- `executions` and `logs` are append-only (no UPDATE/DELETE in normal flow → G4).
- `settings` is a singleton row (id = `"singleton"`).
- FKs declared with `references()`; cascade delete from `jobs` → `executions` → `logs`.

## 7. Error handling strategy

A single typed error taxonomy in `src/lib/errors.ts`:

| Class | Meaning | HTTP | Retryable |
|-------|---------|------|-----------|
| `ValidationError` | Bad input at a boundary (zod) | 400 | no |
| `VaultError` | Missing master key / decrypt failure | 500 | no |
| `GraphAuthError` | Token acquisition failed | 502 | yes |
| `GraphApiError` | Graph call failed (carries status, requestId) | 502 | yes if 429/5xx |
| `DispatchError` | Email/webhook delivery failed | 502 | yes |
| `NotFoundError` | Entity not found | 404 | no |

Rules:

- **Boundaries validate with zod**; failures become `ValidationError` → 400 with field detail.
- **`withRetry(fn, { attempts: 3, baseMs: 500 })`** wraps every network call. Backoff = `baseMs * 2^(n-1)` (+ jitter). Honors `Retry-After` on Graph 429.
- **Graceful degradation:** a failed *non-critical* step (e.g. baseline computation, one webhook of several) is logged at `warn`, the execution continues, and the job ends `warning` not `failed`. A failed *critical* step (auth, render, the sole delivery) ends the execution `failed` with the stack captured in `executions.errorMessage` + a `logs` row.
- **API responses** follow `{ success, data?, error?, meta? }`. Errors never leak stack traces or secrets to the client; full detail goes to the execution log.
- **Read-only mode:** if mailbox permission validation fails, `settings.permissionStatus = "missing"`; jobs still run and render but email steps are skipped + logged.

## 8. API design

Per PRD §8 (37 endpoints). Conventions: REST under `/api`, zod-validated bodies, the
standard response envelope, and a thin route handler that delegates to a service. No
business logic in route handlers.

## 9. Test strategy

Target ≥ 80% coverage on `src/services` and `src/lib` (the deterministic core).

| Layer | Tool | Scope |
|-------|------|-------|
| Unit | `bun test` | vault roundtrip + tamper, baseline stats, condition evaluation, template rendering, `withRetry` backoff, cron-expression preview |
| Integration | `bun test` | DB DAOs against a temp SQLite file; API route handlers with mocked services |
| E2E | Playwright (later phase) | first-setup → create job → run now → view log |

Rules: no live network in unit/integration tests — Graph, sendMail, and webhooks are
mocked. Each test gets an isolated temp DB (`ARGUS_DB_PATH` in a tmp dir). `mock.module()`
is called before importing the module under test (Bun static-import caveat).

## 10. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R1 | Graph permission/consent friction blocks real email | High | High | Read-only mode + explicit remediation UI; mock transport for dev/test |
| R2 | `bun:sqlite` + Next standalone bundling issues | Med | Med | `serverComponentsExternalPackages`; DB access server-only |
| R3 | Cron double-start under HMR / multi-worker | Med | Med | Global singleton guard; document single-instance deployment |
| R4 | Lost `ARGUS_MASTER_KEY` → unrecoverable vault | Low | High | Loud UI warning; key never persisted; documented backup guidance |
| R5 | Scope creep (5-week PRD) | High | Med | Phased plan; MVP (Milestone 1) first; resume-from-last-phase |
| R6 | Outlook HTML email rendering quirks | Med | Low | Inline-CSS templates; table-based layout; preview before send |

## 11. Acceptance criteria (MVP / Milestone 1)

- AC-1 `bun test` green; core services ≥ 80% covered.
- AC-2 `GET /api/health` returns DB status, WAL mode, vault-key presence.
- AC-3 Vault encrypts/decrypts roundtrip; tampered ciphertext throws `VaultError`.
- AC-4 Schema applies via `bun run db:push`; all 9 tables present with FKs.
- AC-5 Graph auth service acquires a token via client-credentials (mocked in tests) with 3× retry.
- AC-6 A job can be created, run on demand, produce an `execution` + `logs`, and render report HTML.
- AC-7 `docker compose up` boots; health check passes with only `ARGUS_MASTER_KEY` set.

## 12. Ambiguities / assumptions

Resolved by assumption (documented to LTM); revisit if wrong:

- A1. **Web auth:** PRD specifies no app-login for the Argus UI itself. Assumed: single-tenant, network-isolated deployment; no UI authentication in MVP. *Flagged as a real gap for production.*
- A2. **Mailbox provisioning** (PRD §4 wizard) requires elevated Graph + Exchange PowerShell that cannot be exercised without a live tenant. MVP implements the API/UI flow + manual-command fallback; live automation is stubbed behind the transport interface.
- A3. **node-cron vs. durable scheduling:** in-process cron is acceptable for single-instance; clustered scheduling is out of scope.
