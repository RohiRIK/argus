# Argus — Project Instructions

## Tech Stack
- **Runtime & pkg manager:** Bun 1.3 (`bun` only — never npm/yarn/pnpm)
- **Framework:** Next.js 16 (App Router, React 19) built with `--webpack` (not Turbopack)
- **Language:** TypeScript 5.6 (`strict: true`, `@/*` → `src/*`)
- **Database:** SQLite (WAL mode, FK enforcement) via `bun:sqlite` + Drizzle ORM 0.36 (`drizzle-kit` 0.28)
- **Integrations & jobs:** `@microsoft/microsoft-graph-client`, `node-cron` + in-process run queue, Zod `^3.25.76`
- **Styling:** Tailwind CSS 3.4 + HSL CSS variables (`Operator` theme, dark/light + 5 palettes); flat theme-aware SVGs in `src/components/icons.tsx` (no icon libraries)

## Build & Run
- Dev (prod port): `bun run dev` (Next dev `--webpack`, `${PORT:-8100}`)
- Isolated dev: `bun run dev:isolated` or `./install.sh dev` (`ARGUS_ENV=dev`, port `8101`, `./data/argus-dev.db`)
- Build / Start: `bun run build` / `bun run start` (`start:dev` serves built app on `8101`)
- Typecheck / Lint: `bun run typecheck` (`tsc --noEmit`) / `bun run lint` (`eslint src` flat config)
- DB: `bun run db:generate` (new migration), `bun run db:migrate`, `bun run db:seed` (idempotent, 26 templates)
- Docker: HTTPS-only container — `scripts/container-start.ts` runs `next start` on `127.0.0.1:8180` behind a Bun TLS front on `8100` (self-signed cert in `/app/data/tls/`, or `ARGUS_TLS_CERT_FILE`/`KEY_FILE`); single-stage non-root `USER bun` image (`oven/bun:1.3-alpine`); `docker-compose.yml` (`8100`), `docker-compose.dev.yml` (`8101`); single container only (no Swarm/Traefik)

## Testing
- Unit/integration: `bun test tests/` (`tests/<module>.test.ts`)
- E2E: `bun run e2e` (full suite incl. Darwin VR snapshots) or `bun run e2e:app` (26 functional specs, skips VR dependency for Linux CI; override URL via `E2E_BASE_URL`)
- **Test isolation pattern:** set `process.env.ARGUS_DB_PATH` (temp dir) and `process.env.ARGUS_MASTER_KEY` (64 hex chars) *before* dynamically importing DAOs/routes; call `runMigrations()` in `beforeAll` and `closeDb()` + `rmSync` in `afterAll`.

## Project Structure
- `src/app/api/` — thin Next.js route handlers (`force-dynamic`); `POST /api/jobs/:id/run` routes through `enqueueRun()` (`409 ConflictError` if already running); includes `mailboxes/`, `recipient-groups/`, `directory/`, `deploy/`, `cert/`, `maintenance-windows/`, `onboarding/`
- `src/app/` — App Router pages (`dashboard`, `catalog`, `jobs`, `executions`, `templates`, `logs`, `settings`, `settings/recipients`, `settings/integrations`)
- `src/db/` — `schema.ts` (15 tables), `client.ts` (singleton), `migrate.ts`, `seed.ts`, `dao/` (11 DAO modules incl. `recipient-groups.ts`)
- `src/services/` — `executor.ts`, `scheduler.ts`, `run-queue.ts`, `backup.ts` (transactional), `reports/` (26 reports), `report-engine/`, `graph/` (`cert.ts`, `provisioner.ts`, `auth.ts` cert+secret, `mailboxes.ts`, `groups.ts`, `connection-test.ts`), `dispatch/`, `vault/`
- `src/lib/` — `api.ts` (`ok`/`fail`), `errors.ts` (`ArgusError` subclasses), `validation.ts` (Zod schemas + `parseBody`), `request-origin.ts`, `cron.ts`
- `src/config/env.ts` — Zod env parser (`ARGUS_ENV`, `ARGUS_MASTER_KEY`, etc.; uncached for test isolation)
- `drizzle/` — generated SQLite migrations (`0000`–`0018`); never renumber, regenerate on conflict

## Code Style & Conventions
- **Naming:** `kebab-case` for all files; `{name}Dao` plain objects in `src/db/dao/`; `"use client"` on interactive components.
- **API routes:** validate input via `parseBody(req, schema)`, return `ok(data, meta?)` or `fail(err)`. Never expose stack traces or raw secrets.
- **Errors:** throw typed `ArgusError` subclasses (`ValidationError`, `NotFoundError`, `ConflictError`, `VaultError`, `GraphAuthError`, `GraphApiError`, `DispatchError`); `fail()` maps them to HTTP status codes and masks unknown errors as `InternalError`.
- **DB:** app-generated UUIDv4 string PKs, ISO-8601 UTC text timestamps, JSON via `text({ mode: "json" }).$type<T>()`, synchronous Drizzle calls (`.all()` / `.get()` / `.run()`).
- **DI:** direct module imports plus optional `deps` parameter objects (e.g., `ExecutorDeps`, `GroupGraphDeps`, `MailboxGraphDeps`) for test doubles.
- **Git:** Conventional Commits (`feat(scope):`, `fix(scope):`, `docs(scope):`, `ci:`, `chore(release):`).

## Critical Gotchas
- **Never top-level import `bun:sqlite` or `drizzle-orm/bun-sqlite`** in Next-bundled code (type-only imports are fine). `src/db/client.ts` loads them via `runtimeRequire()` with split specifiers so webpack never parses `bun:sqlite`. Do NOT add `bun:sqlite` to `serverExternalPackages` or enable `output: "standalone"` in `next.config.mjs`.
- **No `instrumentation.ts`:** `node-cron` fails Next's Edge compilation; the scheduler starts lazily via `ensureSchedulerStarted()` in `GET /api/health` and updates live via `addOrReplaceJob()` / `removeJob()` on job CRUD.
- **Operator access gate:** `src/proxy.ts` guards every page/API route via `src/lib/auth/access.ts` (Web Crypto only — no DB or `node:crypto` imports there). Public: `/login`, `/api/auth/*`, anonymous `/api/health` (status only). New public paths go in `isPublicPath()` deliberately. Tests/scripts authenticate with `Authorization: Bearer $(bun run --silent auth:access-key)`.
- **Vault-only secrets:** only `ARGUS_MASTER_KEY` (64 hex chars) belongs in `.env`; non-secret defaults in `.env.schema` are tagged `# @sensitive=false` for `varlock`. M365 private key / secret / mailbox go through `vaultService` (AES-256-GCM). `PUT /api/vault` invalidates cached Graph tokens/client.

## Branching & DevOps
- **Two-branch flow (`dev` → `main`):** feature/fix branches merge into `dev` via PR; `dev` promotes to `main` via PR once CI is green (enforced by GitHub rulesets `protect-main` and `protect-dev`).
- **Isolated local dev:** `bun run dev:isolated` (or `./install.sh dev`) runs on port `8101` with `ARGUS_ENV=dev` and `./data/argus-dev.db` side-by-side with prod on `8100`.
- **Isolated containers:** `docker compose up -d` (prod, port `8100`, volume `argus-data`) vs `docker compose -f docker-compose.dev.yml up -d` (dev, port `8101`, volume `argus-dev-data`).
- **CI/CD & GHCR:** GitHub Actions runs `quality`, `e2e` (`bun run e2e:app`), and `docker` smoke checks on `dev`/`main`; pushes build multi-arch (`amd64`/`arm64`) images to `ghcr.io/rohirik/argus` tagged `:dev`, `:latest` (`main`), and `:v*`.
