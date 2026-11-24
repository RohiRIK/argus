# Argus — Project Instructions

## Tech Stack
- **Runtime & pkg manager:** Bun 1.3 (`bun` only — never npm/yarn/pnpm)
- **Framework:** Next.js 16 (App Router, React 19) built with `--webpack` (not Turbopack)
- **Language:** TypeScript 5.6 (`strict: true`, `@/*` → `src/*`)
- **Database:** SQLite (WAL mode, FK enforcement) via `bun:sqlite` + Drizzle ORM 0.36 (`drizzle-kit` 0.28)
- **Integrations & jobs:** `@microsoft/microsoft-graph-client`, `node-cron` + in-process run queue, Zod 3.25
- **Styling:** Tailwind CSS 3.4 + HSL CSS variables (`Operator` theme, dark/light + palette switcher); flat theme-aware SVGs in `src/components/icons.tsx` (no icon libraries)

## Build & Run
- Dev: `bun run dev` (Next dev `--webpack`, port `8100`)
- Build / Start: `bun run build` / `bun run start` (port `8100`)
- Typecheck / Lint: `bun run typecheck` (`tsc --noEmit`) / `bun run lint` (`eslint src`)
- DB: `bun run db:generate` (new migration), `bun run db:migrate`, `bun run db:seed` (idempotent)
- Docker: single-stage `oven/bun:1.3-alpine` image; entrypoint runs `db:migrate && db:seed && start`

## Testing
- Unit/integration: `bun test tests/` (44 files, `tests/<module>.test.ts`)
- E2E: `bun run e2e` (Playwright, 4 specs in `e2e/` — runs `vr` snapshots before functional `app` specs on port `3993`; override with `E2E_BASE_URL`)
- Coverage: not configured in scripts or CI
- **Test isolation pattern:** set `process.env.ARGUS_DB_PATH` (temp dir) and `process.env.ARGUS_MASTER_KEY` (64 hex chars) *before* dynamically importing DAOs/routes; call `runMigrations()` in `beforeAll` and `closeDb()` + `rmSync` in `afterAll`.

## Project Structure
- `src/app/api/` — thin Next.js route handlers (`force-dynamic`); `POST /api/jobs/:id/run` routes through `enqueueRun()` (returns `409 ConflictError` if already running)
- `src/app/` — App Router pages (`dashboard`, `catalog`, `jobs`, `executions`, `templates`, `logs`, `settings`)
- `src/db/` — `schema.ts` (13 tables), `client.ts` (singleton), `migrate.ts`, `seed.ts`, `dao/` (10 DAO modules)
- `src/services/` — `executor.ts`, `scheduler.ts`, `run-queue.ts`, `backup.ts` (transactional), `reports/` (26 reports), `report-engine/`, `graph/` (`cert.ts`, `provisioner.ts`, `auth.ts` cert+secret, `connection-test.ts`), `dispatch/`, `vault/`
- `src/lib/` — `api.ts` (`ok`/`fail`), `errors.ts` (`ArgusError` subclasses), `validation.ts` (Zod schemas + `parseBody`), utilities
- `src/config/env.ts` — Zod env parser (uncached for test isolation)
- `drizzle/` — 14 generated SQLite migrations

## Code Style & Conventions
- **Naming:** `kebab-case` for all files; `{name}Dao` plain objects in `src/db/dao/`; `"use client"` on interactive components.
- **API routes:** validate input via `parseBody(req, schema)`, return `ok(data, meta?)` or `fail(err)`. Never expose stack traces or raw secrets.
- **Errors:** throw typed `ArgusError` subclasses (`ValidationError`, `NotFoundError`, `ConflictError`, `VaultError`, `GraphAuthError`, `GraphApiError`, `DispatchError`); `fail()` maps them to HTTP status codes and masks unknown errors as `InternalError`.
- **DB:** app-generated UUIDv4 string PKs, ISO-8601 UTC text timestamps, JSON via `text({ mode: "json" }).$type<T>()`, synchronous Drizzle calls (`.all()` / `.get()` / `.run()`).
- **DI:** direct module imports plus optional `deps` parameter objects (e.g., `ExecutorDeps`) for test doubles.
- **Git:** Conventional Commits (`feat(scope):`, `fix(scope):`, `docs(scope):`, `chore(release):`); short-lived `feat/*` and `fix/*` branches merged to `main`.

## Critical Gotchas
- **Never top-level import `bun:sqlite` or `drizzle-orm/bun-sqlite`** in Next-bundled code (type-only imports are fine). `src/db/client.ts` loads them via `runtimeRequire()` with split specifiers so webpack never parses `bun:sqlite`. Do NOT add `bun:sqlite` to `serverExternalPackages` or enable `output: "standalone"` in `next.config.mjs`.
- **No `instrumentation.ts`:** `node-cron` fails Next's Edge compilation; the scheduler starts lazily via `ensureSchedulerStarted()` in `GET /api/health` and updates live via `addOrReplaceJob()` / `removeJob()` on job CRUD.
- **Vault-only secrets:** only `ARGUS_MASTER_KEY` (64 hex chars) belongs in `.env`; all M365/mailbox/webhook secrets go through `vaultService` (AES-256-GCM). `PUT /api/vault` invalidates cached Graph tokens/client.
- **Stale root `AGENTS.md`:** reflects an older snapshot (v0.1, 8 tables / 12 reports); verify against source.

## Branching & DevOps
- **Two-branch flow (`dev` → `main`):** feature/fix branches merge into `dev` via PR; `dev` promotes to `main` via PR once CI is green.
- **Isolated local dev:** `bun run dev:isolated` (or `./install.sh dev`) runs on port `8101` with `ARGUS_ENV=dev` and `./data/argus-dev.db` side-by-side with prod on `8100`.
- **Isolated containers:** `docker compose up -d` (prod, port `8100`, volume `argus-data`) vs `docker compose -f docker-compose.dev.yml up -d` (dev, port `8101`, volume `argus-dev-data`). Swarm + Traefik deployments use [deploy/docker-stack.yml](deploy/docker-stack.yml) with `replicas: 1` and `stop-first` updates.
- **CI/CD & GHCR:** GitHub Actions runs `quality`, `e2e` (`bun run e2e:app`), and `docker` smoke checks on `dev`/`main`; pushes build multi-arch (`amd64`/`arm64`) images to `ghcr.io/rohirik/argus` tagged `:dev`, `:latest` (`main`), and `:v*`.
