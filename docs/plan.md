# Argus — Phased Implementation Plan

> Derived from [`spec.md`](./spec.md) and [`prd.md`](./prd.md). Each phase ends with
> `/simplify` + `/verify` + a commit, and is logged to LTM. Resume from the last
> completed phase. Dependencies are linear (no cycles) — each phase builds on the prior.

**Legend:** ✅ done · 🔄 in progress · ⬜ pending

---

## Phase 0 — Setup ✅
Repo init, scaffold, spec, plan. (Commits `58cb25d`, `b18f4b8`.)

## Phase 1 — Persistence layer (`src/db`) 🔄
**Depends on:** Phase 0
**Tasks**
1. `schema.ts` — all 9 tables (jobs, executions, logs, baselines, templates, vault, integrations, webhooks, settings) with FKs + JSON columns.
2. `client.ts` — `bun:sqlite` connection, `PRAGMA journal_mode=WAL`, Drizzle `drizzle-orm/bun-sqlite` binding, singleton.
3. `migrate.ts` + `drizzle-kit` generate/push wiring; auto-create `data/` dir.
4. DAOs per entity (`src/db/dao/*.ts`) with the repository interface (findAll/findById/create/update/delete).
**Deliverables:** schema, migrations, DAOs.
**Verification:** `bun run db:push` creates all tables; `PRAGMA journal_mode` = `wal`; DAO integration tests green against a temp DB.
**Rollback:** delete `data/*.db`; `git revert` the phase commit.

## Phase 2 — Vault service (`src/services/vault`)
**Depends on:** Phase 1
**Tasks**
1. `crypto.ts` — AES-256-GCM encrypt/decrypt; key from `ARGUS_MASTER_KEY`; per-value random IV; auth tag stored separately.
2. `vault.ts` — get/set/list (masked) over the `vault` table; never logs plaintext.
3. Master-key-missing path → `VaultError` + UI "generate key" state hook.
**Deliverables:** vault service + `src/lib/errors.ts`.
**Verification:** roundtrip test; tampered ciphertext/tag throws; AC-3, AC-4.
**Rollback:** `git revert`; vault rows are self-contained (re-encrypt on next set).

## Phase 3 — Health + Graph auth (`src/services/graph`)
**Depends on:** Phase 2
**Tasks**
1. `withRetry()` in `src/lib/retry.ts` (exp backoff + jitter, `Retry-After` aware).
2. `auth.ts` — client-credentials token acquisition (reads tenant/client/secret from vault), token cache with expiry.
3. `client.ts` — Graph client factory using a custom auth provider + `withRetry`; pluggable transport for tests.
4. `GET /api/health` — DB ping, WAL check, vault-key presence, version.
**Deliverables:** retry util, Graph auth/client, health route.
**Verification:** AC-2, AC-5; retry test asserts 3 attempts w/ increasing delay; token cache reused within expiry.
**Rollback:** `git revert`.

## Phase 4 — Execution engine + report engine + first report
**Depends on:** Phase 3
**Tasks**
1. `report-engine.ts` — template render (`{{var}}` injection) + baseline-delta variables.
2. `baseline.ts` — store metrics, compute avg/stddev, anomaly (>2σ), trend %.
3. `conditions.ts` — evaluate the 5 conditional-send rules → send/suppress + reason.
4. `executor.ts` — run a job: fetch (Graph) → evaluate → render → deliver/suppress → persist execution + logs + baseline.
5. `reports/sign-in-anomalies.ts` — first catalog report (`/auditLogs/signIns`).
6. `dispatchers/email.ts` (Graph `sendMail`) + `dispatchers/webhook.ts` (retry per URL), pluggable transports.
**Deliverables:** deterministic core services + one working report end-to-end (mocked transport).
**Verification:** AC-6; unit tests for baseline math, condition eval, render; executor integration test with mocked Graph + transport.
**Rollback:** `git revert`.

## Phase 5 — Cron scheduler
**Depends on:** Phase 4
**Tasks**
1. `scheduler.ts` — node-cron loop; resolve preset → cron; HMR-safe global singleton guard.
2. Boot hook (instrumentation / route) to start scheduler once.
3. Cron-preview util (next 5 runs) for the UI.
**Deliverables:** scheduler + preview util.
**Verification:** preview util test; scheduler starts once (guard test); manual run still bypasses schedule.
**Rollback:** disable scheduler boot; `git revert`.

## Phase 6 — REST API + jobs CRUD
**Depends on:** Phase 4 (uses executor), Phase 1 (DAOs)
**Tasks**
1. Response envelope helper + zod request schemas.
2. `/api/jobs` (GET/POST), `/api/jobs/:id` (GET/PUT/DELETE), `/api/jobs/:id/run`, `/api/jobs/:id/executions`.
3. `/api/executions/:id` (+ `/preview`, `/baseline`), `/api/logs`, `/api/catalog`.
4. `/api/vault` (GET masked / PUT), `/api/vault/test`, `/api/settings`.
**Deliverables:** the MVP API surface (subset of PRD §8; remainder in later milestones).
**Verification:** route-handler tests with mocked services; envelope shape; validation 400s.
**Rollback:** `git revert`.

## Phase 7 — UI (dashboard, settings, integrations)
**Depends on:** Phase 6
**Tasks**
1. App shell + nav + dark/light toggle + `dir` switch (EN/HE).
2. Jenkins-style dashboard: job cards with scannable status, quick actions.
3. Settings + encrypted-vault form (masked secret, show/hide).
4. Integrations hub (M365 card + "coming soon" placeholders); health-check button.
5. Logs viewer (console-style monospace).
**Deliverables:** functional MVP UI wired to the API.
**Verification:** NFR-1 (dashboard < 2s w/ 50 seeded jobs); renders in both themes; RTL flips.
**Rollback:** `git revert`.

## Phase 8 — Docker + final verification
**Depends on:** all
**Tasks**
1. `Dockerfile` (multi-stage, standalone output) + `docker-compose.yml` (SQLite volume, `ARGUS_MASTER_KEY`).
2. Full test sweep; security smoke (no plaintext secrets, no broad scopes); perf smoke.
3. Docs verify; final LTM summary.
**Deliverables:** deployable image + green verification.
**Verification:** AC-7; `bun test` green; `docker compose up` health passes.
**Rollback:** `git revert`.

---

## Post-MVP (Milestones V1.1–V1.3, PRD §14)
Full 12-report catalog · template editor · 90-day baseline auto-prune · permission
remediation UI · full RTL Hebrew · advanced scheduling · bulk ops · multi-tenant ·
email-quality validation · webhook integration framework. Out of scope for this run.

## Dependency graph (acyclic)
`P0 → P1 → P2 → P3 → P4 → {P5, P6} → P7 → P8`. No cycles. P5 and P6 both depend on P4 and can proceed independently after it.
