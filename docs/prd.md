

# Product Requirements Document (PRD)

## Argus — Microsoft 365 Admin Notification System

***

## 1. Executive Summary

Argus is a self-hosted, Dockerized notification platform built for IT administrators and security teams managing Microsoft 365 tenants. It provides a Jenkins-inspired operational model — Jobs, Executions, Logs, and a Catalog — but demands a modern, premium UI/UX that avoids "AI slop" or dated dashboard tropes.

The system connects to Microsoft Graph API using least-privilege application permissions, schedules automated report queries, generates HTML reports, and delivers them via email from a scoped shared mailbox. The entire stack runs inside a single Docker container using Next.js, Bun, TypeScript, SQLite, and Drizzle ORM.

***

## 2. Goals & Objectives

- Replace manual Graph API querying with automated, schedulable jobs
- Provide a single pane of glass for M365 admin notifications across identity, security, and compliance
- Enforce strict least-privilege security via Exchange Online RBAC for Applications
- Deliver beautiful, context-rich HTML email reports with full audit trails
- Maintain full execution history with console-like logs and performance metrics
- Allow on-the-fly editing of jobs, schedules, and templates without redeployment
- Support manual ad-hoc execution for emergency scenarios
- Compare current data against organizational baseline to surface anomalies and trends
- Store all sensitive credentials in an encrypted application vault, configurable entirely via the web UI
- Automate the creation of the restricted shared mailbox and Exchange Online RBAC setup via one-time admin consent
- Provide an extensible Integrations framework for future multi-vendor support

***

## 3. Target Audience

| Persona | Primary Need |
|---------|-------------|
| M365 / Entra ID Administrator | Identity alerts, sign-in anomalies, risky users |
| Security Operations Analyst | Security digest, DLP alerts, conditional access failures |
| Cloud Infrastructure Engineer | License utilization, app secrets expiry, device compliance |
| MSP / Multi-Tenant Technician | Standardized reporting across customer tenants |

***

## 4. Functional Requirements

### 4.1 Web Application — Frontend

#### Dashboard (Home)
- Jenkins-style overview of all configured jobs
- Each job displayed as an actionable card / tile showing:
  - Job name and description
  - Last execution status (Success / Warning / Failed / Disabled / Suppressed)
  - Last execution timestamp and duration
  - Next scheduled run
  - Quick actions: Run Now, Edit, Disable/Enable, View Logs
- Filterable by status, report type, or search term

#### Catalog
- Library of built-in report types (see Section 10)
- Each report card shows: description, required Graph API permissions, estimated data volume, baseline support indicator
- "Create Job" flow: Select from Catalog → Configure parameters → Set recipients → Choose schedule → Pick template → Set conditional logic → Save

#### Jobs Management
- CRUD operations for scheduled jobs
- Job configuration includes:
  - Report type and parameters (JSON configuration per type)
  - Recipients list (individual emails, distribution groups, or global default)
  - Schedule: Natural language picker OR custom cron expression
    - Presets: Every hour, Daily, Weekly (Mon), Monthly (1st), Business days only, Weekends only
    - Custom: Full cron expression input with live preview of next 5 runs
  - HTML template selection (or default)
  - Conditional execution rules (see 4.4)
  - Active / Disabled toggle
  - Human-readable description
- Execution history table per job (last N runs, paginated)
- Edit job without losing execution history

#### Logs
- Centralized execution log viewer
- Filterable by: job, date range, status, execution ID
- Per-execution details:
  - Execution ID and timestamps
  - Duration and Graph API latency
  - Records processed / returned
  - Baseline comparison results (if applicable)
  - Conditional evaluation result (why it was sent or suppressed)
  - Email send status and recipient list
  - Webhook delivery status per endpoint
  - Full error stack traces and warning messages
- Console-like monospace output for traces

#### Integrations Hub (Settings — Top Section)
- Visual integration cards showing all connected services
- Microsoft 365 card (primary, always present):
  - Status: Connected / Disconnected / Error
  - Tenant name and ID (masked)
  - Permissions granted list
  - Last sync / health check timestamp
  - "Configure" button → opens M365 setup wizard
  - "Disconnect" button (clears vault credentials)
- Placeholder cards for future integrations:
  - Google Cloud Platform (GCP) — "Coming Soon"
  - Amazon Web Services (AWS) — "Coming Soon"
  - Custom Webhook — "Coming Soon"
  - Each card shows: logo, name, description, status badge
- Add Integration button — opens marketplace-style modal with available connectors
- Extensible architecture: adding a new integration requires only backend connector + frontend card component

#### Settings & Encrypted Vault
- Secure Credential Vault — All sensitive credentials stored in an encrypted SQLite table, never in .env files
- Vault UI — Settings page provides secure input fields for:
  - Entra ID Tenant ID
  - Entra ID Client ID
  - Entra ID Client Secret (masked, password-type input)
  - Exchange Online shared mailbox email
  - Global default recipients
- Field masking — Client Secret displayed as bullets with toggle to show/hide
- Vault encryption — AES-256-GCM encryption using a master key
- Master key — Provided via single environment variable ARGUS_MASTER_KEY on first deployment. If missing, the app prompts in UI to generate one.
- Quick Health Check Button — Prominent button in Settings: "Test Connection"
  - Validates Graph API token acquisition
  - Validates mailbox permission status
  - Shows real-time results: Green checkmark + latency, or Red X + exact error
  - If credentials are wrong, shows which step failed (auth vs. mailbox)

#### Mailbox Setup Wizard (Core Workflow)
- Guided wizard for creating and restricting the shared mailbox
- Step 1 — Create Mailbox:
  - Input: desired email address (e.g., alerts@tenant.com)
  - Input: display name
  - Button: "Create Shared Mailbox"
  - Behind the scenes: Graph API POST /users or Exchange Online PowerShell via one-time admin consent
  - Shows progress: Creating → Assigning license → Done
- Step 2 — Assign License:
  - Detects if tenant has available Exchange Online licenses
  - Shows available licenses and auto-assigns (or guides admin to assign manually)
- Step 3 — Restrict Permissions (RBAC):
  - Shows current state: "App has broad Mail.Send — NOT SECURE"
  - Button: "Apply Least-Privilege Restriction"
  - Behind the scenes:
    - New-ManagementScope -Name "ArgusScope" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'alerts@tenant.com'"
    - New-ManagementRoleAssignment -Name "ArgusSendMail" -Role ApplicationImpersonation -App <ClientId> -CustomRecipientWriteScope "ArgusScope"
  - Shows progress: Creating scope → Creating role assignment → Validating → Done
- Step 4 — Validate:
  - Runs permission audit automatically
  - Green checkmark: "Argus can only send from alerts@tenant.com"
  - If fails: shows exact error and remediation commands
- Step 5 — Revoke One-Time Permissions:
  - After successful setup, Argus displays the elevated permissions that were used
  - Admin is prompted to remove these one-time permissions from the Entra ID app registration
  - UI shows exactly which Graph API permissions to remove (e.g., User.ReadWrite.All, Exchange.ManageAsApp if used)
- Manual Override:
  - If admin prefers manual setup, wizard shows collapsible "Manual Commands" section with exact PowerShell to run
  - Admin can skip wizard and paste mailbox email manually in Vault

#### Manual Report Trigger
- "Run Now" button on any existing job
- Bypasses cron schedule immediately
- Shows real-time execution progress in UI
- Generates and sends report on-demand
- Respects conditional logic and baseline comparison even in manual runs

#### HTML Template Editor
- Preview HTML reports before sending
- Inline CSS support (Outlook-compatible)
- Variable injection: {{tenantName}}, {{alertCount}}, {{severityTable}}, {{timestamp}}, {{baselineDelta}}, {{trendUp}}, {{trendDown}}, etc.
- Template gallery with default templates per report type
- Edit existing templates or create custom ones
- Template quality guardrails: Every template must include at least one data-driven insight section (not just "here is your report")

### 4.2 Backend Services

| Service | Responsibility |
|---------|-------------|
| API Layer | RESTful endpoints, auth, validation |
| Graph API Service | Abstracted MS Graph calls with retry logic, throttling, pagination, delta queries |
| Report Engine | Generates HTML from templates + data + baseline analysis |
| Email Dispatcher | Sends via Graph API /users/{mailbox}/sendMail |
| Cron Service | Polls job schedules and triggers execution engine |
| Permission Auditor | Validates Exchange Online mailbox permissions on startup and periodically |
| Baseline Service | Stores historical aggregates, computes trends, detects anomalies |
| Vault Service | Encrypts and decrypts credentials using master key |
| Mailbox Provisioner | Creates shared mailbox, assigns license, applies RBAC restrictions |
| Integration Manager | Manages connected services, their status, and connectors |
| Webhook Dispatcher | Sends suppressed execution notifications to configured webhooks |

### 4.3 Core Workflows

| Workflow | Steps |
|----------|-------|
| Create Job | Catalog → Select report → Configure params → Recipients → Schedule (preset or cron) → Template → Conditional rules → Save |
| Edit Job | Jobs list → Edit → Modify any field → Save (history preserved) |
| Run Now | Job card → Run Now → Execute immediately → Evaluate conditions → Compare baseline → Generate report → Show real-time log → Email sent or suppressed |
| View Logs | Job → Logs → Filter → Click execution → Full details + baseline delta + email preview |
| Setup Mailbox | Settings → Integrations → M365 → Mailbox Setup Wizard → Create mailbox → Assign license → Apply RBAC restriction → Validate → Revoke one-time permissions |
| Permission Remediation | System detects missing mailbox permissions → Status in Settings → Provide exact PowerShell commands → Admin executes → System re-validates |
| First Setup | Open Settings → Enter credentials in Vault UI → Run Mailbox Setup Wizard → Click "Test Connection" → Green = ready to create jobs |

### 4.4 Conditional Execution & Baseline

#### Conditional Execution Rules (per job)
Every job can define when it should actually send an email:

| Rule | Description |
|------|-------------|
| Always send | Send regardless of data |
| Send if count > N | Only send if record count exceeds threshold |
| Send if count changed | Only send if different from last run |
| Send if anomaly detected | Only send if baseline comparison shows significant deviation |
| Send if new items | Only send if delta query returns new records since last run |

#### Suppressed Execution Webhooks
- When a job is suppressed (conditions not met), Argus checks if webhook URLs are configured for the integration
- **Multiple webhook URLs per integration** — Admin can add unlimited webhook endpoints (e.g., one for Slack, one for Teams, one for custom SIEM)
- Each webhook configured with:
  - URL, name, secret header (optional), enabled/disabled toggle
  - Custom payload template (optional) — override default JSON structure
- **Default payload includes full report HTML**:
  - executionId, jobId, jobName, suppressionReason, timestamp, baselineSnapshot, recordsProcessed
  - **fullHtml**: The complete generated HTML report (so webhook receiver can render or forward it)
  - **metadata**: Graph API latency, query parameters, tenant name
- Admin can toggle "Include full HTML" per webhook (default: on)
- Retry logic: 3 attempts with exponential backoff per webhook URL
- Failed webhook deliveries logged individually per URL
- Webhook delivery status shown in execution logs

#### Baseline System
- After every execution, Argus stores aggregated metrics in a baselines table
- Baselines are per-job and per-tenant: average record count, average severity distribution, typical failure rates
- When a job runs, the Report Engine compares current results against the baseline
- Anomaly detection: If current count is >2 standard deviations from baseline, flag as anomaly
- Trend detection: Compare against last 7 days, 30 days, previous period
- Baseline variables available in templates: {{baselineAvg}}, {{baselineDelta}}, {{trendDirection}}, {{trendPercent}}
- Auto-pruning: Baseline data older than 90 days is automatically pruned to prevent database bloat

#### Suppression Behavior
- If conditions are not met, the execution is marked as Suppressed (not Failed)
- Log shows exactly why: "Suppressed: count (3) below threshold (5)" or "Suppressed: no anomaly detected against baseline"
- Admin can still view the generated report in the UI even if suppressed
- Webhook notification sent if configured

***

## 5. Non-Functional Requirements

- Security: Least-privilege only. No broad Mail.Send. Exchange Online RBAC scoped to single mailbox. All secrets encrypted at rest via AES-256-GCM. Master key never stored in database.
- Performance: Dashboard loads < 2 seconds. Graph API queries paginated with delta support where applicable. Report generation < 5 seconds for < 10,000 records.
- Reliability: Failed jobs retry 3 times with exponential backoff. Logs immutable. SQLite with WAL mode.
- Internationalization: Full English and Hebrew support. RTL layout for Hebrew. UI direction flips automatically.
- Deployability: Docker Compose, single docker-compose up, no external dependencies beyond MS Graph API. No .env secrets required.
- Observability: Health check endpoint, execution metrics, Graph API latency tracking, webhook delivery status.

***

## 6. Architecture & Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Bun 1.1+ | Fast JS/TS runtime, bundler, package manager |
| Framework | Next.js 14 (App Router) | SSR, API routes, React Server Components |
| Language | TypeScript | Type safety end-to-end |
| Database | SQLite (Bun native) | Job configs, execution logs, templates, baselines, settings, encrypted vault |
| ORM | Drizzle ORM | Type-safe SQL queries |
| Encryption | crypto (Node.js/Bun built-in) | AES-256-GCM for vault |
| Styling | Tailwind CSS | Utility-first CSS |
| Components | shadcn/ui | Accessible, customizable primitives |
| Cron | node-cron (Bun-compatible) | In-app scheduling |
| Graph API | @microsoft/microsoft-graph-client | MS Graph abstraction |
| Auth | Entra ID Client Credentials | Daemon / app-only flow |
| Email | Graph API sendMail | Scoped to dedicated mailbox |

***

## 7. Data Model

### jobs
- id: string (PK)
- name: string
- description: string
- reportType: string
- params: JSON
- scheduleType: "preset" | "cron"
- schedulePreset: string | null
- cronExpression: string | null
- templateId: string (FK)
- recipients: JSON
- conditionalRules: JSON
- status: "active" | "disabled"
- createdAt: datetime
- updatedAt: datetime

### executions
- id: string (PK)
- jobId: string (FK)
- status: "success" | "warning" | "failed" | "suppressed"
- startedAt: datetime
- endedAt: datetime
- recordsProcessed: number
- graphApiLatencyMs: number
- errorMessage: string | null
- outputHtml: string | null
- emailSent: boolean
- emailRecipients: JSON
- suppressionReason: string | null
- baselineSnapshot: JSON | null
- webhookDelivered: boolean
- webhookError: string | null
- createdAt: datetime

### logs
- id: string (PK)
- executionId: string (FK)
- level: "info" | "warning" | "error"
- message: string
- timestamp: datetime

### baselines
- id: string (PK)
- jobId: string (FK)
- metricName: string
- metricValue: number
- windowDays: number
- calculatedAt: datetime

### templates
- id: string (PK)
- name: string
- reportType: string | "generic"
- subject: string
- htmlBody: string
- isDefault: boolean
- language: "en" | "he"

### vault (encrypted credentials)
- id: string (PK)
- key: string
- value: string (AES-256-GCM encrypted)
- iv: string (initialization vector)
- tag: string (auth tag)
- updatedAt: datetime

### integrations
- id: string (PK)
- provider: string
- name: string
- status: "connected" | "disconnected" | "error"
- config: JSON
- lastHealthCheck: datetime
- errorMessage: string | null
- createdAt: datetime
- updatedAt: datetime

### webhooks
- id: string (PK)
- integrationId: string (FK)
- name: string
- url: string
- secret: string | null
- includeFullHtml: boolean
- payloadTemplate: string | null
- enabled: boolean
- lastDeliveryStatus: "success" | "failed" | null
- lastDeliveryAt: datetime | null
- createdAt: datetime
- updatedAt: datetime

### settings
- id: string (PK, singleton)
- masterKeyHash: string | null
- globalRecipients: JSON
- lastPermissionCheck: datetime
- permissionStatus: "ok" | "missing" | "error"
- language: "en" | "he"

***

## 8. API Design

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/health | GET | System health, DB connection, vault status |
| /api/catalog | GET | List all available report types with metadata |
| /api/jobs | GET | List jobs with last execution summary |
| /api/jobs | POST | Create new job |
| /api/jobs/:id | GET | Get job details |
| /api/jobs/:id | PUT | Update job |
| /api/jobs/:id | DELETE | Delete job and execution history |
| /api/jobs/:id/run | POST | Trigger manual execution |
| /api/jobs/:id/executions | GET | Get execution history for job |
| /api/executions/:id | GET | Get execution details + logs |
| /api/executions/:id/preview | GET | Get generated HTML output |
| /api/executions/:id/baseline | GET | Get baseline comparison for execution |
| /api/logs | GET | Query logs with filters |
| /api/templates | GET / POST | List or create templates |
| /api/templates/:id | PUT | Update template |
| /api/baselines/:jobId | GET | Get baseline metrics for a job |
| /api/vault | GET | List vault keys (masked values) |
| /api/vault | PUT | Update vault credentials (encrypts on server) |
| /api/vault/test | POST | Test connection using stored vault credentials |
| /api/integrations | GET | List all integrations with status |
| /api/integrations/:provider | GET | Get specific integration details |
| /api/integrations/:provider/connect | POST | Connect / configure integration |
| /api/integrations/:provider/disconnect | POST | Disconnect integration |
| /api/integrations/:provider/health | POST | Run health check on integration |
| /api/integrations/:provider/webhooks | GET | List all webhooks for integration |
| /api/integrations/:provider/webhooks | POST | Add new webhook URL |
| /api/integrations/:provider/webhooks/:id | PUT | Update webhook configuration |
| /api/integrations/:provider/webhooks/:id | DELETE | Remove webhook |
| /api/integrations/:provider/webhooks/:id/test | POST | Send test payload to webhook |
| /api/mailbox/setup | POST | Run mailbox setup wizard step |
| /api/mailbox/validate | POST | Validate mailbox permissions |
| /api/mailbox/revoke | POST | Show which one-time permissions to revoke |
| /api/settings | GET | Get current settings |
| /api/settings | PUT | Update settings |
| /api/settings/permissions | GET | Check mailbox permission status |
| /api/settings/permissions/remediate | POST | Re-check after admin applied fix |

***

## 9. UI/UX Design Direction

### Design Philosophy
The UI must be a modern, premium admin dashboard. The primary metaphor is Jenkins-style operational clarity (jobs, executions, logs) but elevated to a standard that matches modern SaaS tools.

### Design Research Mandate
The UI must draw inspiration from three specific sources:
- 21st.dev — Explore dashboard components, bento grids, radial timelines, file trees, and nested card patterns. Look for spatial layouts and scroll-triggered animations that could elevate the job overview.
- MotionSites.ai — Study the hero section and animation patterns from data/security-themed prompts. Extract the visual language for status indicators, glowing states, and data density.
- Refero.design — Search for dashboard and admin panel references. Study how real products (Stripe, Vercel, Datadog, GitHub) handle dense tables, activity feeds, stats rows, and dark/light toggles.

### Design Requirements
- Job Overview: Must surface status at a glance. Status indicators should be immediately scannable (not just colored dots).
- Log Viewer: Must feel like a real console — monospace font, color-coded output, collapsible sections.
- Density: IT admins manage 20–50+ jobs. The UI must handle density without clutter.
- RTL: Full Hebrew support with right-to-left layout.
- Dark/Light: Both modes must be implemented. The dark mode should not be an afterthought.
- No AI slop: Avoid generic gradient backgrounds, random glassmorphism, or floating 3D elements that do not serve the workflow.

### Recommended Approach
The developer should spend the first 30–60 minutes of the design phase collecting 5–10 specific screenshots/components from the three sources above, then synthesize a unified design system that serves the IT admin workflow.

***

## 10. Report Catalog (Built-in Types)

### 10.1 Identity & Access

| Report | Graph API Endpoint | Schedule | Baseline Support | Description |
|--------|-------------------|----------|-----------------|-------------|
| Daily Sign-in Anomalies | /auditLogs/signIns | Daily 08:00 | Yes | Failed sign-ins, unfamiliar locations, anonymous IPs, legacy auth |
| Risky Users Report | /identityProtection/riskyUsers | Daily 09:00 | Yes | Users flagged by Identity Protection, risk levels, remediation |
| MFA Registration Status | /users + $select | Weekly Monday | Yes | Who enrolled, who bypassed, pending MFA |
| Inactive Guest Users | /users | Weekly | Yes | External users not logged in for 90 days |

### 10.2 Security & Compliance

| Report | Graph API Endpoint | Schedule | Baseline Support | Description |
|--------|-------------------|----------|-----------------|-------------|
| Security Alerts Digest | /security/alerts_v2 | Hourly or Daily | Yes | Aggregated alerts from Microsoft Defender / Sentinel |
| DLP Alerts | /security/alerts_v2 (filter: DLP) | Daily | Yes | Data loss prevention incidents |
| Conditional Access Failures | /auditLogs/signIns | Daily | Yes | Blocked sign-ins, policy gaps, device non-compliance |

### 10.3 Infrastructure & Management

| Report | Graph API Endpoint | Schedule | Baseline Support | Description |
|--------|-------------------|----------|-----------------|-------------|
| App Secrets / Certificates Expiry | /applications | Weekly | No | Service principals with credentials expiring in 30/60/90 days |
| License Utilization | /subscribedSkus | Weekly | Yes | Provisioning status, available vs. consumed licenses |
| Device Compliance (Intune) | /deviceManagement/managedDevices | Daily | Yes | Non-compliant devices, pending actions, OS versions |
| Audit Log Summary | /auditLogs/directoryAudits | Daily | Yes | User creation, role changes, policy modifications |

### 10.4 Custom

| Report | Schedule | Baseline Support | Description |
|--------|----------|-----------------|-------------|
| Manual Graph Query | Any | Optional | Admin provides custom Graph API endpoint + $filter + $select. System executes and emails results. |

***

## 11. HTML Email Quality Standards

### Anti-Slop Rules
- Every report email must include at least one actionable insight beyond raw data
- Templates must use data-driven variables: {{alertCount}}, {{baselineDelta}}, {{trendPercent}}, {{topRiskUsers}}
- Structure requirement:
  - Executive Summary (2–3 sentences of what changed and why it matters)
  - Key Metrics (cards with numbers + trend indicators)
  - Details Table (sortable-style data)
  - Action Items (if applicable: "Review these 3 users", "Rotate this expiring secret")
- No filler text: No "Hello, here is your report" without context. Every sentence must carry information.
- Conditional sections: If baseline shows anomaly, highlight it in a dedicated "Anomaly Detected" banner
- Hebrew emails: Full RTL support, Hebrew date formatting, right-aligned tables

***

## 12. Security Model

### Entra ID Application Registration
- Application Permissions Only (daemon flow, no user interaction)
- Required Graph API permissions:
  - SecurityEvents.Read.All
  - AuditLog.Read.All
  - User.Read.All
  - Mail.Send (Application)

### Exchange Online RBAC Restriction
- Create dedicated shared mailbox: alerts@tenant.com
- New-ManagementScope -Name "ArgusScope" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'alerts@tenant.com'"
- New-ManagementRoleAssignment -Name "ArgusSendMail" -Role ApplicationImpersonation -App <ApplicationId> -CustomRecipientWriteScope "ArgusScope"
- Validation: App checks mailbox permissions at startup. If missing, enters read-only mode: data can be fetched, but no emails are sent.

### Mailbox Setup Wizard
- Automated approach: Uses Graph API to create shared mailbox, then Exchange Online PowerShell via one-time admin consent to apply RBAC
- One-time elevated permissions: During setup, Argus requests temporary elevated permissions (e.g., User.ReadWrite.All, Exchange.ManageAsApp) to create the mailbox and configure RBAC
- After successful setup, UI explicitly shows which elevated permissions were used and instructs admin to remove them from the Entra ID app registration
- Manual fallback: If automation fails, wizard shows exact step-by-step PowerShell commands
- Idempotency: Running wizard twice should not create duplicate mailboxes or duplicate role assignments

### Permission Remediation Flow
1. App detects missing SendAs or FullAccess on startup
2. Sets permissionStatus = 'missing' in settings
3. UI Settings panel displays exact PowerShell commands to run
4. Admin executes commands in Exchange Online PowerShell
5. Admin clicks "Re-validate" in UI
6. App checks again and clears read-only mode

### Encrypted Vault Architecture
- Storage: All credentials stored in vault table with AES-256-GCM encryption
- Master Key: Single 256-bit key provided via ARGUS_MASTER_KEY environment variable on container startup
- Key Handling: Master key loaded into memory on startup. Never persisted to disk or database. Never logged.
- Encryption: Each credential encrypted individually with unique IV and auth tag
- UI Security: Client Secret input field uses type="password" with show/hide toggle. Never sent in plaintext over HTTP (HTTPS only).
- Rotation: Admin can rotate Client Secret via UI. Old value overwritten immediately.
- Backup Warning: If ARGUS_MASTER_KEY is lost, encrypted credentials are irrecoverable. UI should warn admin to store master key securely.

***

## 13. Deployment

### Docker Compose
- Single app service running Next.js + Bun
- SQLite volume mounted for persistence
- Only required environment variable: ARGUS_MASTER_KEY (32-byte hex string for AES-256)
- Optional: PORT (default 8100)
- Health check: curl -f http://localhost:8100/api/health

### First Run
1. docker-compose up
2. Open http://localhost:8100
3. System detects empty vault → redirects to First Setup Wizard
4. Enter ARGUS_MASTER_KEY (or generate one in UI and copy to container)
5. Enter Entra ID credentials in Vault UI (encrypted immediately)
6. Run Mailbox Setup Wizard — create shared mailbox + apply RBAC (using one-time elevated permissions)
7. Click "Test Connection" — validates Graph API + mailbox in one click
8. Green = ready. Red = specific error message.
9. Revoke one-time elevated permissions from Entra ID app registration
10. Create first job from Catalog

***

## 14. Milestones

| Milestone | Timeline | Deliverables |
|-----------|----------|-------------|
| MVP | Week 1–2 | Core job runner, SQLite schema, Encrypted Vault UI, Mailbox Setup Wizard with one-time permissions, Daily Sign-in Anomalies report, basic HTML email, cron engine (presets + custom), Docker, Entra ID auth |
| V1.1 | Week 3 | Full catalog (12 report types), Jenkins-style dashboard, execution logs viewer, manual triggers, conditional execution, Quick Health Check button, Integrations Hub, webhook support for suppressed executions |
| V1.2 | Week 4 | Template editor + preview, baseline system with 90-day auto-prune, permission remediation UI, RTL Hebrew support, dark/light toggle |
| V1.3 | Week 5 | Advanced scheduling, job editing, bulk operations, multi-tenant support, comprehensive audit trail, email quality validation, webhook integration placeholder |

***

**Last Updated:** June 13, 2026



