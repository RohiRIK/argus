# Argus — System Architecture

> **Version:** 0.2.0
> **Last updated:** 2026-06-16
> **Status:** Living document

---

## Overview

Argus is a self-hosted Microsoft 365 admin notification and reporting system. It connects to Microsoft Graph API, schedules automated report queries, evaluates conditions and baselines, generates HTML reports, and delivers them via email from a least-privilege shared mailbox.

**Runtime model:** Single Docker container running Next.js App Router on Bun. Three runtime surfaces share one process: Web/API, Scheduler, and Background Services.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Argus Container                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Web/API     │  │  Scheduler  │  │  Background Services│ │
│  │  (Next.js)   │  │  (cron)     │  │  (vault, graph,    │ │
│  │              │  │              │  │   report engine)    │ │
│  └──────┬───────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                 │                     │             │
│         └─────────────────┼─────────────────────┘             │
│                           │                                   │
│                    ┌──────▼──────┐                           │
│                    │  SQLite DB  │                           │
│                    │  (WAL mode) │                           │
│                    └─────────────┘                           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │ Microsoft   │
                    │ Graph API   │
                    └─────────────┘
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Bun 1.3 | Fast JS/TS runtime, bundler, package manager |
| Framework | Next.js 16 (App Router, React 19) | SSR, API routes, React Server Components |
| Language | TypeScript (strict) | Type safety end-to-end |
| Database | SQLite + WAL (`bun:sqlite`) | Job configs, execution logs, templates, baselines, vault |
| ORM | Drizzle ORM | Type-safe SQL queries |
| Styling | Tailwind CSS (custom design tokens) | Utility-first CSS, no component library |
| Icons | In-house SVG (24px grid, 1.7 stroke) | Stroke-based, `currentColor`, no third-party |
| Scheduler | node-cron + bounded run queue | In-app scheduling with concurrency cap |
| Encryption | AES-256-GCM (Bun crypto) | Vault credential encryption |
| Graph API | `@microsoft/microsoft-graph-client` | MS Graph abstraction |
| Auth | Entra ID Client Credentials | Daemon / app-only flow |
| Email | Graph API sendMail | Scoped to dedicated mailbox |

---

## Source Structure

```
src/
├── app/                    # Next.js App Router: pages + API route handlers
│   ├── api/                # Thin REST endpoints
│   │   ├── health/         # Health check
│   │   ├── catalog/        # Report catalog
│   │   ├── jobs/           # Job CRUD + run
│   │   ├── executions/     # Execution details
│   │   ├── logs/           # Log viewer
│   │   ├── templates/      # Template editor
│   │   ├── vault/          # Encrypted credentials
│   │   ├── integrations/   # Provider connections
│   │   ├── mailbox/        # Mailbox setup wizard
│   │   └── settings/       # System settings
│   ├── dashboard/          # Dashboard page
│   ├── catalog/            # Catalog page
│   ├── templates/          # Template editor page
│   ├── settings/           # Settings pages
│   ├── logs/               # Log viewer page
│   └── executions/         # Execution detail pages
├── components/             # UI components (all client components)
│   ├── app-shell.tsx       # Main layout wrapper
│   ├── icons/              # In-house SVG icon system
│   └── ui/                 # UI primitives (metric, status-pill, etc.)
├── config/                 # Environment validation (Zod)
├── db/                     # Schema + Drizzle DAOs + client + migrations
│   ├── schema.ts           # 8 tables, UUIDv4 PKs, ISO-8601 timestamps
│   ├── dao/                # 7 DAOs (one per table)
│   ├── client.ts           # Singleton DB connection (WAL, FK enforcement)
│   └── migrations/         # SQLite migration files
├── lib/                    # Utilities
│   ├── errors.ts           # Typed error taxonomy (ArgusError subclasses)
│   ├── api.ts              # ok()/fail() response helpers
│   ├── logger.ts           # Structured logging
│   └── validation.ts       # Zod schemas for request validation
└── services/               # Business logic (5 submodules, 20+ files)
    ├── reports/            # 12 built-in report definitions + custom query
    ├── report-engine/      # Baseline comparison, conditions, template rendering
    ├── graph/              # Auth, client, connection test, permissions
    ├── dispatch/           # Email and webhook delivery
    ├── vault/              # AES-256-GCM encryption/decryption
    ├── executor.ts         # Run pipeline: fetch → baseline → condition → render → deliver
    ├── scheduler.ts        # Cron polling + job activation
    └── run-queue.ts        # Bounded concurrency for job execution
```

---

## Database Schema

8 tables, all with UUIDv4 primary keys and ISO-8601 UTC timestamps.

### Core Tables

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `jobs` | Scheduled report configurations | → templates, → reports (by type) |
| `executions` | Run history per job | → jobs |
| `logs` | Execution log entries | → executions |
| `baselines` | Historical metric aggregates | → jobs |
| `templates` | HTML/text email templates | Referenced by jobs |
| `vault` | Encrypted credentials (AES-256-GCM) | Standalone |
| `integrations` | Connected service configs | → webhooks |
| `webhooks` | Delivery endpoints per integration | → integrations |

### Data Model Rules

- **PKs:** UUIDv4 strings (`text` type)
- **Timestamps:** ISO-8601 UTC (`text` type)
- **JSON columns:** `text({ mode: "json" })` with `$type` for type inference
- **No `bun:sqlite` at module level** — loaded via `createRequire()` at runtime

---

## Execution Pipeline

The core workflow when a job runs:

```
1. Scheduler detects due job
   │
   ▼
2. Run Queue (concurrency cap: ARGUS_MAX_CONCURRENT_RUNS)
   │
   ▼
3. Executor pipeline:
   ├── a. Fetch data from Graph API (with retry + backoff)
   ├── b. Load baseline (if exists)
   ├── c. Evaluate conditions (always/count/changed/anomaly/new)
   ├── d. Render HTML template with data + baseline
   ├── e. Deliver:
   │   ├── Email via Graph sendMail (if conditions met)
   │   └── Webhook notifications (always, including suppressed)
   └── f. Store execution record + logs + baseline update
```

### Conditional Execution

| Rule | Behavior |
|------|----------|
| Always send | Send regardless of data |
| Count > N | Send only if record count exceeds threshold |
| Count changed | Send only if different from last run |
| Anomaly detected | Send only if >2σ from baseline |
| New items | Send only if delta query returns new records |

When suppressed, execution is marked as Suppressed (not Failed) with reason logged.

---

## Security Architecture

### Credential Flow

```
User enters credentials in UI
   │
   ▼
API validates input
   │
   ▼
Vault encrypts with AES-256-GCM
   │
   ├── Encryption key: ARGUS_MASTER_KEY (env var, memory only)
   ├── Each value: unique IV + auth tag
   └── Stored in vault table (encrypted)
```

### Master Key

- **Source:** `ARGUS_MASTER_KEY` environment variable (64 hex chars)
- **Storage:** Process memory only — never persisted, never logged
- **Usage:** Decrypts vault credentials on demand
- **Recovery:** If lost, stored credentials are irrecoverable

### Microsoft Graph Permissions

| Permission | Purpose | Granted When |
|-----------|---------|--------------|
| `AuditLog.Read.All` | Sign-ins, directory audits | Setup |
| `IdentityRiskyUser.Read.All` | Risky users report | Setup |
| `UserAuthenticationMethod.Read.All` | MFA registration | Setup |
| `Organization.Read.All` | License utilization | Setup |
| `Application.Read.All` | App secrets expiry | Setup |
| `SecurityEvents.Read.All` | Security alerts | Setup |
| `DeviceManagementManagedDevices.Read.All` | Device compliance | Setup |
| `User.Read.All` | Inactive users | Setup |
| `Directory.Read.All` | Provisioning logs | Setup |
| `IdentityRiskyServicePrincipal.Read.All` | Risky service principals | Setup |
| `IdentityRiskEvent.Read.All` | Risk detection events | Setup |
| `Reports.Read.All` | CSV usage reports | Setup |
| `Mail.Send` | Send report emails | Setup |

### Exchange Online RBAC

- Shared mailbox scoped via `New-ManagementScope`
- App impersonation limited to single mailbox
- Read-only mode when permissions missing

---

## API Design

Thin route handlers following Next.js App Router conventions.

### Response Format

```typescript
// Success
{ data: T, meta?: { total?: number } }

// Error
{ error: { code: string, message: string } }
```

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | System health check |
| `/api/catalog` | GET | List report types |
| `/api/jobs` | GET/POST | List or create jobs |
| `/api/jobs/:id` | GET/PUT/DELETE | Job CRUD |
| `/api/jobs/:id/run` | POST | Trigger manual execution |
| `/api/executions/:id` | GET | Execution details |
| `/api/logs` | GET | Query logs |
| `/api/templates` | GET/POST | Template CRUD |
| `/api/vault` | GET/PUT | Credential management |
| `/api/integrations` | GET | Integration status |
| `/api/settings` | GET/PUT | System settings |

---

## Design System

**Philosophy:** Vivid+Co darkroom editorial — warm monochrome, zero radius, no shadows.

### Design Tokens

| Token | Dark Mode | Light Mode |
|-------|-----------|------------|
| Canvas | `#141312` (warm graphite) | `#F5F0E8` (bone) |
| Foreground | `#E8E0D4` (warm white) | `#141312` (graphite) |
| Accent | `#f5b748` (amber) | `#f5b748` (amber) |
| Muted | `#9A9389` | `#6B6560` |
| Border | `#2A2826` | `#E0D8CC` |
| Success | `#4ADE80` | `#16A34A` |
| Warning | `#f5b748` | `#D97706` |
| Error | `#F87171` | `#DC2626` |

### Anti-Patterns (THIS PROJECT)

- No shadows (`shadow-sm` is a spec leak)
- No border radius (`rounded-*` violates editorial aesthetic)
- No third-party icon libraries
- No card containers as default — use `section` + `border-t`
- No glassmorphism or gradient backgrounds

---

## Conventions

### Imports

- `@/` path alias maps to `src/`

### Components

- All client components use `"use client"`
- Icons are inline SVG, stroke-based, `currentColor`
- No third-party component libraries

### Styling

- Tailwind CSS + CSS custom properties (HSL)
- Design tokens in `globals.css`
- No shadows, 0px border radius
- Warm monochrome palette with amber accent

### Services

- Each submodule has an entry file (e.g., `vault/vault.ts`)
- DAO pattern: `{name}Dao` with `findAll`, `findById`, `create`, `update`, `delete`

### Testing

- Unit/integration tests in `tests/` (bun test)
- E2E tests in `e2e/` (Playwright)
- 80% minimum coverage target

### Error Handling

- Typed `ArgusError` subclasses (never expose stack traces)
- `ok(data)` / `fail(error)` response helpers

---

## Deployment

### Docker

```yaml
services:
  argus:
    build: .
    ports:
      - "8100:8100"
    volumes:
      - argus-data:/app/data
    environment:
      - ARGUS_MASTER_KEY=${ARGUS_MASTER_KEY}
```

### First Run

1. `docker-compose up`
2. Open `http://localhost:8100`
3. Settings → Integrations → Enter credentials
4. Test Connection → Green
5. Create first job from Catalog

---

## Future Considerations

### Planned Enhancements

- Multi-tenant support (MSP use case)
- Additional providers (GCP, AWS, Custom Webhook)
- CSV usage reports (requires `getCsv` transport)
- One-click permission grant (admin consent flow)
- Template version history
- Job failure alerts
- Backup/export-import

### Technical Debt

- `Card` component overuse → migrate to bare `section` + `border-t`
- `shadow-sm` leaks → remove for DESIGN.md compliance
- Font swap: Manrope → Geist Sans for editorial feel
- Warm console backgrounds (replace near-black with graphite)

---

**References:**
- [PRD](../00-PRD/PRD.md) — Product requirements
- [Technical Spec](../02-Specs/spec.md) — Implementation details
- [Design System](../05-Reference/DESIGN.md) — Visual language
- [User Workflows](../05-Reference/core-workflows.md) — User journeys
