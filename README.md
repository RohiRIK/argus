# Argus — Microsoft 365 Admin Notification System

Argus is a self-hosted, Dockerized notification platform for IT administrators and
security teams managing Microsoft 365 tenants. It provides a Jenkins-inspired
operational model — Jobs, Executions, Logs, and a Catalog — with a modern, premium UI.

It connects to the Microsoft Graph API using least-privilege application permissions,
schedules automated report queries, generates HTML reports, and delivers them via email
from a scoped shared mailbox. The whole stack runs in a single Docker container.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.1+ |
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Database | SQLite (`bun:sqlite`) + WAL |
| ORM | Drizzle ORM |
| Encryption | AES-256-GCM (Node/Bun `crypto`) |
| Styling | Tailwind CSS + shadcn/ui |
| Cron | node-cron |
| Graph API | @microsoft/microsoft-graph-client |
| Auth | Entra ID Client Credentials (app-only) |
| Email | Graph API `sendMail` (scoped mailbox) |

## Quick start

```bash
bun install

# Generate a 32-byte master key for the encrypted vault
export ARGUS_MASTER_KEY=$(openssl rand -hex 32)

bun run db:push      # apply schema to ./data/argus.db
bun run dev          # http://localhost:3000
```

The only required environment variable is `ARGUS_MASTER_KEY` (64 hex chars = 32 bytes).
All other secrets (Entra ID tenant/client/secret, mailbox) are entered through the UI
and stored AES-256-GCM-encrypted in the database — never in `.env`.

## Docker

```bash
export ARGUS_MASTER_KEY=$(openssl rand -hex 32)
docker compose up --build
```

## Scripts

| Script | Purpose |
|--------|---------|
| `bun run dev` | Next.js dev server (under Bun) |
| `bun run build` | Production build |
| `bun run start` | Serve production build (under Bun) |
| `bun test` | Unit + integration tests (`tests/`) |
| `bun run e2e` | Playwright end-to-end tests |
| `bun run db:migrate` | Apply migrations |
| `bun run db:seed` | Seed default templates + integrations |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run lint` | Lint |

## Features

- **12 built-in reports** across Identity, Security, Infrastructure, and a Custom Manual Graph Query.
- **Editable HTML templates** with live preview and dynamic variables (`{{organization_name}}`, `{{count}}`, `{{anomalyBanner}}`, `{{detailsTable}}`, …) — a default template is seeded per report.
- **Conditional execution** (always / threshold / changed / anomaly / new-items) with baseline anomaly detection (>2σ) and 90-day auto-prune.
- **Suppressed-execution webhooks** with per-URL retry and full report HTML payloads.
- **Encrypted vault** (AES-256-GCM) + Test Connection, all configured via the UI.
- **Premium UI**: sidebar app shell, dark/light, status pills, metric cards, console log viewer, template editor.
- **Cron scheduler** (presets + custom expressions) booted on first request.

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/prd.md`](docs/prd.md) | Product requirements |
| [`docs/spec.md`](docs/spec.md) | Technical specification + acceptance criteria |
| [`docs/plan.md`](docs/plan.md) | Phased implementation plan |

## Security

- Least-privilege only — no broad `Mail.Send`; Exchange Online RBAC scoped to one mailbox.
- All credentials encrypted at rest with AES-256-GCM.
- The master key lives only in process memory — never persisted or logged.
- If `ARGUS_MASTER_KEY` is lost, encrypted credentials are **irrecoverable**.

## Status

Production build: full report catalog, editable templates, premium UI, unit +
integration + E2E tests, Docker. See `docs/plan.md` for phase detail.
