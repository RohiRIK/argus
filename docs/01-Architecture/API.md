# API Layer

> **Location:** `src/app/api/`
> **Framework:** Next.js App Router (route handlers)
> **Pattern:** Thin handlers → DAO/service calls → `ok()`/`fail()` responses

---

## Overview

REST API under `/api/*`. Each route is a `route.ts` file exporting HTTP method handlers (`GET`, `POST`, `PUT`, `DELETE`).

### Response Format

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 50 }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "ValidationError",
    "message": "Invalid job name",
    "fields": { "name": "Required" }
  }
}
```

### Helpers

```typescript
import { ok, fail } from "@/lib/api";

// Success
return ok(data);
return ok(data, { total: 100 });

// Error (auto-maps ArgusError → HTTP status)
return fail(error);
```

---

## Endpoints

### Health

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/health` | System health check |

**Response:**
```json
{
  "status": "healthy",
  "db": { "connected": true, "journalMode": "wal" },
  "vault": { "masterKeyPresent": true, "configured": true },
  "version": "0.1.0",
  "timestamp": "2026-06-16T12:00:00.000Z"
}
```

**Side effect:** Boots the scheduler on first probe.

---

### Catalog

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/catalog` | List all report types |

**Response:** Array of report definitions with metadata.

---

### Jobs

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/jobs` | List all jobs with last execution |
| `POST` | `/api/jobs` | Create a new job |
| `GET` | `/api/jobs/[id]` | Get job details |
| `PUT` | `/api/jobs/[id]` | Update a job |
| `DELETE` | `/api/jobs/[id]` | Delete job + history |
| `POST` | `/api/jobs/[id]/run` | Trigger manual execution |
| `POST` | `/api/jobs/[id]/clone` | Clone a job |
| `POST` | `/api/jobs/[id]/snooze` | Snooze a job |
| `POST` | `/api/jobs/[id]/unsnooze` | Unsnooze a job |

**Create request:**
```json
{
  "name": "Daily Sign-in Anomalies",
  "reportType": "sign-in-anomalies",
  "scheduleType": "preset",
  "schedulePreset": "daily",
  "recipients": ["admin@example.com"],
  "conditionalRules": { "mode": "always" },
  "tags": ["identity", "daily"]
}
```

**List response:**
```json
{
  "data": [
    {
      "id": "...",
      "name": "Daily Sign-in Anomalies",
      "status": "active",
      "lastExecution": { "status": "success", "startedAt": "..." }
    }
  ]
}
```

---

### Executions

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/executions/[id]` | Get execution details |
| `GET` | `/api/executions/[id]/logs` | Get execution logs |
| `GET` | `/api/executions/[id]/preview` | Get rendered HTML |
| `GET` | `/api/executions/compare` | Compare two executions |

**Compare query params:** `?a=<id1>&b=<id2>`

---

### Logs

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/logs` | Query logs with filters |

**Query params:**
- `executionId` — Filter by execution
- `level` — Filter by level (info/warning/error)
- `from` — Start timestamp
- `to` — End timestamp
- `level` values outside `info`/`warning`/`error` → `400 ValidationError`
- `limit` — Page size, clamped to 1–500 (default 500)
- `cursor` — Opaque cursor from a previous response's `meta.nextCursor` (malformed → `400`)

**Response:** `data` is an array of log entries, newest first, ordered by
`(timestamp DESC, id DESC)` so rows sharing a timestamp page stably (keyset
pagination: no duplicates or gaps across pages).

```json
{
  "success": true,
  "data": [ /* log entries */ ],
  "meta": { "total": 1234, "limit": 500, "hasMore": true, "nextCursor": "WyIyMDI2LTAx..." }
}
```

- `meta.total` — real count of rows matching the filters (COUNT query, not the page length)
- `meta.hasMore` / `meta.nextCursor` — `nextCursor` is `null` when there is no further page.
  Pass it back as `?cursor=` (with the same filters) to fetch the next page.

Callers that ignore `meta` keep working: the first page is identical to the old response.

---

### Templates

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/templates` | List all templates |
| `POST` | `/api/templates` | Create a template |
| `GET` | `/api/templates/[id]` | Get template details |
| `PUT` | `/api/templates/[id]` | Update template (auto-versions) |
| `GET` | `/api/templates/[id]/versions` | List version history |

---

### Vault

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/vault` | List all keys (masked values) |
| `PUT` | `/api/vault` | Update vault credentials |
| `POST` | `/api/vault/test` | Test connection with stored creds |

**Update request:**
```json
{
  "tenantId": "xxxx-xxxx-xxxx",
  "clientId": "xxxx-xxxx-xxxx",
  "clientSecret": "xxxx-xxxx-xxxx",
  "mailbox": "argus@tenant.com"
}
```

**Test response:**
```json
{
  "auth": { "ok": true, "latencyMs": 245 },
  "permissions": { "ok": true, "missing": [] },
  "mailbox": { "ok": true, "email": "argus@tenant.com" }
}
```

---

### Integrations

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/integrations` | List all integrations |
| `GET` | `/api/integrations/[provider]` | Get integration details |
| `POST` | `/api/integrations/[provider]/connect` | Connect/configure |
| `POST` | `/api/integrations/[provider]/disconnect` | Disconnect |
| `POST` | `/api/integrations/[provider]/health` | Run health check |
| `GET` | `/api/integrations/[provider]/webhooks` | List webhooks |
| `POST` | `/api/integrations/[provider]/webhooks` | Add webhook |
| `PUT` | `/api/integrations/[provider]/webhooks/[id]` | Update webhook |
| `DELETE` | `/api/integrations/[provider]/webhooks/[id]` | Delete webhook |
| `POST` | `/api/integrations/[provider]/webhooks/[id]/test` | Test webhook |

---

### Settings

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/settings` | Get current settings |
| `PUT` | `/api/settings` | Update settings |
| `GET` | `/api/settings/permissions` | Check permission status |

**Settings fields:**
- `globalRecipients` — Fallback email list
- `adminContacts` — Alert recipients
- `language` — 'en' | 'he'
- `timezone` — IANA timezone
- `retentionDays` — Baseline retention window
- `fromAddress` — Custom sender
- `replyTo` — Custom Reply-To
- `alertThreshold` — Consecutive failures before alert
- `suppressEmptyReports` — Suppress 0-item runs

---

### Mailbox

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/mailbox/setup` | Run setup wizard step |
| `POST` | `/api/mailbox/validate` | Validate mailbox permissions |
| `POST` | `/api/mailbox/revoke` | Show permissions to revoke |

---

### Backup

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/backup` | Export jobs, templates, settings |
| `POST` | `/api/backup?mode=preview` | Dry-run an import (writes nothing) |
| `POST` | `/api/backup` | Import from backup |

**Export response:** JSON with all non-secret data (no vault credentials, no master key).

**Import body:** the exported bundle, unchanged. Query params:
- `mode` — `import` (default) or `preview`; anything else → `400`
- `activate` — `true`/`1` keeps bundle-active jobs active and schedules them. **Default: off.**

**Import semantics:**
- Every imported job lands **paused** (`status: "disabled"`) regardless of its state in the
  bundle and of the target's integration status. Paused jobs are removed from the scheduler;
  nothing is registered, run, or dispatched. Enable jobs individually after review.
- Settings: only the non-secret keys listed in the export are applied, only when the bundle
  carries them, and a bundle's `null`/empty value never clears a value the target already
  has. Other keys (e.g. `masterKeyHash`, permission state) are ignored.
- A job referencing a template that is in neither the bundle nor the target → `400`, nothing
  written. Missing recipient groups are reported by the preview but do not block.
- `rescheduleAll()` runs only when the import actually changes the timezone (re-times the
  target's existing active jobs).

**Import response:** `{ imported: { jobs, templates, maintenanceWindows, recipientGroups, pausedJobs } }`

**Preview response:**

```json
{
  "success": true,
  "data": {
    "preview": {
      "exportedAt": "2026-11-20T10:00:00.000Z",
      "jobs": { "create": 2, "update": 1, "scheduled": 3, "items": [
        { "id": "…", "name": "Daily sign-ins", "action": "create", "reportType": "sign-in-anomalies",
          "scheduled": true, "bundleStatus": "active", "importedStatus": "disabled" }
      ] },
      "templates": { "create": 1, "update": 0, "items": [ { "id": "…", "name": "…", "action": "create" } ] },
      "recipientGroups": { "create": 0, "update": 0, "items": [] },
      "maintenanceWindows": { "create": 0, "update": 0, "items": [] },
      "settingsChanges": ["timezone", "alertThreshold"],
      "missingReferences": [
        { "ownerId": "…", "ownerName": "Daily sign-ins", "kind": "recipientGroup", "refId": "…" }
      ],
      "integration": { "provider": "microsoft365", "status": "disconnected", "connected": false },
      "activate": false
    }
  }
}
```

---

### Baselines

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/baselines/[jobId]` | Get baseline history for a job |

---

## Error Handling

### Typed Errors

| Error Class | HTTP Status | Retryable |
|-------------|-------------|-----------|
| `ValidationError` | 400 | No |
| `NotFoundError` | 404 | No |
| `VaultError` | 500 | No |
| `GraphAuthError` | 502 | No |
| `GraphApiError` | 502 | 429/5xx only |
| `DispatchError` | 502 | Yes |

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "GraphApiError",
    "message": "Permission denied by Microsoft Graph (403) on /users. The app registration is missing a required permission."
  }
}
```

**Never exposed:** Stack traces, secrets, internal paths.

---

## Authentication

Every endpoint except `GET /api/health` (status only when anonymous), `POST /api/auth/login`
and `POST /api/auth/logout` requires the operator access gate: an `argus_session` cookie or
`Authorization: Bearer <access key>`. Anonymous calls get `401 UnauthorizedError`.

| Method | Path | Body | Result |
|--------|------|------|--------|
| `POST` | `/api/auth/login` | `{ "accessKey": "argus_…" }` | Sets the 12-hour session cookie; `401` for a wrong key |
| `POST` | `/api/auth/logout` | — | Clears the session cookie |

See [SECURITY.md](./SECURITY.md#operator-access-gate).

### Run and activation contract

- `POST /api/jobs/:id/run` uses the same delivery preflight as the scheduler. On a paused
  job it runs as a diagnostic and never sends email.
- `POST /api/jobs`, `PUT /api/jobs/:id`, `POST /api/catalog/quick-enable` and
  `POST /api/onboarding/starter-pack` return `blockers` (`code`, `message`, `repairHref`);
  a job asked to be active that would email no one is saved with `status: "disabled"`.
  `deliveryMode: "none"` marks a job compute-only. Starter pack also returns `pausedCount`.
- Executions carry `trigger` (`scheduled` | `manual` | null for older rows),
  `deliveryStatus` and the new status `interrupted`.

### Alert incidents

`GET /api/alerts/incidents?limit=50` — recent failure-alert incidents: `jobId`, `openedAt`,
`closedAt`, `failureCount`, `notifyStatus` (`pending` | `accepted` | `failed` | `suppressed`),
`notifyAttempts`, `lastAttemptAt`, `nextAttemptAt`, `lastError`, `suppressionReason`.

### Capabilities (Microsoft 365)

| Method | Path | Body | Result |
|--------|------|------|--------|
| `GET` | `/api/integrations/microsoft365/capabilities` | — | `{ directoryWrites, groups: { read, deliver, directoryWrite }, lastVerified }` |
| `PUT` | `/api/integrations/microsoft365/capabilities` | `{ "directoryWrites": boolean }` | Opt in/out of Entra group writes (audited) |

`GET /api/integrations/microsoft365/required-permissions` also returns `groups`,
`directoryWrites` and `optional.directoryWrite`. Test Connection results include
`capabilities` and the effective sender (`steps.mailbox.address` / `source`). Individual accounts and roles are not built yet.

---

## Rate Limiting

None implemented. The bounded run queue (`ARGUS_MAX_CONCURRENT_RUNS`) prevents Graph API throttling from concurrent job executions.

---

## Conventions

- **Thin handlers** — Logic lives in services/DAOs, not route files
- **Force-dynamic** — `export const dynamic = "force-dynamic"` on routes that read DB
- **Error wrapping** — All handlers wrapped in try/catch, errors passed to `fail()`
- **No secrets in responses** — Vault values always masked
- **Idempotent operations** — PUT/DELETE safe to retry

---

**References:**
- [Services Layer](./SERVICES.md) — Business logic
- [Database Layer](./DATABASE.md) — Schema and DAOs
- [Architecture](./ARCHITECTURE.md) — System overview
