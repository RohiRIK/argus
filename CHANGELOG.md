# Changelog

All notable changes to Argus are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Report catalog expansion** — registered the full 26-report built-in surface across
  Identity, Security, Infrastructure, CSV usage reports, and Custom Manual Graph Query.
- **CSV usage-report transport** (`transport.getCsv`) for Microsoft 365 `/reports/*`
  302→CSV endpoints, with parsing and column-normalization helpers.
- **Tier-3 JSON reports** — User Risk Detections, Service Principal Risk Detections,
  Custom Security Attribute Audit, and Service Principal Sign-Ins.
- **Live report probe/send helpers** for one-report validation and email review.

### Changed
- **Report roadmap** (`docs/05-Reference/new-reports.md`) now states the Catalog shows
  every built-in report that is currently working, while `docs/04-Guides/report-catalog.md`
  tracks live-review status separately.
- **User Risk Detections** now limits detections to the last 7 days, joins current
  `/identityProtection/riskyUsers` state, shows why a user is at risk, and includes
  remediation status/action.
- **Service Principal Risk Detections** now limits detections to the last 7 days, joins
  `/identityProtection/riskyServicePrincipals`, aligns columns with the service-principal
  report, and includes why/remediation plus service-principal ID/IP address.
- **Report-catalog review tracker** updated with live findings for the reviewed reports.

### Fixed
- Identity Protection `$top` paging remains capped at 500 for user and service-principal
  risk endpoints.
- `sp-risk-detections` and `risk-detections` no longer surface all-time historical noise;
  they focus on current risk and remediation from the last week.
- `sp-sign-ins` now includes `ipAddress` in live rows and tests.

### Tested
- Added/updated focused tests for tier-3 report summaries and fetch paths.
- Validated with `bun test tests/catalog-tier3.test.ts tests/report-paging.test.ts tests/catalog-csv.test.ts`
  and `bun run typecheck`.

## [0.4.0] — 2026-06-16

Frontend editorial overhaul + user-selectable theme system. Moves the UI from a
generic admin dashboard to a flat, typographic editorial tool — without changing
any workflow. Shipped in phases (P0–P5), each behind a visual-regression gate.

### Added
- **Theme system** — 5 user-selectable palettes (Graphite·Amber default, Slate·Bone,
  Carbon·Coral, Ink·Sky, Paper·Ink), picker in Settings → General. Re-tints canvas +
  accent only; layout is invariant (radius/spacing untouched). Persists via
  `localStorage` with a pre-paint inline script (no flash), independent of light/dark.
- **Visual-regression harness** (`e2e/vr.spec.ts`) — per-page desktop + mobile
  screenshots; per-platform baselines (local Darwin, CI Linux).
- **Contrast guard** (`tests/contrast.test.ts`) — asserts WCAG AA for muted text on
  every theme × light/dark.

### Changed
- **Font** Manrope → **Geist Sans** (Swiss grotesque). Mono stays JetBrains Mono.
- **Catalog** 3-col card grid → airy 2-col discovery tile grid: per-category in-house
  SVG icon on a theme-tinted wash, always-visible "Create job →" CTA, flat tiles
  (0px, no shadow).
- **Dashboard** 4 metric cards → a single hairline stat strip (large light numerals,
  uppercase labels); job-list container de-containerized.
- **Logs console** drops the fake-macOS traffic-light header and cold near-black
  background → minimal "Console" header on a warm carbon recess.
- **Settings nav** pill+shadow bar → underline tab bar (active = accent underline).
- **Accent scarcity** — amber stripped from default borders/badges/panel shadows;
  reserved for active state + primary CTAs.
- Removed the catalog "baseline ✓" indicator and the dashboard run-history sparkline.

### Fixed
- **Blurry text** — the grain overlay rendered *above* content (`z-index: 9999`),
  fuzzing glyph edges; now sits behind text. Also dropped forced
  `-webkit-font-smoothing: antialiased` for crisp subpixel rendering on the dark canvas.

### Removed
- `shadow-sm` / `rounded-xl` on panels across the app (DESIGN.md 0px / no-shadow
  compliance); shadows remain only on intentional overlays (modal, popover, bulk bar).

## [0.3.1] — 2026-06-16

Email + report-delivery polish from live use.

### Added
- **"Don't email empty reports"** setting (General tab, default on): a run that finds
  0 items is **suppressed** instead of emailed — applies to every report.

### Changed
- **Report email subject** drops the tenant GUID. Now `[Argus · <Category>] <Report name>`
  (e.g. `[Argus · Security] Inactive Guest Users`); the body subtitle shows the category,
  not the tenant id. Manual "Run now" no longer passes the tenant id as the org name.
  Existing default templates are upgraded in place on seed.
- **Job form**: the Graph-permissions panel collapses to a one-line "✓ granted" (with a
  *Show* toggle) when all required permissions are already granted — no more noise.

### Migrations
- `0011` settings.suppress_empty_reports.

## [0.3.0] — 2026-06-15

Overnight autonomous session + interactive follow-up: CI, a reworked Microsoft Graph
authorization flow, new features, broad test coverage, and a full report-flow audit
against a live tenant. See `NIGHTLY.md` and `docs/SETUP.md`.

### Added

**CI**
- GitHub Actions workflow (`.github/workflows/ci.yml`): on push + PR → `bun install`
  → `tsc` → `bun test` → `build`, with a deterministic `ARGUS_MASTER_KEY` job env.

**Microsoft Graph authorization (reworked)**
- **One-click Authorize** — delegated admin OAuth (auth-code) flow
  (`/api/integrations/microsoft365/authorize` + `/authorize/callback`): an admin signs
  in and Argus **appends the required application permissions to the app registration and
  grants them** (dynamic consent of `Application.ReadWrite.All` + `AppRoleAssignment.ReadWrite.All`).
- Shared `<GraphConsent>` control surfaced in **Settings, the Catalog banner, and the job
  form**; auto-checks permission status, collapses to a confirmation when granted.
- **Script fallback** that declares (`Update-MgApplication`) + grants all scopes in the
  admin's own session; redirect-URI hint + Entra portal deep link.
- `GET /api/integrations/microsoft365/required-permissions` (scopes + setup snippet);
  a `permissions.readable` flag distinguishes "consent pending" from "all missing".

**Features**
- **Dashboard search** + status/report-type filters (`filterJobs`).
- **Report download** — execution detail → HTML or CSV (`/api/executions/:id/download`).
- **Snooze a job** — pause N hours/days; scheduler skips while snoozed, auto-resumes.
- **Compare two executions** — side-by-side metric diff + logs.
- **Template version history** — snapshot on save + revert.
- **Test-send** a sample report; **failure alerts** to admins after N consecutive fails.

### Fixed

- **Report queries (audited live, 23/26 verified):** Identity Protection `$top` capped at
  500 (was 999 → 400); `provisioning-summary` (`$select` not allowed, field
  `provisioningAction`); `sp-sign-ins` + `custom-attr-audits` routed to the **beta** endpoint;
  `alerts_v2` reports require `SecurityAlert.Read.All`. Transport now supports a `/beta/` path.
- Idempotent grant — already-assigned roles (409 / 400 "already exists") count as granted.
- Jobs with no recipients end as a **warning**, not a hard failure.
- `.gitignore` no longer swallows `src/app/api/logs` + `src/app/logs` (CI now compiles them).

### Tested

- Coverage ~89% funcs / ~91% lines (245 tests). DI seams added for the grant orchestration,
  the admin-authorize flow, and `testConnection` so live-Graph logic is unit-tested without a tenant.
  New `scripts/probe-reports.ts` audits every report against a live tenant.

### Migrations

- `0007` audit · `0008` jobs.snoozed_until · `0009` template_versions · `0010` settings.alert_threshold.

## [0.2.0] — 2026-06-14

A large UX, settings, catalog, and reliability release driven by the UX spec
(`docs/spec-ux.md`) and the settings/reports spec (`docs/spec-settings-and-catalog.md`).

### Added

**Job creation & management (UX overhaul)**
- Dedicated job creation page `/jobs/new?report=<id>` with a shared, reusable job
  form (replaces the old modal dialog).
- Job edit page `/jobs/[id]/edit` and clone flow `/jobs/new?clone=<id>` (" (copy)").
- Quick-setup presets on the creation page (daily email, weekly digest, on-change alert).
- Live "next 5 runs" schedule preview, natural-language schedule summaries, and a
  custom-cron mode.
- Tags on jobs (new `tags` column) with a tag filter bar on the dashboard.
- Dashboard richness: health pill (last-3 runs), 20-run sparkline, bulk
  select/enable/disable/delete, and an Edit/Duplicate action.
- Required-permissions panel on the creation page — lists the report's Graph scopes
  plus `Mail.Send`, with a "grant in Entra" hint.

**Settings & platform**
- General tab: global recipients, admin contacts, language, app version, master-key banner.
- Schedule **timezone** (IANA) — jobs fire and preview in the configured zone.
- Configurable **data-retention** window (was a hardcoded 90-day prune).
- **From-address / Reply-To** overrides for outbound report email.
- **Backup** export/import (`/api/backup`) of jobs, templates, and non-secret settings —
  credentials and the master key are never exported.
- **Granular permission validation** — Test Connection probes the app's granted Graph
  permissions and lists the exact missing scopes (incl. `Mail.Send`).
- **One-click permission grant** — admin-consent bootstrap link plus programmatic
  `appRoleAssignment` of missing scopes via Graph (Settings → Integrations).

**Catalog — 12 → 26 built-in reports**
- Tier-1 JSON: Secure Score Trend, Provisioning Log Summary, Risky Service Principals.
- Tier-2 CSV usage reports (new `getCsv` transport seam + CSV parser): Teams User Activity,
  Mailbox Quota, M365 Groups Activity, OneDrive Usage, SharePoint Site Usage, Email
  Activity, Active Users per Service.
- Tier-3 JSON: User Risk Detections, SP Risk Detections, Custom Security Attribute Audit,
  Service Principal Sign-Ins.

### Changed

- **Settings navigation** restructured: `General` (default) + `Integrations`. Microsoft 365
  credentials moved into the Integrations vendor card; vendors are collapsible cards with
  brand logos (M365, GCP, AWS, Custom Webhook). Mailbox permissions folded into the M365
  card (standalone Permissions tab removed).
- **Catalog** cards now start the creation flow ("Create job" → `/jobs/new`) instead of
  opening the template editor.
- **Template previews** are report-specific (each shows its own report name/summary).
- **Legibility**: raised muted-foreground and border contrast tokens for readability.
- Execution detail shows the parent job's name + tags and a clickable run-history timeline.

### Fixed

- Connection test no longer reports a false "green": it now validates real Graph
  permissions and `Mail.Send` instead of merely checking that a mailbox string was saved.
- Graph errors are now human-readable — HTTP status + Graph error code + an actionable hint
  (e.g. a 403 names the exact permissions the failing report needs), instead of dumping the
  raw request URL.
- Templates page no longer offers a "Create job" button (kept as a separate workflow).

### Migrations

- `0003` settings `admin_contacts`
- `0004` jobs `tags`
- `0005` settings `timezone`, `retention_days`, `from_address`, `reply_to`
- `0006` settings `missing_permissions`

## [0.1.0] — 2026-06-13

Initial MVP.

### Added
- Next.js 14/16 App Router + Bun + Drizzle (bun:sqlite, WAL) foundation.
- Encrypted vault (AES-256-GCM) for Microsoft 365 credentials.
- Pluggable report engine + transport seam; 12 built-in reports.
- Cron scheduler with bounded run queue, baseline anomaly detection, conditional send.
- Email delivery via Graph `sendMail`; webhook delivery on suppression.
- Dynamic, editable HTML/text email templates with live preview.
- Premium "darkroom editorial" UI: in-house icon system, sidebar shell, design tokens.
- Docker deployment, `install.sh`, professional README.
