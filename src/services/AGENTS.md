# Services — Business Logic

## Overview

5 submodules + 3 top-level orchestrators. All backend logic lives here — never in API routes (those are thin wrappers).

## Modules

| Module | Files | Purpose |
|--------|-------|---------|
| `dispatch/` | email.ts, webhook.ts | Email delivery via Graph sendMail, webhook dispatch with retry |
| `graph/` | auth.ts, client.ts, connection-test.ts | Microsoft Graph API transport: auth, pagination, retry |
| `report-engine/` | baseline.ts, conditions.ts, default-template.ts, template.ts | Baseline anomaly, condition evaluation, HTML template rendering |
| `reports/` | registry.ts, catalog.ts, catalog-extra.ts, sign-in-anomalies.ts, types.ts | 12 report implementations + custom query |
| `vault/` | vault.ts, crypto.ts | AES-256-GCM encryption, read/write/delete |

## Top-Level Services

| File | Role |
|------|------|
| `executor.ts` | Orchestrates run pipeline: fetch → baseline → condition → render → deliver |
| `scheduler.ts` | node-cron management, live add/replace/remove |
| `run-queue.ts` | Bounded concurrency, per-job lock, FIFO queue |

## Conventions

- Entry exports: `{name}Service` (e.g., `vaultService`), `live{Name}` for production singletons
- Report registry: reports register via `registerReport()` — `listReports()` scans them
- Graph transport: `GraphTransport` interface with live + test implementations
- Executor accepts `ExecutorDeps` for test injection of transport/email/clock
- All errors propagate typed ArgusErrors; zero `console.log`
