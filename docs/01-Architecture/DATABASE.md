# Database Layer

> **Location:** `src/db/`
> **Engine:** SQLite (WAL mode) via `bun:sqlite`
> **ORM:** Drizzle ORM
> **Schema:** `src/db/schema.ts`
> **DAOs:** `src/db/dao/`

---

## Overview

Argus uses a single SQLite file for all state. The database layer provides:

1. **Schema** — 10 tables with typed columns
2. **Client** — Singleton connection with WAL + performance tuning
3. **DAOs** — Data access objects (one per table)
4. **Migrations** — Drizzle-generated migration files
5. **Seed** — Default templates + integration on first run

---

## Schema (`schema.ts`)

### Tables

| Table | Purpose | Relationships |
|-------|---------|---------------|
| `jobs` | Scheduled report configurations | → templates, → reports (by type) |
| `executions` | Run history per job | → jobs (cascade delete) |
| `logs` | Execution log entries | → executions (cascade delete) |
| `baselines` | Historical metric aggregates | → jobs (cascade delete) |
| `templates` | HTML/text email templates | Referenced by jobs |
| `templateVersions` | Template version history | → templates (cascade delete) |
| `vault` | Encrypted credentials | Standalone |
| `integrations` | Connected service configs | → webhooks |
| `webhooks` | Delivery endpoints | → integrations (cascade delete) |
| `settings` | System settings (singleton) | Standalone |
| `audit` | Permission grant audit log | Standalone |

### Column Conventions

- **PKs:** `text` type, app-generated UUIDv4 strings
- **Timestamps:** `text` type, ISO-8601 UTC (`2026-06-16T12:00:00.000Z`)
- **JSON columns:** `text({ mode: "json" })` with `$type<T>()` for type inference
- **Booleans:** `integer({ mode: "boolean" })` (SQLite has no native boolean)
- **Defaults:** `nowIso` = `sql\`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))\``

---

## Table Definitions

### jobs

The core entity. Each row represents a scheduled report.

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,                    -- UUIDv4
  name TEXT NOT NULL,                     -- Display name
  description TEXT NOT NULL DEFAULT '',   -- Optional description
  report_type TEXT NOT NULL,              -- FK to report catalog (by ID)
  params TEXT NOT NULL DEFAULT '{}',      -- JSON: report-specific parameters
  schedule_type TEXT NOT NULL,            -- 'preset' | 'cron'
  schedule_preset TEXT,                   -- Preset name (if type=preset)
  cron_expression TEXT,                   -- Cron expression (if type=cron)
  template_id TEXT REFERENCES templates(id), -- Custom template override
  recipients TEXT NOT NULL DEFAULT '[]',  -- JSON: string[] email addresses
  conditional_rules TEXT NOT NULL DEFAULT '{"mode":"always"}', -- JSON: ConditionalRules
  tags TEXT NOT NULL DEFAULT '[]',        -- JSON: string[] for organization
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'disabled'
  snoozed_until TEXT,                     -- ISO timestamp (auto-resume)
  created_at TEXT NOT NULL DEFAULT (now),
  updated_at TEXT NOT NULL DEFAULT (now)
);
```

**Indexes:**
- None explicitly (queries are by PK or status, which are fast)

**Types:**
```typescript
type Recipients = string[];
type Tags = string[];
type ConditionalRules = {
  mode: "always" | "count_gt" | "count_changed" | "anomaly" | "new_items";
  threshold?: number;
};
```

### executions

Append-only run history. Created at start, finalized at end.

```sql
CREATE TABLE executions (
  id TEXT PRIMARY KEY,                    -- UUIDv4
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                   -- 'success' | 'warning' | 'failed' | 'suppressed'
  started_at TEXT NOT NULL,               -- ISO timestamp
  ended_at TEXT,                          -- ISO timestamp (null while running)
  records_processed INTEGER NOT NULL DEFAULT 0,
  graph_api_latency_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,                     -- Error details (if failed)
  output_html TEXT,                       -- Rendered report HTML
  email_sent INTEGER NOT NULL DEFAULT 0,  -- Boolean
  email_recipients TEXT,                  -- JSON: string[]
  suppression_reason TEXT,                -- Why it was suppressed
  baseline_snapshot TEXT,                 -- JSON: { mean, stddev, zScore }
  webhook_delivered INTEGER NOT NULL DEFAULT 0, -- Boolean
  webhook_error TEXT,                     -- Webhook delivery errors
  created_at TEXT NOT NULL DEFAULT (now)
);
```

**Indexes:**
- `idx_executions_job_started` ON (job_id, started_at) — for job history queries
- `idx_executions_started` ON (started_at) — for recent activity feed

### logs

Append-only log entries per execution.

```sql
CREATE TABLE logs (
  id TEXT PRIMARY KEY,                    -- UUIDv4
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  level TEXT NOT NULL,                    -- 'info' | 'warning' | 'error'
  message TEXT NOT NULL,                  -- Log message
  timestamp TEXT NOT NULL DEFAULT (now)   -- ISO timestamp
);
```

**Indexes:**
- `idx_logs_execution` ON (execution_id, timestamp) — for execution logs
- `idx_logs_timestamp` ON (timestamp) — for log queries

### baselines

Historical metric aggregates per job. Used for anomaly detection.

```sql
CREATE TABLE baselines (
  id TEXT PRIMARY KEY,                    -- UUIDv4
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,              -- e.g., 'count'
  metric_value REAL NOT NULL,             -- The aggregated value
  window_days INTEGER NOT NULL DEFAULT 7, -- Rolling window
  calculated_at TEXT NOT NULL DEFAULT (now)
);
```

**Indexes:**
- `idx_baselines_job_metric_calc` ON (job_id, metric_name, calculated_at)

### templates

Email templates (HTML + optional text).

```sql
CREATE TABLE templates (
  id TEXT PRIMARY KEY,                    -- UUIDv4
  name TEXT NOT NULL,                     -- Display name
  report_type TEXT NOT NULL DEFAULT 'generic', -- 'generic' or report ID
  subject TEXT NOT NULL,                  -- Subject line (with {{variables}})
  html_body TEXT NOT NULL,                -- HTML email body
  text_body TEXT,                         -- Plain-text alternative (multipart)
  is_default INTEGER NOT NULL DEFAULT 0,  -- Boolean: default for this report type
  language TEXT NOT NULL DEFAULT 'en'     -- 'en' | 'he'
);
```

### templateVersions

Snapshot history for templates. Created on every update.

```sql
CREATE TABLE template_versions (
  id TEXT PRIMARY KEY,                    -- UUIDv4
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,               -- 1-based, monotonic per template
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT,
  created_at TEXT NOT NULL DEFAULT (now)
);
```

**Indexes:**
- `idx_template_versions_template` ON (template_id, version)

### vault

Encrypted credential storage. AES-256-GCM.

```sql
CREATE TABLE vault (
  id TEXT PRIMARY KEY,                    -- UUIDv4
  key TEXT NOT NULL UNIQUE,               -- Credential name (e.g., 'tenantId')
  value TEXT NOT NULL,                    -- Base64 ciphertext
  iv TEXT NOT NULL,                       -- Base64 initialization vector
  tag TEXT NOT NULL,                      -- Base64 auth tag
  updated_at TEXT NOT NULL DEFAULT (now)
);
```

**Known keys:** `tenantId`, `clientId`, `clientSecret`, `mailbox`

### integrations

Connected service configurations.

```sql
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,                    -- UUIDv4
  provider TEXT NOT NULL UNIQUE,          -- e.g., 'microsoft365'
  name TEXT NOT NULL,                     -- Display name
  status TEXT NOT NULL DEFAULT 'disconnected', -- 'connected' | 'disconnected' | 'error'
  config TEXT NOT NULL DEFAULT '{}',      -- JSON: provider-specific config
  last_health_check TEXT,                 -- ISO timestamp
  error_message TEXT,                     -- Last error
  created_at TEXT NOT NULL DEFAULT (now),
  updated_at TEXT NOT NULL DEFAULT (now)
);
```

### webhooks

Delivery endpoints per integration.

```sql
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,                    -- UUIDv4
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                     -- Display name
  url TEXT NOT NULL,                      -- Webhook URL
  secret TEXT,                            -- Optional signing secret
  include_full_html INTEGER NOT NULL DEFAULT 1, -- Boolean
  payload_template TEXT,                  -- Custom JSON template (optional)
  enabled INTEGER NOT NULL DEFAULT 1,     -- Boolean
  last_delivery_status TEXT,              -- 'success' | 'failed'
  last_delivery_at TEXT,                  -- ISO timestamp
  created_at TEXT NOT NULL DEFAULT (now),
  updated_at TEXT NOT NULL DEFAULT (now)
);
```

### settings

Singleton row for system configuration.

```sql
CREATE TABLE settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton', -- Always 'singleton'
  master_key_hash TEXT,                    -- Hash of master key (for verification)
  global_recipients TEXT NOT NULL DEFAULT '[]', -- JSON: string[]
  admin_contacts TEXT NOT NULL DEFAULT '[]',    -- JSON: string[]
  last_permission_check TEXT,              -- ISO timestamp
  permission_status TEXT NOT NULL DEFAULT 'missing', -- 'ok' | 'missing' | 'error'
  language TEXT NOT NULL DEFAULT 'en',     -- 'en' | 'he'
  timezone TEXT NOT NULL DEFAULT 'UTC',    -- IANA timezone
  retention_days INTEGER NOT NULL DEFAULT 90, -- Baseline retention window
  from_address TEXT,                       -- Custom sender email
  reply_to TEXT,                           -- Custom Reply-To address
  missing_permissions TEXT NOT NULL DEFAULT '[]', -- JSON: string[]
  alert_threshold INTEGER NOT NULL DEFAULT 0,     -- Consecutive failures before alert (0=off)
  suppress_empty_reports INTEGER NOT NULL DEFAULT 1 -- Boolean: suppress 0-item runs
);
```

### audit

Permission grant audit log.

```sql
CREATE TABLE audit (
  id TEXT PRIMARY KEY,                    -- UUIDv4
  action TEXT NOT NULL,                   -- e.g., 'permission_grant'
  provider TEXT,                          -- e.g., 'microsoft365'
  outcome TEXT NOT NULL,                  -- 'success' | 'partial' | 'error'
  detail TEXT NOT NULL DEFAULT '{}',      -- JSON: operation details
  created_at TEXT NOT NULL DEFAULT (now)
);
```

**Indexes:**
- `idx_audit_created` ON (created_at)

---

## Client (`client.ts`)

### Connection

```typescript
function getDb(): DB  // Singleton Drizzle instance
function getRawDb(): BunDatabase  // Raw SQLite for PRAGMAs
function closeDb(): void  // Shutdown
```

### PRAGMAs

```sql
PRAGMA journal_mode = WAL;        -- Write-Ahead Logging
PRAGMA foreign_keys = ON;         -- FK enforcement
PRAGMA busy_timeout = 5000;       -- 5s wait on lock
PRAGMA synchronous = NORMAL;      -- Skip fsync (safe under WAL)
PRAGMA mmap_size = 268435456;     -- 256 MiB memory-mapped I/O
PRAGMA temp_store = MEMORY;       -- Temp tables in RAM
PRAGMA cache_size = -16000;       -- ~16 MiB page cache
PRAGMA wal_autocheckpoint = 1000; -- Cap WAL growth
```

### Runtime Loading

SQLite driver loaded via `createRequire()` at runtime — webpack must not see `bun:sqlite`. Both `bun:sqlite` and `drizzle-orm/bun-sqlite` are loaded dynamically.

---

## DAOs (`src/db/dao/`)

### Pattern

Each DAO is a plain object with methods:

```typescript
export const {name}Dao = {
  findAll(): Row[],
  findById(id: string): Row | undefined,
  create(input): Row,
  update(id, patch): Row | undefined,
  delete(id): void,
  // ... additional query methods
};
```

### DAOs

| DAO | File | Key Methods |
|-----|------|-------------|
| `jobsDao` | `jobs.ts` | `findAll`, `findById`, `create`, `update`, `delete`, `active`, `snooze`, `unsnooze` |
| `executionsDao` | `executions.ts` | `create`, `update`, `finalize` (transaction), `findById`, `forJob`, `recent` |
| `logsDao` | `executions.ts` | `append`, `appendMany`, `forExecution`, `query` |
| `baselinesDao` | `baselines.ts` | `record`, `history`, `prune` |
| `templatesDao` | `templates.ts` | `findAll`, `findById`, `defaultFor`, `create`, `update` (with version snapshot) |
| `templateVersionsDao` | `templates.ts` | `list`, `findById` |
| `vaultDao` | (inline in vault service) | Direct SQL in vault service |
| `integrationsDao` | `integrations.ts` | `findAll`, `findByProvider`, `create`, `update` |
| `webhooksDao` | `webhooks.ts` | `forIntegration`, `enabledTargets`, `create`, `update`, `delete`, `recordDelivery` |
| `settingsDao` | `settings.ts` | `get` (singleton), `update` |
| `auditDao` | `audit.ts` | `create`, `list` |

### Key Patterns

**Singleton settings:**
```typescript
settingsDao.get() // Returns existing row or creates with defaults
```

**Batched log inserts:**
```typescript
executionsDao.finalize(id, patch, logRows) // Single transaction: insert logs + update execution
```

**Template versioning:**
```typescript
templatesDao.update(id, patch) // Transactions: snapshot current → update
```

---

## Migrations

**Location:** `drizzle/`

Generated by `bun run db:generate`. Applied by `bun run db:migrate`.

### Commands

```bash
bun run db:generate   # Generate migration files from schema changes
bun run db:migrate    # Apply pending migrations
bun run db:seed       # Seed default templates + integration
```

---

## Type Exports

```typescript
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
export type Log = typeof logs.$inferSelect;
export type NewLog = typeof logs.$inferInsert;
export type Baseline = typeof baselines.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type VaultRow = typeof vault.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type Audit = typeof audit.$inferSelect;
export type NewAudit = typeof audit.$inferInsert;
```

---

## Conventions

- **No raw `bun:sqlite` at module level** — loaded via `createRequire()` at runtime
- **UUIDv4 PKs** — generated in application, not database
- **ISO-8601 timestamps** — always UTC, always strings
- **JSON columns** — typed via `$type<T>()`, never raw JSON.parse in queries
- **Cascade deletes** — deleting a job removes its executions, logs, and baselines
- **Append-only** — executions and logs are never updated (except `finalize`)

---

**References:**
- [Services Layer](./SERVICES.md) — How DAOs are consumed
- [API Layer](./API.md) — Route handlers that use DAOs
- [Architecture](./ARCHITECTURE.md) — System overview
