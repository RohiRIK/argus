# Argus — Knowledge Base

**Updated:** 2026-11-24
**Version:** 0.4.0

## Overview

Self-hosted Microsoft 365 admin notification and reporting system. Bun 1.3 + Next.js 16 App Router (`--webpack`) + SQLite/Drizzle ORM, single non-root Docker container (`linux/amd64` + `linux/arm64`). Jenkins-inspired operational model: Catalog → Jobs → Executions → Logs.

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Bun 1.3 |
| Framework | Next.js 16 (App Router, React 19, `--webpack`) |
| Lang | TypeScript 5.6 (`strict`) |
| DB | SQLite + WAL (`bun:sqlite` via runtime `createRequire`) |
| ORM | Drizzle ORM 0.36 (`14` tables, `15` migrations) |
| Styling | Tailwind CSS (Operator editorial design system, 5 themes + dark/light) |
| Icon system | In-house inline SVG (`src/components/icons.tsx`, no icon library) |
| Scheduler | `node-cron` + bounded run queue (`enqueueRun`) |
| Graph Auth | RSA-2048 X.509 Certificate (`RS256` `client_assertion`) or Client Secret |
| Encryption | AES-256-GCM (Bun / Node crypto) |

## Structure

```
src/
├── app/           # Next.js App Router pages + thin API route handlers
├── components/    # UI client components + custom SVG icons
├── config/        # Zod env parser (uncached for test isolation; ARGUS_ENV, PORT, ARGUS_MASTER_KEY)
├── db/            # Schema (18 tables) + Drizzle DAOs (12 modules) + client + migrations/seed
├── lib/           # Utilities (errors, API helpers, cron, validation, request-origin, graph-consent)
└── services/      # Business logic (executor, scheduler, run-queue, backup, reports, automations, graph, dispatch, vault)
tests/             # 52 unit/integration test files (393 tests, bun test)
e2e/               # Playwright E2E + VR specs (playwright.config.ts)
drizzle/           # 17 SQLite migrations (0000–0016)
deploy/            # Docker Swarm + Traefik stack (replicas: 1, stop-first)
```

## Where To Look

| Task | Location | Notes |
|------|----------|-------|
| Report implementations | `src/services/reports/` | 26 built-in reports (JSON + CSV) + custom query |
| Automations | `src/services/automations/` | `registry.ts`, `engine.ts` (read-only `plan()` guard, enforce, rollback), `provision.ts`, `catalog/` (19 automations incl. `lifecycle.ts`); separate Entra app via `graph/automation-client.ts` |
| Report engine | `src/services/report-engine/` | baseline, `metric_delta` conditions, maintenance mute, row diff, templates |
| Graph API transport & setup | `src/services/graph/` | `cert.ts`, `provisioner.ts`, `auth.ts`, `client.ts`, `mailboxes.ts`, `groups.ts`, `connection-test.ts`, `permissions-grant.ts` |
| Email/webhook dispatch | `src/services/dispatch/` | `email.ts` (`sendMail` retry), `alerts.ts`, `webhook.ts` |
| Encrypted vault | `src/services/vault/` | AES-256-GCM + cache invalidation |
| Executor + scheduler | `src/services/executor.ts`, `scheduler.ts`, `run-queue.ts` | recipient group expansion, bounded concurrency, `409` overlap lock |
| DB schema & DAOs | `src/db/schema.ts`, `src/db/dao/` | 18 tables, 12 DAOs (`automations.ts`, `recipient-groups.ts`, `maintenance-windows.ts`, etc.) |
| API routes | `src/app/api/` | Thin handlers using `ok()`/`fail()` & `parseBody()` |
| Settings & onboarding | `src/app/settings/` | General + maintenance windows, Recipients (Entra groups), Integrations (`Quick Setup` \| `Advanced`) |
| Tests & E2E | `tests/`, `e2e/` | `bun test tests/`, `bun run e2e:app` |

## Conventions & Anti-Patterns

- **Imports:** `@/` path alias maps to `src/`; never use `as any` or `@ts-ignore`.
- **SQLite constraint:** Never top-level import `bun:sqlite` or `drizzle-orm/bun-sqlite` in Next-bundled code — `src/db/client.ts` loads via runtime `createRequire`.
- **Secrets:** Only `ARGUS_MASTER_KEY` belongs in `.env`; all other credentials/private keys stay AES-256-GCM encrypted in SQLite `vault`.
- **UI discipline:** In-house stroke SVGs only; flat `1px` borders instead of card shadows; zero exposure of stack traces.

## Commands

```bash
bun run dev          # Prod dev server (${PORT:-8100})
bun run dev:isolated # Isolated dev server (ARGUS_ENV=dev, port 8101, ./data/argus-dev.db)
bun run build        # Production build (--webpack)
bun run start        # Serve production build
bun run typecheck    # tsc --noEmit
bun run lint         # eslint src
bun test tests/      # Unit/integration tests (343 tests across 47 files)
bun run e2e:app      # Playwright functional specs (26 tests)
bun run db:migrate   # Apply Drizzle migrations
bun run db:seed      # Seed defaults (26 templates + integration)
bun run db:generate  # Generate Drizzle migrations
```
