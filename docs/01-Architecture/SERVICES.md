# Services Layer

> **Location:** `src/services/`
> **Purpose:** Business logic — the core of Argus. Every non-UI, non-DB operation lives here.

---

## Overview

The services layer is organized into 5 submodules plus 3 top-level orchestrators:

```
src/services/
├── reports/            # Report definitions (the "what to fetch")
│   ├── types.ts        # ReportDefinition interface
│   ├── registry.ts     # Catalog registry (Map of all reports)
│   ├── catalog.ts      # Original 12 reports (core)
│   ├── catalog-extra.ts # Additional built-in reports
│   ├── catalog-new.ts  # Tier-1 JSON reports (secure-score, provisioning, risky-SP)
│   ├── catalog-csv.ts  # Tier-2 CSV usage reports
│   ├── catalog-tier3.ts # Tier-3 specialized reports
│   └── sign-in-anomalies.ts # First report (reference implementation)
├── report-engine/      # Template rendering + conditions + baselines
├── graph/              # Microsoft Graph API transport
├── dispatch/           # Email + webhook delivery
├── vault/              # AES-256-GCM credential encryption
├── executor.ts         # Run pipeline orchestrator
├── scheduler.ts        # Cron-based job scheduling
├── run-queue.ts        # Bounded concurrency for job execution
└── backup.ts           # Export/import functionality
```

---

## Report Definitions

### Interface: `ReportDefinition<Row>`

```typescript
interface ReportDefinition<Row> {
  id: string;                          // Stable ID (stored on jobs.reportType)
  name: string;                        // Display name
  category: "identity" | "security" | "infrastructure" | "custom";
  description: string;                 // For catalog UI
  requiredPermissions: string[];       // Graph permissions needed
  baselineSupport: boolean;            // Can track trends/anomalies
  fetch(transport, params): Promise<Row[]>;  // Fetch data from Graph
  summarize(rows): ReportSummary;      // Derive template variables
}
```

### Report Summary

```typescript
interface ReportSummary {
  count: number;                        // Primary metric for conditions
  variables: Record<string, string | number>;  // Template variables ({{key}})
  rows?: Record<string, string | number>[];     // Structured data for tables
}
```

### Registry Pattern

Reports are registered in `registry.ts` as a `Map<string, ReportDefinition>`. Adding a report = defining it + adding to the map.

**Current catalog (26 reports):**
- 12 original (sign-in-anomalies, risky-users, mfa-registration, etc.)
- 3 Tier-1 JSON (secure-score, provisioning-summary, risky-service-principals)
- 7 Tier-2 CSV (teams-activity, mailbox-quota, groups-activity, etc.)
- 4 Tier-3 specialized (onedrive-storage, sharepoint-site, risk-detections, sp-signins)
- 1 custom (manual-graph-query)

---

## Report Engine

**Location:** `src/services/report-engine/`

Handles three concerns:
1. **Condition evaluation** — should this run send email?
2. **Baseline comparison** — is this data anomalous?
3. **Template rendering** — generate HTML report

### Conditions (`conditions.ts`)

Evaluates `ConditionalRules` against current run data:

| Mode | Logic |
|------|-------|
| `always` | Send if count > 0 |
| `count_gt` | Send if count > threshold |
| `count_changed` | Send if count ≠ previous count |
| `anomaly` | Send if z-score > 2 (anomaly detected) |
| `new_items` | Send if newItems > 0 (delta query) |

### Baselines (`baseline.ts`)

Stores aggregated metrics per job. Detects anomalies via z-score:
- `detectAnomaly(current, history)` → `{ isAnomaly, mean, stddev, zScore }`
- `computeTrend(current, previous)` → `{ direction, percent }`
- Auto-prunes data older than `retentionDays` (configurable, default 90)

### Template Rendering (`default-template.ts`)

Renders HTML reports with variables:
- `{{reportName}}`, `{{organizationName}}`, `{{count}}`
- `{{trendPercent}}`, `{{trendDirection}}`, `{{isAnomaly}}`
- `{{baselineMean}}`, `{{variables.*}}`, `{{rows.*}}`
- Falls back to built-in template if no custom template assigned

---

## Graph API Transport

**Location:** `src/services/graph/`

### Authentication (`auth.ts`)

- Uses Entra ID Client Credentials flow (app-only, no user interaction)
- Acquires token via `@azure/msal-node`
- Caches token until expiry (automatic refresh)

### Client (`client.ts`)

**`GraphTransport` interface:**

```typescript
interface GraphTransport {
  get<T>(path: string): Promise<GraphPage<T>>;           // JSON endpoints
  getCsv?(path: string): Promise<{ headers, rows, latencyMs }>;  // CSV reports
  batch?(requests): Promise<GraphBatchResponse[]>;        // $batch endpoint
}
```

**Key features:**
- Shared client instance (reused across requests)
- Automatic pagination (follows `@odata.nextLink`, max 50 pages)
- Retry with exponential backoff (handles 429/5xx)
- CSV parser for usage reports (RFC-4180 compliant)
- Error messages include HTTP status + remediation hints

**`liveGraphTransport`:** The real implementation that calls Microsoft Graph.

### Permissions Grant (`permissions-grant.ts`)

Two-step authorization flow:
1. **Authorize** (OAuth consent) — gets bootstrap scopes (`Application.ReadWrite.All`, `AppRoleAssignment.ReadWrite.All`)
2. **Grant** (programmatic) — declares + grants the 13 application permissions

---

## Dispatch

**Location:** `src/services/dispatch/`

### Email (`email.ts`)

**`EmailTransport` interface:**

```typescript
interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}
```

**`liveEmailTransport`:** Sends via Graph `sendMail` from the scoped shared mailbox.
- Supports `from`, `to`, `subject`, `html`, `replyTo`
- Retries on transient failures

### Webhooks (`webhook.ts`)

Sends notifications to configured webhook URLs when jobs are suppressed.
- Multiple endpoints per integration
- Optional full HTML payload
- Per-endpoint delivery status tracking
- Retry: 3 attempts with exponential backoff

### Failure Alerts (`alerts.ts`)

Notifies admin contacts when a job fails N consecutive times.
- Configurable threshold (0 = off)
- One alert per threshold crossing (not per failure)
- Best-effort delivery (never masks original failure)

---

## Vault

**Location:** `src/services/vault/`

### Encryption (`crypto.ts`)

- **Algorithm:** AES-256-GCM
- **Key:** `ARGUS_MASTER_KEY` (64 hex chars = 32 bytes)
- **Per-value:** Unique IV + auth tag
- **Encoding:** Base64 for storage

### Vault Service (`vault.ts`)

```typescript
vaultService.set(key, value)     // Upsert encrypted credential
vaultService.get(key)            // Decrypt and return
vaultService.has(key)            // Check if key exists
vaultService.remove(key)         // Delete credential
vaultService.list()              // List all keys with masked values
vaultService.isConfigured()      // True when all 4 core keys present
```

**Known keys:** `tenantId`, `clientId`, `clientSecret`, `mailbox`
**Masking:** `clientSecret` → `••••••••`; others → first 3 + `••••` + last 3

---

## Executor

**Location:** `src/services/executor.ts`

The core orchestrator. Runs a single job end-to-end:

```
1. Create execution record (status: "warning")
2. Fetch data from Graph API (critical — fails entire run)
3. Compute baseline + detect anomaly (non-critical — degrades to warning)
4. Evaluate conditional rules (should we send?)
5. Render HTML template (critical — fails entire run)
6. Record baseline metric
7. Deliver email OR suppress + notify webhooks
8. Finalize execution (single transaction with all logs)
```

**Key design decisions:**
- Logs buffered in memory, flushed in single transaction (AC-DB3)
- Read-only mode when mailbox permissions missing (skip email, not fail)
- Empty report suppression (configurable, default on)
- Job failure alerts (best-effort, never masks original error)

**Dependency injection:**
```typescript
interface ExecutorDeps {
  transport?: GraphTransport;      // For tests
  email?: EmailTransport;          // For tests
  now?: () => Date;               // For tests
  tenantName?: string;
  canSendEmail?: boolean;
  dispatchWebhooks?: Function;    // For tests
}
```

---

## Scheduler

**Location:** `src/services/scheduler.ts`

- Uses `node-cron` for scheduling
- One cron task per active job
- Re-fetches job from DB on each fire (edits take effect without restart)
- Respects snooze (skips fires until wake time)
- HMR-safe (global guard prevents duplicate loops)
- Timezone-aware (reads from settings)

**Key functions:**
```typescript
startScheduler()           // Start all active jobs
addOrReplaceJob(id)        // Update a job's schedule
removeJob(id)              // Stop a job's schedule
rescheduleAll()            // Re-register all (after timezone change)
stopScheduler()            // Shutdown
ensureSchedulerStarted()   // Boot on first health probe
```

---

## Run Queue

**Location:** `src/services/run-queue.ts`

Bounded concurrency controller:
- Max concurrent runs: `ARGUS_MAX_CONCURRENT_RUNS` (default 4)
- Excess runs queue and wait
- Prevents tenant throttling when many jobs fire simultaneously

---

## Backup

**Location:** `src/services/backup.ts`

Export/import functionality:
- Exports jobs, templates, settings, webhooks (no secrets)
- Imports with conflict resolution (skip/overwrite)
- Vault credentials are NOT exported (security)

---

## Conventions

### Error Handling
- Services throw typed `ArgusError` subclasses
- Executor catches and logs, never crashes the process
- Non-critical failures degrade to `warning`, not `failed`

### Testing
- All services have dependency injection seams
- `liveGraphTransport` / `liveEmailTransport` replaced in tests
- Pure functions (baseline math, condition evaluation) unit-tested without mocks

### Adding a New Service
1. Create file in appropriate submodule
2. Export interface + live implementation
3. Add DI seam for tests
4. Register in parent index if needed
5. Add unit tests

---

**References:**
- [Database Layer](./DATABASE.md) — Schema and DAOs
- [API Layer](./API.md) — Route handlers
- [Security](./SECURITY.md) — Vault and auth details
