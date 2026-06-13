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
| `bun run dev` | Next.js dev server |
| `bun run build` | Production build (standalone output) |
| `bun run start` | Serve production build |
| `bun test` | Run unit/integration tests |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:push` | Push schema to the SQLite database |
| `bun run lint` | Lint |

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

Early development. See `docs/plan.md` for phase progress.
