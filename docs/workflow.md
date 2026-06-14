# Argus — User Workflows

> Living document — captures the intended user journeys through the application.
> Last updated: 2026-06-14

---

## 1. Create a Report Job (Primary Workflow)

**Entry:** Sidebar → **Catalog** (`/catalog`)

1. Browse the report catalog — cards grouped by category (Identity, Security, Infrastructure, Custom).
2. Click a report card.
3. → Navigate to a **dedicated creation page** for that report type (`/jobs/new?report=<reportId>`).
4. On the creation page, configure:

   | Field | Notes |
   |-------|-------|
   | Job name | Pre-filled from report name, editable |
   | Description | Optional |
   | Recipients | Email addresses, comma-separated |
   | Schedule | Preset picker (hourly/daily/weekly/monthly/business days/weekends) or custom cron expression with next-run preview |
   | Send condition | Always / Count > N / Count changed / Anomaly / New items |
   | Threshold | (if Count > N) |

5. **[Advanced]** — Expandable section for template customization:
   - Pick a different template from the ones available for this report type
   - Preview the template (read-only preview with sample data)
   - Link to full Template Editor for deeper edits (opens `/templates?report=<reportId>`)

6. Click **Create Job**.
7. → Job saved. Redirect to **Dashboard** (`/dashboard`).

---

## 2. Edit a Job

**Entry:** Sidebar → **Dashboard** (`/dashboard`)

1. See all jobs as cards with status, last run, next run.
2. Click a job card (or an "Edit" action).
3. → Navigate to the job's edit page (`/jobs/<jobId>/edit`).
4. Modify any field: name, description, recipients, schedule, condition, template.
5. Click **Save**.
6. → History preserved. Redirect to Dashboard.

---

## 3. Edit Templates (Separate Workflow)

**Entry:** Sidebar → **Templates** (`/templates`)

1. Browse all templates in a sidebar list.
2. Click a template → editor opens:
   - HTML / Text toggle
   - Live preview (auto-updates)
   - Variable insertion buttons (`{{count}}`, `{{organization_name}}`, etc.)
3. Click **Save Template**.
4. → Template updated for all jobs referencing it.

This workflow is **not** the entry point for creating a job. It is a standalone editor for maintaining email templates.

---

## 4. Run a Job Immediately

**Entry:** Dashboard (`/dashboard`) or execution detail page.

1. Click **Run** on a job card.
2. → Button switches to **Running…** with a spinner/pulse indicator. Disabled during run.
3. → Job card status pill updates to a **running** state (animated indicator).
4. → Execution runs: fetch → baseline → condition → render → deliver/suppress.
5. → On completion, status updates to Success / Warning / Failed / Suppressed.
6. → Button returns to **Run**. Card reflects the new status immediately.

---

## 5. View Execution Logs

**Entry:** Sidebar → **Logs** (`/logs`)

1. See all log entries in a console-style viewer.
2. Filter by level (info / warning / error).
3. Click a log line → execution detail page (`/executions/<id>`).
4. Detail page shows:
   - Full log output
   - Status and timestamps
   - Graph API latency
   - Records processed
   - Baseline comparison (if applicable)
   - Rendered report preview (HTML)
   - Delivery status (email sent / suppressed / webhook)

---

## 6. Configure Settings

**Entry:** Sidebar → **Settings** (`/settings`)

Two tabs: **General** (first/default) and **Integrations**. Mailbox permissions are not a separate tab — they live inside the Microsoft 365 vendor card under Integrations (permissions are vendor-specific).

### 6.1 General (default tab)

System-level settings not tied to any integration. Lives at `/settings`.

- **Global default recipients** — fallback email list when a job has no explicit recipients
- **Admin contacts** — notification targets for system-level alerts (e.g., connection failures)
- **Language** — EN / HE toggle (affects UI direction and date formatting)
- **Master key status** — shows whether `ARGUS_MASTER_KEY` is present; warning banner if missing
- **App version** — build version display

### 6.2 Integrations

Lives at `/settings/integrations`. Each vendor is a **collapsible card** containing its own credentials, status, permissions, and webhooks. The Microsoft 365 card is expanded by default.

**Microsoft 365 card** (expand to reveal):
- **Credential fields** (inline): Tenant ID, Client ID, Client Secret (masked), Shared Mailbox Email
- **Save** → credentials encrypted at rest in the vault
- **Connection status**: Connected / Disconnected / Error badge in the card header
- **Test Connection** / **Reconnect** button — validates Graph API auth + mailbox permissions. Shows result with latency details.
- **Mailbox permissions** (folded in from the old Permissions tab): Exchange Online permission status (ok / missing / error), last-checked timestamp, **Re-validate** button. Read-only mode when missing (reports render, email skipped).
- **Webhook management**:
  - Add webhook URL per endpoint (Slack, Teams, SIEM, etc.)
  - Name the webhook
  - Test / Delete webhooks
  - Delivery status shown per webhook

**Future provider cards** (collapsed placeholders):
- Google Cloud Platform — "Coming Soon"
- Amazon Web Services — "Coming Soon"
- Custom Webhook — "Coming Soon"
Each will follow the same pattern: collapsible card with inline credentials + status + permissions + webhooks.

---

## 7. First-Time Setup

1. **Run `./install.sh`** — generates `ARGUS_MASTER_KEY` into `.env` (via `openssl rand -hex 32`), installs dependencies, applies migrations, seeds default templates + integration, starts the dev server.
   - `./install.sh docker` — same but builds and runs the Docker container instead.
   - Idempotent: safe to re-run. Never overwrites an existing master key.

2. Open the app → `/settings` → **General** tab (default).

3. If `ARGUS_MASTER_KEY` is missing: banner warning appears in **General** tab. Generate one via `openssl rand -hex 32` and set it in the environment.

4. Open the **Integrations** tab. In the **Microsoft 365** card, enter credentials inline:
   - Tenant ID
   - Client ID
   - Client Secret (masked, show/hide toggle)
   - Shared Mailbox Email

5. Click **Save** → stored AES-256-GCM encrypted in the vault.

6. Click **Test Connection** → validates Graph API auth + mailbox permissions in one click. Shows pass/fail with latency details. Status updates to **Connected**.

7. **Ready.** Create first job from Catalog.

> **Note:** The Mailbox Setup Wizard (automated mailbox creation + RBAC) is defined in the PRD but not yet implemented. Current flow relies on manual Entra ID configuration.

---

## Navigation Map

```
Dashboard  (/dashboard)         — Overview of all jobs, status, actions
Catalog    (/catalog)           — Browse reports → create job
Logs       (/logs)              — Console-style execution log viewer
Templates  (/templates)         — Standalone HTML/text template editor
Settings   (/settings)          — General (default), Integrations
  ├── /settings                 — Global recipients, admins, language, master key, app version
  └── /settings/integrations    — Collapsible vendor cards: creds + status + permissions + webhooks
```

---

## 8. Future Upgrades

### 8.1 Better Job Management

- ✅ **Clone / Duplicate** — copy an existing job's config into a new job *(shipped)*
- ✅ **Bulk actions** — select multiple jobs to enable/disable/delete at once *(shipped)*
- ✅ **Tags / Labels** — organize jobs by team/environment; filter by tag on Dashboard + Logs *(shipped)*
- **Search & filter on Dashboard** — filter by status, report type, schedule, name *(tag filter shipped; name/status search pending)*

### 8.2 Richer Execution Feedback

- ✅ **Execution timeline** — sparkline on job cards + clickable run-history on the execution detail *(shipped)*
- **Compare two executions** — side-by-side diff of counts, baselines, and logs
- **Report output download** — download rendered HTML or raw CSV data

### 8.3 Proactive Health

- ✅ **Job health scoring** — healthy/warning/critical from the last 3 runs, on the dashboard card *(shipped)*
- ✅ **Schedule preview on creation** — "Next 5 runs" live preview in the creation form *(shipped)*
- **Job failure alerts** — notify admin contacts when a job fails N consecutive times
- **Snooze a job** — temporarily pause for N hours/days without disabling fully

### 8.4 Template Enhancements

- **Template version history** — track changes, revert to a previous version
- **Test send** — send a sample rendered report to yourself before the job fires

### 8.5 Settings & Platform

- ✅ **Timezone** — schedules fire and preview in a configured IANA zone *(shipped)*
- ✅ **Data retention** — configurable baseline-prune window (was hardcoded 90 days) *(shipped)*
- ✅ **From-address / Reply-To** — outbound report sender overrides *(shipped)*
- ✅ **Granular permission validation** — Test Connection lists the exact missing Graph scopes *(shipped)*
- **One-click permission grant** — bootstrap admin-consent + programmatic appRole assignment ([`spec`](./spec-settings-and-catalog.md) Workstream D)
- **Backup / export–import** — dump and restore jobs + templates + non-secret settings as JSON
- **Notification digest / quiet hours** — batch and defer alerts during configured windows
- **Auth / RBAC** — login gate (PRD A1 single-tenant assumption remediation)

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Catalog cards → dedicated creation page | Clicking a report should start the creation flow, not redirect to template editing. Template editing is secondary. |
| Template editor is a separate workflow | Editing email HTML is an advanced action. The primary path is parameterizing and creating a job. |
| Template access in creation as "Advanced" toggle | Keeps the creation flow focused. Users who need a custom template can find it, but it's not in the way. |
| No inline "Create job" form on Catalog sidebar | The cards themselves are the entry point. A sidebar form duplicates the flow without template selection context. |
