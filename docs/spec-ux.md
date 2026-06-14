# Argus — UX Specification

> Companion to [`workflow.md`](./workflow.md). The workflow doc defines *what* the
> user does; this spec defines *how it works in the UI* and *how we know it's right*
> (acceptance criteria). Engineering spec is [`spec.md`](./spec.md).

**Status:** Draft · **Last updated:** 2026-06-14

---

## 1. Navigation

The app has two navigation layers:

**Primary sidebar** — persistent across all pages:

```
Operate
  Dashboard   /dashboard
  Catalog     /catalog
  Logs        /logs
Configure
  Templates   /templates
  Settings    /settings
```

**Settings sub-navigation** — segmented tabs within `/settings`:

```
General       /settings            (default)
Integrations  /settings/integrations
Permissions   /settings/permissions
```

---

## 2. Workflow: Create a Report Job

**Entry:** Sidebar → **Catalog** (`/catalog`)

### UI

1. Catalog page shows report cards grouped by category (Identity, Security, Infrastructure, Custom).
2. Each card displays: name, description, category badge, required permission badges, baseline support indicator.
3. Card CTA: **"Create job"** link, not "Edit template".
4. Clicking a card navigates to a dedicated creation page at `/jobs/new?report=<reportId>`.

### Creation Page (`/jobs/new?report=<reportId>`)

The page is pre-selected for the report type. It contains:

| Field | Type | Notes |
|-------|------|-------|
| Job name | Text input | Pre-filled from report name, editable |
| Description | Textarea | Optional |
| Recipients | Text input | Comma-separated email addresses |
| Schedule | Segmented control | Preset picker or custom cron toggle |
| Preset options | Select | Hourly, Daily, Weekly, Monthly, Business days, Weekends |
| Custom cron | Text input + preview | Shows next 5 run times |
| Send condition | Select | Always, Count > N, Count changed, Anomaly, New items |
| Threshold | Number input | Visible only when condition = "Count > N" |
| Template | [Advanced] toggle | Collapsible section |

5. **[Advanced] Template section**, when expanded:
   - Dropdown to pick a template for this report type
   - Read-only preview with sample data
   - Link: "Open full template editor →" (opens `/templates?report=<reportId>` in a new tab)

6. **Create Job** button → `POST /api/jobs` → redirect to Dashboard.

### Acceptance Criteria

| ID | Check |
|----|-------|
| UX-C1 | Catalog cards show "Create job" CTA, not "Edit template" |
| UX-C2 | Clicking a card navigates to `/jobs/new?report=<reportId>` |
| UX-C3 | The creation page is pre-selected for the clicked report |
| UX-C4 | [Advanced] template section is collapsed by default |
| UX-C5 | Expanding [Advanced] shows template picker + preview + link to editor |
| UX-C6 | Creating a job redirects to Dashboard with the new job visible |

---

## 3. Workflow: Edit a Job

**Entry:** Dashboard → click **Edit** on a job card → `/jobs/<jobId>/edit`

### UI

1. Dashboard job cards gain an **Edit** button (alongside Run, Disable, Delete).
2. Clicking Edit navigates to `/jobs/<jobId>/edit`.
3. The edit page reuses the same form layout as the creation page, pre-populated from `GET /api/jobs/:id`.
4. All fields are editable: name, description, recipients, schedule, condition, template.
5. **Save** button → `PUT /api/jobs/:id` → scheduler re-registers the job → redirect to Dashboard.
6. A **Cancel** button returns to Dashboard without changes.

### Acceptance Criteria

| ID | Check |
|----|-------|
| UX-E1 | Dashboard job cards have an Edit button |
| UX-E2 | Clicking Edit navigates to `/jobs/<jobId>/edit` |
| UX-E3 | The form is pre-populated with the job's current values |
| UX-E4 | Saving updates the job and re-schedules it |
| UX-E5 | Execution history is preserved after editing |

---

## 4. Workflow: Edit Templates (Standalone)

**Entry:** Sidebar → **Templates** (`/templates`)

### UI

1. Left panel: scrollable list of all templates, grouped or sorted by report type.
2. Clicking a template loads it into the editor.
3. If accessed via `/templates?report=<reportId>`: auto-selects that report's default template.
4. Editor has two modes via a segmented toggle: **HTML** | **Text**.
5. **HTML mode**: edits `htmlBody`, live preview renders in an iframe with sample data.
6. **Text mode**: edits `textBody`, live preview shows plain-text with sample data.
7. **Subject** field is always visible regardless of mode.
8. **Variable insertion** buttons: `{{count}}`, `{{organization_name}}`, `{{anomalyBanner}}`, etc. Clicking inserts at cursor.
9. **Save Template** persists the current body. Both HTML and Text bodies are saved independently.
10. This page is **not** an entry point for creating a job. No "Create job" button here.

### Acceptance Criteria

| ID | Check |
|----|-------|
| UX-T1 | Template list shows all templates for all report types |
| UX-T2 | Clicking a template loads it into the editor |
| UX-T3 | Toggle switches between HTML and Text editor modes |
| UX-T4 | Each mode has its own body content (both persisted) |
| UX-T5 | Saving in HTML mode does not erase the Text body and vice versa |
| UX-T6 | Variable insertion buttons insert the correct `{{var}}` syntax |
| UX-T7 | No "Create job" button exists on this page |

---

## 5. Workflow: Run a Job Immediately

**Entry:** Dashboard → **Run** button on job card

### UI

1. Click **Run** on a job card.
2. Button immediately switches to **Running…** with a spinner, becomes disabled.
3. The job card's status indicator updates to a **running** state (animated pulse).
4. On completion (success / warning / failed / suppressed), the status pill updates and the button returns to **Run**.
5. The card auto-refreshes — no manual page reload needed.

### Acceptance Criteria

| ID | Check |
|----|-------|
| UX-R1 | Run button shows spinner + "Running…" on click |
| UX-R2 | Button is disabled while running |
| UX-R3 | Status pill shows running indicator during execution |
| UX-R4 | After completion, status updates to final state without page reload |
| UX-R5 | Button returns to "Run" state after completion |

---

## 6. Workflow: View Execution Logs

**Entry:** Sidebar → **Logs** (`/logs`)

### UI

1. Console-style viewer showing log entries across all jobs.
2. **Filter bar**: filter by level (All / Info / Warning / Error).
3. Each log line shows: level badge, timestamp, message.
4. Clicking a log line navigates to execution detail at `/executions/<id>`.

### Execution Detail (`/executions/<id>`)

1. **Identity bar**: execution ID, timestamp, status pill.
2. **Metric cards**: records processed, Graph API latency, duration, email sent status.
3. **Suppression alert** (if suppressed): reason displayed.
4. **Error alert** (if failed): error message displayed.
5. **Console**: all log entries for this execution, with timestamps.
6. **View report ↗** button (if rendered HTML exists): opens the report output in a new tab.

### Acceptance Criteria

| ID | Check |
|----|-------|
| UX-L1 | Logs page shows entries from all jobs |
| UX-L2 | Filter by level works (Info / Warning / Error) |
| UX-L3 | Clicking a log line navigates to execution detail |
| UX-L4 | Execution detail shows identity bar, metrics, alerts, console |
| UX-L5 | View report button opens rendered HTML when available |

---

## 7. Workflow: Configure Settings

**Entry:** Sidebar → **Settings** (`/settings`)

### 7.1 General Tab (`/settings` — default)

| Section | Fields |
|---------|--------|
| Master Key Status | Warning banner if `ARGUS_MASTER_KEY` is missing, showing `openssl rand -hex 32` command |
| Global Recipients | Text input for default email list (fallback when a job has no explicit recipients) |
| Admin Contacts | Text input for system alert recipients |
| Language | Segmented toggle: EN / HE |
| App Info | Version number display (read-only) |

### 7.2 Integrations Tab (`/settings/integrations`)

Each provider appears as a self-contained card:

**Microsoft 365 card:**

| Section | Content |
|---------|---------|
| Header | Provider name, status badge (Connected / Disconnected / Error) |
| Credentials | Inline fields: Tenant ID, Client ID, Client Secret (masked, show/hide), Shared Mailbox Email |
| Actions | **Save** button, **Test Connection** / **Reconnect** button |
| Health | Last check timestamp, test result display (pass/fail with latency) |
| Webhooks | Add URL form, webhook list with test/delete actions, delivery status |

**Future provider cards** (GCP, AWS, Custom Webhook) appear as placeholder cards with "Coming Soon" badge, following the same card pattern when implemented.

### 7.3 Permissions Tab (`/settings/permissions`)

| Section | Content |
|---------|---------|
| Status | Mailbox permission status (ok / missing / error) |
| Detail | Last checked timestamp |
| Action | **Re-validate** button — re-checks permissions |

### Acceptance Criteria

| ID | Check |
|----|-------|
| UX-S1 | Settings defaults to General tab |
| UX-S2 | General tab shows master key status, global recipients, admin contacts, language, app version |
| UX-S3 | Integrations tab shows M365 card with inline credential fields |
| UX-S4 | M365 card shows connection status (Connected/Disconnected/Error) |
| UX-S5 | Save encrypts credentials; Test Connection validates and updates status |
| UX-S6 | Webhooks section allows add, test, delete per webhook |
| UX-S7 | Permissions tab shows status and Re-validate button |

---

## 8. Workflow: First-Time Setup

1. Run `./install.sh` (or `./install.sh docker`).
   - Generates `ARGUS_MASTER_KEY` via `openssl rand -hex 32` into `.env`.
   - Installs dependencies, runs migrations, seeds default templates + integration.
   - Starts the dev server (or builds + runs Docker container).
2. Open the app → `/settings` → **General** tab.
3. If master key is missing: banner shows warning with command to generate one.
4. Navigate to **Integrations** tab.
5. In the M365 card, enter: Tenant ID, Client ID, Client Secret, Shared Mailbox Email.
6. Click **Save** → credentials encrypted at rest.
7. Click **Test Connection** → validates Graph API auth + mailbox permissions.
   - Shows pass/fail with latency and error details.
   - Status updates to Connected / Disconnected / Error.
8. **Ready.** Create first job from Catalog.

### Acceptance Criteria

| ID | Check |
|----|-------|
| UX-F1 | `./install.sh` generates master key, installs, migrates, seeds, and starts the server |
| UX-F2 | App boots without a master key and shows a warning banner in General tab |
| UX-F3 | Vault save encrypts credentials; vault test validates them |
| UX-F4 | After test passes, the M365 card shows Connected status |

---

## 9. Navigation Map

```
Dashboard  (/dashboard)              — All jobs, status, Run/Edit/Disable/Delete
Catalog    (/catalog)                — Browse reports → create job
  └── /jobs/new?report=<id>         — Dedicated creation page
Logs       (/logs)                   — Console log viewer
  └── /executions/<id>              — Execution detail
Templates  (/templates)              — HTML/Text template editor
  └── /templates?report=<id>       — Deep-link to specific report template
Settings   (/settings)               — General (default), Integrations, Permissions
  ├── /settings                     — General
  ├── /settings/integrations        — Provider cards + webhooks
  └── /settings/permissions         — Mailbox permission status
Jobs       (/jobs/<id>/edit)         — Edit job (reuses creation form)
           (/jobs/new?clone=<id>)   — Clone/duplicate (pre-filled creation)
```

---

## 10. Design Decisions

| Decision | Rationale |
|----------|-----------|
| Catalog cards → dedicated creation page | Clicking a report should start the creation flow, not redirect to template editing |
| Template editor is a separate workflow | Editing email HTML is an advanced action; primary path is parameterizing and creating a job |
| Template access in creation as [Advanced] toggle | Keeps creation focused; template customization available but not in the way |
| General is first/default settings tab | System-wide configuration is foundational; integrations are specific connections |
| Credentials live inline in each integration card | Each provider is self-contained; no need to switch tabs to enter or test credentials |
| Edit page reuses creation form | Same fields, same layout, pre-populated — minimal duplication |
| Run Now shows real-time feedback | Without visual feedback, the action feels like a black box |
| No "Create job" on Templates page | Prevents confusion between the two separate workflows |
| Quick setup presets for common patterns | Reduces decision fatigue — new users get a working job faster |
| Natural language schedule summary | "Runs every weekday at 9:00 AM" is easier to scan than raw cron |
| Tags for organization and filtering | Flat labels are simpler than nested folders for a small-to-mid number of jobs |
| Job health scoring | Consecutive failures on Dashboard demand attention without cluttering with alerts |
| Clone/duplicate instead of "copy" | "Duplicate" maps to a familiar mental model — like duplicating a file |

---

## 11. Future UX Enhancements (Research-Backed)

Enhancements sourced from studying Jenkins, Datadog Monitors, PagerDuty, Airflow, and
production cron-job management tools. These are **non-breaking additions** that slot
into the existing workflows.

### 11.1 Quick Setup Presets (Workflow 2 — Create Job)

At the top of the creation page, offer preset configurations for common patterns:

| Preset | Configures |
|--------|------------|
| **Send to email** | Recipients + Always send + Daily at 9 AM |
| **Report only (no send)** | Keep default template, set to Daily, condition = Never (manual run only) |
| **On-change alert** | Condition = Changed + Weekly |

The preset button pre-fills the form. The user can still tweak any field afterward.

| ID | Check |
|----|-------|
| UX-P1 | Creation page shows 2-3 preset cards above the custom form |
| UX-P2 | Clicking a preset pre-fills schedule, condition, and recipients |
| UX-P3 | Pre-filled fields remain editable after preset selection |

### 11.2 Natural Language Schedule + Cron Builder (Workflow 2 & 3)

Replace raw cron input with a schedule builder that outputs a plain-English summary:

```
Schedule: Daily at 9:00 AM       [▼]
  ┌─────────────────────────────┐
  │ Type: [Daily ○ Weekly ○     │
  │        ○ Monthly ○ Custom]  │
  │                             │
  │ Every [1] [day(s)    ▼]     │
  │ at [09:00]                  │
  │                             │
  │ Sundays only: [☐]           │
  │                             │
  │ ┌──────────────────────┐    │
  │ │ Next 5 runs:         │    │
  │ │ Mon 16 Jun 09:00     │    │
  │ │ Tue 17 Jun 09:00     │    │
  │ │ Wed 18 Jun 09:00     │    │
  │ │ Thu 19 Jun 09:00     │    │
  │ │ Fri 20 Jun 09:00     │    │
  │ └──────────────────────┘    │
  └─────────────────────────────┘
```

| ID | Check |
|----|-------|
| UX-PS1 | Schedule shows a natural language summary (e.g. "Every weekday at 9:00 AM") |
| UX-PS2 | Clicking summary opens a segmented picker (Daily / Weekly / Monthly / Custom) |
| UX-PS3 | Each picker type shows relevant fields (time, day-of-week, day-of-month) |
| UX-PS4 | **Next 5 runs** preview updates live as fields change |
| UX-PS5 | **Custom** mode shows traditional cron expression input + same 5-run preview |
| UX-PS6 | The natural language summary persists on the Dashboard job card |

### 11.3 Job Health Scoring (Workflow 4 — Dashboard)

Each job card shows a health indicator derived from recent execution history:

| Health State | Criteria | Visual |
|--------------|----------|--------|
| Healthy | Last 3 runs succeeded | No badge / subtle checkmark |
| Warning | 1 of last 3 failed | Amber pill |
| Critical | 2+ of last 3 failed, or last run failed with error | Red pill + inline message |
| Unknown | < 3 runs total or never run | Subtle "No data" indicator |

Health is computed client-side from the executions list returned by the dashboard API.

| ID | Check |
|----|-------|
| UX-H1 | Job cards show health state (none / warning / critical / unknown) |
| UX-H2 | Health is computed from the last 3 executions |
| UX-H3 | Clicking the health pill navigates to that job's execution history |

### 11.4 Execution Timeline / Sparkline (Workflow 4 & 6)

Job cards on Dashboard include a compact sparkline showing the last N runs:

```
┌───────────────────────────────────┐
│  Licenses Assigned       ● Healthy│
│  Every weekday at 9:00 AM         │
│  ▁▃▁▇▁▂▁▅▁█▁▃▁▁▂▁▁▁▅▁▁          │
│                    ↑ latest       │
│  Last run: 14 Jun 09:03 (0.4s)    │
│  Edit  [Run] [⋮]                  │
└───────────────────────────────────┘
```

Color-coded dots: green (success), amber (suppressed), red (failed), gray (skipped).

On the Execution Detail page (`/executions/<id>`), a larger timeline shows historical
runs for that job with the same color coding, clickable to navigate between executions.

| ID | Check |
|----|-------|
| UX-HL1 | Dashboard job cards show a sparkline of last 20 execution outcomes |
| UX-HL2 | Sparkline dots are color-coded (success/suppressed/failed/skipped) |
| UX-HL3 | Execution detail page shows a clickable timeline of historical runs |
| UX-HL4 | Timeline updates reactively when the page receives new execution data |

### 11.5 Clone / Duplicate Job (Workflow 3 — Edit Job)

Edit page gains a **Duplicate** action:

1. Click **Duplicate** on the edit page or from the Dashboard job card overflow menu.
2. Redirects to `/jobs/new?clone=<jobId>` — the creation form pre-populated with all
   settings from the source job, but **name** is suffixed with " (copy)".
3. User can adjust any field before creating.
4. Execution history is **not** copied — the clone starts fresh.

| ID | Check |
|----|-------|
| UX-CL1 | Edit page has a **Duplicate** button |
| UX-CL2 | Duplicate redirects to creation form pre-filled with source job settings |
| UX-CL3 | Cloned job name is suffixed with " (copy)" |
| UX-CL4 | Original execution history is not copied |

### 11.6 Tags / Labels (Workflow 2, 4, 6)

Free-form tags per job for filtering and organization:

**Creation page** (Workflow 2): Tags input — text field with comma/enter-to-add, pill display.

**Dashboard** (Workflow 4): Tag pills shown on job cards. **Filter bar** at the top
of Dashboard: filter by tag (dropdown of all unique tags across jobs), or search by
tag name. Only jobs matching ALL selected tags are shown.

**Logs** (Workflow 6): Same tag filter in the filter bar. Execution detail shows
the parent job's tags.

| ID | Check |
|----|-------|
| UX-TG1 | Creation form has a tags input (comma/enter to add, pill display) |
| UX-TG2 | Dashboard job cards display tag pills (truncated if >3) |
| UX-TG3 | Dashboard filter bar includes a tag multi-select filter |
| UX-TG4 | Selecting a tag filters to jobs that have that tag |
| UX-TG5 | Logs filter bar includes the same tag filter |
| UX-TG6 | Execution detail page shows the parent job's tags |

### 11.7 Bulk Operations (Workflow 4 — Dashboard)

A selection mode on Dashboard for batch actions:

1. Toggle **Select** mode (or cmd/ctrl+click individual cards).
2. Checkboxes appear on each job card.
3. Floating action bar appears at the bottom with count badge:

```
  3 selected   [Enable] [Disable] [Delete] [Deselect all]
```

4. **Delete** shows a confirmation dialog: "Delete 3 jobs? This cannot be undone."
5. Bulk disable/enable toggles job status without confirmation.
6. After bulk action, selection clears and the dashboard refreshes.

| ID | Check |
|----|-------|
| UX-B1 | Dashboard has a selection toggle or cmd/ctrl+click enables selection |
| UX-B2 | Checkboxes appear on each job card in selection mode |
| UX-B3 | Floating action bar shows selected count + action buttons |
| UX-B4 | Bulk disable/enable applies immediately without confirmation |
| UX-B5 | Bulk delete shows a confirmation dialog with count |
| UX-B6 | Selection clears and dashboard refreshes after action |
