# Argus — Knowledge Base

**Generated:** 2026-06-14
**Commit:** 52509f3
**Branch:** main

## Overview

Self-hosted Microsoft 365 admin notification and reporting system. Bun + Next.js 16 App Router + SQLite/Drizzle ORM, single Docker container. Jenkins-inspired operational model: Catalog → Jobs → Executions → Logs.

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Bun 1.3 |
| Framework | Next.js 16 (App Router, React 19) |
| Lang | TS (strict) |
| DB | SQLite + WAL (`bun:sqlite`) |
| ORM | Drizzle ORM |
| Styling | Tailwind CSS (custom design tokens, no component lib) |
| Icon system | In-house SVG (24px grid, 1.7 stroke, `currentColor`) |
| Scheduler | node-cron + bounded run queue |
| Encryption | AES-256-GCM (Bun crypto) |

## Structure

```
src/
├── app/           # Next.js App Router: pages + API route handlers (thin)
├── components/    # UI components (client components, custom SVG icons)
├── config/        # Environment validation (Zod)
├── db/            # Schema + Drizzle DAOs + client + migrations/seed
├── lib/           # Utilities (errors, API helpers, logger, validation)
└── services/      # Business logic (5 submodules, 20+ files)
tests/             # 17 unit/integration test files (bun test)
e2e/               # Playwright E2E tests
drizzle/           # SQLite migration files
```

## Where To Look

| Task | Location | Notes |
|------|----------|-------|
| Report implementations | `src/services/reports/` | 12 built-in + custom query |
| Report engine (conditions, baselines, templates) | `src/services/report-engine/` | baseline, conditions, template rendering |
| Graph API transport | `src/services/graph/` | auth, client, connection test |
| Email/webhook dispatch | `src/services/dispatch/` | email.ts, webhook.ts |
| Encrypted vault | `src/services/vault/` | AES-256-GCM |
| Executor (run pipeline) | `src/services/executor.ts` | fetch → baseline → condition → render → deliver |
| Scheduler + run queue | `src/services/scheduler.ts`, `run-queue.ts` | cron + concurrency cap |
| DB schema | `src/db/schema.ts` | 8 tables, PKs are UUIDv4, timestamps ISO-8601 UTC |
| DAO CRUD | `src/db/dao/` | 7 DAOs, one per table |
| API routes (Next.js) | `src/app/api/` | Thin route handlers, `ok()`/`fail()` helpers |
| Pages | `src/app/` (per-page dirs) | dashboard, catalog, templates, settings, logs, executions |
| UI components | `src/components/` | app-shell, icons, ui/* (metric, status-pill, primitives) |
| Tests | `tests/` | bun test, 17 files |
| E2E tests | `e2e/` | Playwright |

## Conventions

- **Imports:** `@/` path alias maps to `src/`
- **DB:** PKs are UUIDv4 strings, JSON columns `text({ mode: "json" })` with `$type`, timestamps ISO-8601 UTC
- **API:** Routes return `ok(data, meta?)` or `fail(err)`. Typed error taxonomy in `src/lib/errors.ts`
- **Components:** All client components use `"use client"`. Icons are inline SVG, stroke-based, `currentColor`. No third-party icon lib.
- **Styling:** Tailwind + CSS custom properties (HSL). Design tokens in `globals.css`. No shadows. 0px border radius.
- **Services:** Each submodule has an `index.ts`-like entry file (e.g., `vault/vault.ts` exports `vaultService`)
- **DAO pattern:** `{name}Dao` object with methods: `findAll`, `findById`, `create`, `update`, `delete`
- **Tests:** Co-located in `tests/`, one file per module
- **Secrets:** Only `ARGUS_MASTER_KEY` in env. Everything else stored AES-256-GCM-encrypted in vault table.

## Anti-Patterns (THIS PROJECT)

- Never store secrets in `.env` beyond `ARGUS_MASTER_KEY` — use the encrypted vault
- Never suppress type errors with `as any` or `@ts-ignore`
- Never import `bun:sqlite` at module level — load via `createRequire` at runtime
- Never add third-party icon libraries — use the in-house SVG system
- Never use card shadows or elevation — depth comes from typography + contrast
- Never expose stack traces to clients — use typed `ArgusError` subclasses

## Commands

```bash
bun run dev          # Dev server (port 8100)
bun run build        # Production build
bun run start        # Serve production build
bun test tests/      # Unit/integration tests
bun run e2e          # Playwright E2E
bun run db:migrate   # Apply Drizzle migrations
bun run db:seed      # Seed defaults (12 reports + integration)
bun run db:generate  # Generate Drizzle migrations
bun run lint         # Next lint
bun run typecheck    # tsc --noEmit
```

## Notes

- SQLite driver loaded via `createRequire()` at runtime — webpack must not see `bun:sqlite`
- Dark/light theme persisted in `localStorage` key `argus-theme`
- `getDb()` returns a singleton — lazily opened, WAL mode, FK enforcement
- Design system: Vivid+Co darkroom editorial (DESIGN.md) — slate canvas, bone-white text, gunmetal accent
