# Argus — Spec: Settings & Platform + Catalog Reports

> Defines **what to build** for two workstreams and **how we know it's right** (testable
> acceptance criteria). Hands off to `plan` → `build`. Companion: [`workflow.md`](./workflow.md),
> [`new-reports.md`](./new-reports.md), [`spec-ux.md`](./spec-ux.md).

**Status:** Draft · **Last updated:** 2026-06-14

---

## Grounding (current code)

| Concern | Where | Current state |
|---------|-------|---------------|
| Settings store | `src/db/dao/settings.ts`, `schema.ts` `settings` table | Singleton row: `masterKeyHash, globalRecipients, adminContacts, lastPermissionCheck, permissionStatus, language`. No tz / retention / from-address. |
| Settings API | `src/app/api/settings/route.ts`, `lib/validation.ts` `settingsInputSchema` | GET returns row + `appVersion` + `masterKeyPresent`. PUT validates `globalRecipients, adminContacts, language, permissionStatus`. |
| Baseline prune | `src/db/dao/baselines.ts` `prune(olderThanDays = 90)` | Default 90 hardcoded; caller passes no arg. |
| Scheduler | `src/services/scheduler.ts` | `cron.schedule(expr, cb)` — **no `{ timezone }`** passed → fires in server-local TZ. |
| Schedule preview | `src/lib/cron.ts` `nextRuns()` | Pure JS `Date` (server-local). No TZ awareness. |
| Graph transport | `src/services/graph/client.ts` `GraphTransport` | `get<T>(path) → GraphPage{value, latencyMs, truncated}` + optional `batch`. **No `getCsv`.** |
| Report defs | `src/services/reports/{types.ts,registry.ts,catalog-new.ts}` | `ReportDefinition<Row>{fetch(transport,params), summarize}`. Registered in `registry.ts` map. Category enum: `identity\|security\|infrastructure\|custom`. |
| Template seeding | `src/db/seed.ts` | Iterates `listReports()`, creates one default template per report (idempotent). |

**LTM:** report engine is a pluggable transport seam (mem #603); A1 = no UI auth, single-tenant assumption flagged as prod gap (#599); bun-test per-file singleton leakage gotcha (#602) — keep settings cache test-safe.

---

## Workstream A — Settings & Platform (workflow.md §8.5)

Each setting is a **column on the `settings` singleton** + field in `settingsInputSchema` + UI control in the General tab, unless noted. One migration adds all new columns.

### A1. Schedule Timezone

Schedules currently fire in server-local time, which is ambiguous in containers (usually UTC).

- New `settings.timezone` (text, default `"UTC"`, IANA name e.g. `Asia/Jerusalem`).
- Scheduler passes `{ timezone }` to `cron.schedule(expr, cb, { timezone })`.
- `nextRuns()` preview + Dashboard "next run" + `describeSchedule` summary render in the configured TZ.
- General tab: timezone select (IANA list or grouped common zones).

| ID | Acceptance criterion |
|----|----------------------|
| ST-1 | `settings.timezone` persists via PUT `/api/settings`; defaults to `UTC`. |
| ST-2 | Scheduler registers tasks with the configured `{ timezone }`; a job set to `0 9 * * *` in `Asia/Jerusalem` fires at 09:00 Israel time, not server time. |
| ST-3 | Schedule preview ("Next 5 runs") and Dashboard "Next run" display times in the configured TZ with the zone abbreviation. |
| ST-4 | Changing the timezone re-registers existing jobs (no restart). |

### A2. Data Retention Window

`baselinesDao.prune(90)` default is hardcoded; admins can't tune DB growth vs. history depth.

- New `settings.retentionDays` (integer, default `90`, min `7`).
- The prune caller (executor / scheduled maintenance) reads `settings.retentionDays` and calls `prune(retentionDays)`.
- Optionally also prune `executions`/`logs` older than the window (currently append-only, unbounded).

| ID | Acceptance criterion |
|----|----------------------|
| RT-1 | `settings.retentionDays` persists; PUT rejects `< 7`. |
| RT-2 | Baseline prune uses the configured window (rows older than N days removed; rows inside kept). |
| RT-3 | General tab shows a retention input (days) with helper text. |
| RT-4 | (Stretch) executions + logs older than `retentionDays` are pruned on the same pass. |

### A3. Default From-Address / Reply-To

Outbound report email is sent from the shared mailbox; admins want a friendly From / Reply-To.

- New `settings.fromAddress` (text, nullable) + `settings.replyTo` (text, nullable, email).
- Email send path uses `fromAddress ?? mailbox` for the From header and sets `Reply-To` when present.

| ID | Acceptance criterion |
|----|----------------------|
| FR-1 | `fromAddress`/`replyTo` persist; PUT validates `replyTo` as email when set. |
| FR-2 | Sent mail uses `fromAddress` when set, else falls back to the configured mailbox. |
| FR-3 | `replyTo`, when set, appears as the Reply-To header. |
| FR-4 | Empty/unset values preserve current behavior (mailbox as From, no Reply-To). |

### A4. Notification Digest / Quiet Hours

Reduce alert noise: batch per-execution notifications and suppress during quiet hours.

- New `settings.quietHoursStart` / `settings.quietHoursEnd` (text `HH:mm`, nullable) + `settings.digestEnabled` (boolean default false).
- During quiet hours (in the configured TZ), suppress immediate webhook/admin alerts; queue and flush after the window.

| ID | Acceptance criterion |
|----|----------------------|
| QH-1 | Quiet-hours window persists; alerts generated inside the window are deferred, not dropped. |
| QH-2 | Deferred alerts flush once the window ends (or on the next run outside it). |
| QH-3 | With `digestEnabled`, multiple suppressed-run alerts in a window collapse into one digest. |
| QH-4 | Outside quiet hours / digest off → current immediate behavior unchanged. |

> **Priority:** A4 is the heaviest (needs a deferred-alert queue). Plan it last in Workstream A.

### A5. Backup / Export–Import

Disaster recovery + environment promotion: dump and restore the config.

- `GET /api/backup` → JSON `{ version, exportedAt, jobs[], templates[], settings(non-secret) }`. **Excludes vault ciphertext + master key.**
- `POST /api/backup/import` (JSON) → upserts jobs + templates + non-secret settings; re-registers schedules.
- General tab: **Export** (download JSON) + **Import** (file picker, confirm dialog).

| ID | Acceptance criterion |
|----|----------------------|
| BK-1 | Export returns jobs + templates + non-secret settings; contains **no** vault values or master key. |
| BK-2 | Import round-trips: export → wipe → import reproduces jobs + templates (execution history not restored). |
| BK-3 | Imported active jobs are re-registered with the scheduler. |
| BK-4 | Malformed import payload returns 400 without partial writes (transactional). |

### A6. Auth / RBAC (PRD A1 remediation) — separate epic

Currently no UI auth (single-tenant assumption, mem #599). Minimum viable: single shared admin password → signed session cookie → middleware gate on all routes except `/api/health`.

| ID | Acceptance criterion |
|----|----------------------|
| AU-1 | With `ARGUS_AUTH_PASSWORD` set, unauthenticated requests to app/API (except health + login) redirect/401. |
| AU-2 | Correct password issues an HTTP-only signed session cookie; logout clears it. |
| AU-3 | With no password configured, behavior is unchanged (opt-in), but General tab shows an "unauthenticated" warning. |

> **Scope flag:** A6 is a security epic touching every route (middleware, login page, session signing). Recommend its **own spec + plan**; included here only for completeness. Plan should treat A6 as optional/last.

### A7. workflow.md §8 housekeeping (docs only)

- Mark shipped §8 items ✅: Clone/Duplicate, Bulk actions, Tags/filter (8.1); Schedule preview (8.3); Execution timeline/sparkline (8.2).
- Add **§8.5 Settings & Platform** referencing A1–A6.

| ID | Acceptance criterion |
|----|----------------------|
| DOC-1 | §8 marks the five shipped items as done. |
| DOC-2 | New §8.5 lists A1–A6 with one-line intent each. |

---

## Workstream B — Catalog Reports (new-reports.md Tier 2/3)

Tier 1 (`secure-score`, `provisioning-summary`, `risky-service-principals`) already shipped in `catalog-new.ts`. This workstream adds the CSV transport seam + CSV reports + remaining JSON reports.

### B1. CSV Transport Seam (enabling infra)

CSV usage reports return `302 → pre-authed CSV`. Add an optional method to `GraphTransport`:

```ts
getCsv(path: string): Promise<{ headers: string[]; rows: Record<string, string>[]; latencyMs: number }>;
```

- `liveGraphTransport.getCsv` follows the redirect (SDK `responseType` text / stream), parses CSV (header row → keyed rows), measures latency, applies the same `withRetry` + `GraphApiError` contract as `get`.
- Report defs that need CSV guard `if (!transport.getCsv) throw new Error(...)` so the fake transport in unit tests must provide it.

| ID | Acceptance criterion |
|----|----------------------|
| CSV-1 | `getCsv` returns parsed `{headers, rows}` from a CSV body; quoted fields + commas-in-quotes handled. |
| CSV-2 | `getCsv` surfaces Graph errors as `GraphApiError` and honors retry/throttle like `get`. |
| CSV-3 | `latencyMs` is measured and returned (parity with `GraphPage`). |
| CSV-4 | A report calling `getCsv` against a fake transport (injected rows) summarizes correctly with no network. |

### B2. CSV Usage Reports (`Reports.Read.All`)

New file `src/services/reports/catalog-csv.ts`. Each `ReportDefinition.fetch` calls `transport.getCsv`. Category `infrastructure`. All require `Reports.Read.All`.

| ID | Report | Endpoint | Key metric (`count`) |
|----|--------|----------|----------------------|
| `teams-user-activity` | Teams User Activity | `/reports/getTeamsUserActivityUserDetail(period='D7')` | inactive licensed users |
| `mailbox-quota` | Mailbox Quota Status | `/reports/getMailboxUsageDetail(period='D7')` | mailboxes near quota |
| `m365-groups-activity` | M365 Groups Activity | `/reports/getOffice365GroupsActivityDetail(period='D7')` | stale / external-heavy groups |
| `onedrive-usage` | OneDrive Storage & Quota | `/reports/getOneDriveUsageAccountDetail(period='D7')` | accounts near quota |
| `sharepoint-site-usage` | SharePoint Site Usage | `/reports/getSharePointSiteUsageDetail(period='D7')` | inactive sites |
| `email-activity` | Email Activity | `/reports/getEmailActivityUserDetail(period='D7')` | low/zero-activity users |
| `active-users-counts` | Active Users per Service | `/reports/getOffice365ServicesUserCounts(period='D7')` | inactive-per-service |

| ID | Acceptance criterion |
|----|----------------------|
| RPT-CSV-1 | Each report registers in `registry.ts`; `listReports()` length increases by 7 (→ 22). |
| RPT-CSV-2 | Each `summarize` returns `count` + `variables` + `rows` from parsed CSV rows. |
| RPT-CSV-3 | `seed()` creates a default template for each new report (idempotent); count assertions updated. |
| RPT-CSV-4 | Catalog UI shows each with `Reports.Read.All` permission badge + correct category. |
| RPT-CSV-5 | Per-report unit test feeds fake CSV rows → asserts summarized metrics. |

### B3. Tier-3 JSON Reports (drop-ins)

Append to `catalog-new.ts` (or `catalog-tier3.ts`). Same JSON pattern as Tier 1.

| ID | Report | Endpoint | Permission |
|----|--------|----------|-----------|
| `risk-detections` | User Risk Detections | `/identityProtection/riskDetections` | `IdentityRiskEvent.Read.All` |
| `sp-risk-detections` | SP Risk Detections | `/identityProtection/servicePrincipalRiskDetections` | `IdentityRiskyServicePrincipal.Read.All` |
| `custom-attr-audits` | Custom Security Attribute Audit | `/auditLogs/customSecurityAttributeAudits` | `AuditLog.Read.All` |
| `sp-sign-ins` | Service Principal Sign-Ins | `/auditLogs/signIns?$filter=signInEventTypes/any(t:t eq 'servicePrincipal')` | `AuditLog.Read.All` |

| ID | Acceptance criterion |
|----|----------------------|
| RPT-JSON-1 | Each registers; `listReports()` grows by 4 (→ 26 with B2). |
| RPT-JSON-2 | Each `summarize` derives metrics; unit-tested with injected rows. |
| RPT-JSON-3 | `seed()` template count assertions updated to final total. |
| RPT-JSON-4 | `sp-sign-ins` beta-filter path documented as best-effort (v1.0 filter may 400 on some tenants) — fetch failure surfaces as a normal execution error, not a crash. |

---

## Workstream D — One-click permission grant (from live testing)

Tenant admin grants Argus's missing Graph permissions from the UI, no Entra portal hopping. Two parts.

### D1. Bootstrap — authorize self-management (admin-consent link)

An app cannot grant itself new permissions without elevated write scopes. One-time:
- Operator adds `Application.ReadWrite.All` + `AppRoleAssignment.ReadWrite.All` to the Argus app registration (manual, once — these two can't be self-declared).
- Settings → Integrations → **Authorize self-management** button opens
  `https://login.microsoftonline.com/{tenantId}/adminconsent?client_id={clientId}&redirect_uri={argus}/settings/integrations&state=…`
- Admin signs in + consents; returns to Argus, which re-runs Test Connection.

| ID | Acceptance criterion |
|----|----------------------|
| GRANT-1 | Bootstrap button builds the admin-consent URL from stored tenantId+clientId + the app's own origin redirect; opens it. |
| GRANT-2 | On return, Argus re-tests and reflects whether the elevated scopes are now granted. |

### D2. Programmatic grant of missing scopes

`POST /api/integrations/microsoft365/grant` (needs the elevated scopes from D1):
1. Read the Microsoft Graph resource SP `appRoles`; resolve each missing scope name → `appRoleId`.
2. PATCH `/applications/{appObjectId}` `requiredResourceAccess` to **declare** the missing roles (portal reflects them).
3. POST `/servicePrincipals/{argusSpId}/appRoleAssignments` per missing role (= **grant/consent**).
4. Re-run `testConnection`; return the updated `missing[]`. Audit the action.

UI: Integrations → M365 card shows **Grant missing permissions** when `missing > 0`.

| ID | Acceptance criterion |
|----|----------------------|
| GRANT-3 | With elevated scopes present, `/grant` creates an appRoleAssignment per missing role; the missing list clears after re-test. |
| GRANT-4 | `/grant` also declares each role on the application manifest. |
| GRANT-5 | Without the elevated scopes, `/grant` returns a clear, non-crashing error pointing to the D1 bootstrap. |
| GRANT-6 | Operates only on the configured `microsoft365` app; the action is written to the audit/log. |
| GRANT-7 | Pure helpers (scope-name→appRoleId resolution, requiredResourceAccess builder) unit-tested with injected Graph data. |

> **Security:** privilege-escalation surface — legitimate tenant-admin self-service for their own app. Gated by: elevated scopes already admin-consented, configured app only, audit log, and (future) the A6 auth gate.

## Out of scope / assumptions

- **A6 Auth/RBAC** is acknowledged but recommended as its own spec/plan; this plan treats it as optional/last.
- A new `collaboration` category is **not** introduced (avoids touching the category enum + UI metadata); CSV reports use `infrastructure`.
- CSV transport assumes the Graph SDK follows the 302 to CSV; if the tenant returns the redirect un-followed, the plan adds an explicit `fetch(location)` step.
- All new permissions are documented in `requiredPermissions` for the catalog UI; granting them in Entra is an operator task (out of code scope).

## Final tallies (for test assertions)

- Catalog: 15 → **26** reports (15 + 7 CSV + 4 JSON).
- Seeded templates: 15 → **26**.
- Settings columns added: `timezone, retentionDays, fromAddress, replyTo, quietHoursStart, quietHoursEnd, digestEnabled` (+ optional auth).
