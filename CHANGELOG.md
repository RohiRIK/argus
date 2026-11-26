# Changelog

All notable changes to Argus are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **Username + password sign-in** — every page and API route requires signing in. The
  first visit creates the admin account (open for 30 minutes after start); passwords are
  argon2id hashes; 5 failures lock a username for 15 minutes; Settings → Account changes
  the password; `bun run auth:reset-password <user>` recovers access from the host.
  Sessions last 12 hours. Scripts/CI can use a machine key as `Authorization: Bearer`.
  Anonymous `/api/health` returns only status. `ARGUS_AUTH_MODE=off` disables the gate.
- **HTTPS inside the container** — the image serves HTTPS on port `8100` with a self-signed
  certificate it generates on first boot (private key encrypted with `ARGUS_MASTER_KEY`,
  renewed before expiry), or your own via `ARGUS_TLS_CERT_FILE`/`ARGUS_TLS_KEY_FILE`.
  Next.js listens on loopback only; `ARGUS_TLS=off` restores plain HTTP.
- **Compose bind** — `ARGUS_BIND` (default `0.0.0.0`) chooses the host interface;
  `127.0.0.1` keeps Argus on the local machine.

- **Least-privilege Graph permissions (H2)** — permissions are split into read reports,
  send email, and an opt-in "Manage Entra groups" (`Group.ReadWrite.All`, off by default).
  Quick Setup and standard groups stay local unless opted in; Entra group writes are
  refused otherwise. Executor, test-send and Test Connection share one effective sender.
  New `GET/PUT /api/integrations/microsoft365/capabilities` and a Settings panel explain
  each capability before consent.

- **One run contract (H3)** — Run Now and scheduled runs share one delivery preflight
  (`deliveryPreflight()`: verified Mail.Send + effective sender), so the same job sends or
  is blocked the same way. Run Now on a paused job is a diagnostic run that never emails.
  Executions record `trigger` (scheduled/manual) and `deliveryStatus`
  (not_attempted/accepted/failed/unknown — "accepted" is not proof of receipt).
- **No silently undeliverable jobs (H4)** — catalog quick-enable, starter pack, clone and the
  job editor share `activationDecision()`: a job that would email no one is saved paused
  with a "Fix it" link. Jobs can be explicitly **compute-only** (`deliveryMode: "none"`).
- **Restart safety (H5)** — runs left unfinished by a stopped process are marked
  `interrupted` with delivery `unknown` at boot and never re-sent automatically; skipped
  scheduled fires (overlap, snooze) are recorded in the audit trail instead of only the console.
  The container boots the scheduler itself, without waiting for a health probe.

- **Failure-alert incidents (H7)** — one incident per failure streak (new `alert_incidents`
  table): admins are emailed once when the streak reaches the threshold, a failed alert send
  is recorded and retried with backoff (5 min → 6 h), a new streak within 1 hour of the last
  alert is recorded but not emailed, and the incident closes when the job recovers.
  `GET /api/alerts/incidents` lists them.

### Added
- **MIT license** — root `LICENSE` (Copyright 2026 Rohi Rikman); README license badge
  and License section point at it.
- **Report catalog expansion** — registered the full 26-report built-in surface across
  Identity, Security, Infrastructure, CSV usage reports, and Custom Manual Graph Query.
- **CSV usage-report transport** (`transport.getCsv`) for Microsoft 365 `/reports/*`
  302→CSV endpoints, with parsing and column-normalization helpers.
- **Tier-3 JSON reports** — User Risk Detections, Service Principal Risk Detections,
  Custom Security Attribute Audit, and Service Principal Sign-Ins.
- **Tier-1 JSON report polish** — Secure Score Trend now returns seven daily snapshots
  with trend, peer average, category totals, active/licensed users, enabled services,
  and lowest-score controls.
- **Live report probe/send helpers** for one-report validation and email review.
- **Row-level history & diff** (#3) — `execution_rows` snapshots keyed by
  `ReportDefinition.rowKey()`; pure added/removed/unchanged diff wired into the
  executor so `new_items` detects identity swaps, not just count arithmetic.
- **Trend chart** (#4) — per-job count-over-time SVG chart on execution detail
  (`recordsProcessed` across recent runs; current run marked).
- **Alerting & maintenance windows** (#6 + UI) — `metric_delta` conditional rule (named
  metric moves by ≥ delta in drop/rise/either vs prior run) plus global maintenance
  windows (recurring weekly or one-off; muted runs execute and persist as suppressed),
  complete with Settings maintenance-window CRUD UI and Job Form `metric_delta` builder.
- **Catalog discoverability UI** (#11) — search, category/maturity chips, permission-gap
  filter, Preview/Baseline badges, and a right-side detail drawer; Create job stays a
  deep-link to `/jobs/new?report=<id>`.
- **One-click Microsoft 365 deployment & X.509 certificate auth** — zero-dependency RSA-2048
  self-signed X.509 v3 DER certificate generator (`src/services/graph/cert.ts`) + `RS256`
  `client_assertion` token flow alongside Client Secret, Device Code 7-step Entra ID app
  provisioner (`src/services/graph/provisioner.ts`) auto-discovering tenant metadata and
  granting all 16 Graph scopes, plus upgrade-to-certificate for existing secret-based apps and
  CA-safe `.cer` + Azure CLI / PowerShell scripts.
- **Sender mailbox chooser & creation** (`Settings → Integrations → Advanced`) — switch
  between selecting an existing tenant mailbox (live directory dropdown + verification) or
  provisioning a dedicated unlicensed Shared Mailbox (`argus@<domain>`) with a least-privilege
  Exchange Online RBAC-for-Applications script and live Graph `sendMail` test verification.
- **Managed recipient groups (Entra ID + hybrid)** (`Settings → Recipients`) — auto-create or
  link Entra ID Security Groups (`Group.ReadWrite.All`), manage local groups and static
  addresses, live directory user/group search pickers, 1-click 3-group starter bootstrap,
  dynamic `/transitiveMembers` resolution at job run & test-send time with cached fallback,
  and job/global group attachment.
- **UI/UX overhaul & onboarding** — simplified `Settings → Integrations` into **`Quick Setup`**
  (single `Deploy to Microsoft 365` button + Device Code flow) vs **`Advanced`**, live
  `/api/health` sidebar indicator, `DEV` / `STAGING` environment pill badge, refresh-safe
  onboarding checklist (`src/components/onboarding-checklist.tsx`) + 4-report starter pack,
  and upgraded Template Editor (search filter, clone/delete custom templates, dirty guard +
  `Cmd/Ctrl+S`, cursor-aware variable chips, sandboxed iframe preview, collapsible history).
- **Two-branch DevOps pipeline (`dev` → `main`) & isolated stacks** — runtime `ARGUS_ENV`,
  isolated local dev (`bun run dev:isolated` / `./install.sh dev` on port `8101` with
  `./data/argus-dev.db`), isolated containers (`docker-compose.dev.yml`), non-root `USER bun` Dockerfile, GitHub Actions `CI` (`Quality`, `E2E`, `Docker smoke`),
  multi-arch GHCR publish (`linux/amd64`, `linux/arm64` tagged `:dev`, `:latest`, `:v*`),
  automated tag releases (`release.yml`), and GitHub branch rulesets on `main` & `dev`.

### Removed
- **Docker Swarm + Traefik stack** (`deploy/docker-stack.yml`). Argus ships as a single
  container via Docker Compose only.
- **Plugin contract for every registered plugin** — shared `src/services/reports/plugin-contract.ts`
  drives both `bun run plugin:validate` and `tests/plugin-contract.test.ts` (one test per plugin)
  over everything the runtime registry exposes, built-in **and** declarative. Declarative
  manifests accept an inline `fixtures` block for contract parity; two contract-tested examples
  ship in `examples/plugins/`.
- **Generated report catalog reference** — `bun run docs:catalog` (`--check` via
  `docs:catalog:check`, wired into CI) renders report id/name/category/data source/Graph
  permissions from the registry between markers in `docs/04-Guides/report-catalog.md`.
- **Template ownership** — `templates.managed` + `templates.source_hash`. Seeded defaults are
  Argus-managed; `bun run db:seed` upgrades a managed template only while its content still
  hashes to the default it was seeded from (the prior content is kept as a template version).

### Changed
- **Config import never silently activates work (H6)** — `POST /api/backup?mode=preview`
  dry-runs an import (create/update counts and names, scheduled jobs, missing template /
  recipient-group references, target M365 connection status) without writing. Real imports
  land every job paused (`status: "disabled"`), never register jobs with the scheduler or
  trigger runs (opt-in `?activate=true` restores bundle state), apply only whitelisted
  non-secret settings the bundle carries, and never let a bundle's empty value clear an
  existing target setting. Settings → Backup now shows the preview before confirming.
- **Dashboard separates lifecycle from last outcome (H8)** — a "State" pill
  (Active / Paused / Snoozed) sits apart from the last-run outcome pill; failed runs link
  straight to the execution detail and the job editor. Separate state and outcome filters.
- **Honest log pagination (H8)** — `GET /api/logs` takes `limit` (1–500) and an opaque
  keyset `cursor`, orders by `(timestamp, id)` for stable pages, and returns
  `meta.total` (real COUNT), `meta.hasMore`, and `meta.nextCursor`. The Logs page offers
  "Load more".
- **Public docs links** — README and `docs/INDEX.md` retargeted at the shipped set
  (`docs/01-Architecture/`, `docs/04-Guides/`, root INSTALL/DESIGN/CHANGELOG/AGENTS/CLAUDE);
  gitignored planning trees are no longer linked.
- **Core reliability & performance** — unified bounded run queue (`enqueueRun` with `409`
  duplicate-run protection), single-flight OAuth token coalescing, vault-update cache
  invalidation, status-aware retry + timeouts on email/webhook dispatch, elimination of heavy
  `outputHtml` scans on list/history queries, DST-safe cached `Intl.DateTimeFormat` cron
  preview, and transactional backup import (incl. recipient groups & maintenance windows).
- **Toolchain upgrades** — ESLint 9 flat config (`eslint.config.mjs`) and Zod `^3.25.76`.
- **Report roadmap** (`docs/05-Reference/new-reports.md`) now states the Catalog shows
  every built-in report that is currently working, while `docs/04-Guides/report-catalog.md`
  tracks live-review status separately.
- **User Risk Detections** now limits detections to the last 7 days, joins current
  `/identityProtection/riskyUsers` state, shows why a user is at risk, and includes
  remediation status/action.
- **Service Principal Risk Detections** now limits detections to the last 7 days, joins
  `/identityProtection/riskyServicePrincipals`, aligns columns with the service-principal
  report, and includes why/remediation plus service-principal ID/IP address.
- **Conditional Access Failures** now limits sign-ins to the last 7 days, adds policy
  summary, failure reason, recommendation, created time, IP address, and client app.
- **Secure Score Trend** now compares the latest snapshot against the previous day,
  includes peer/category context, and sorts lowest-score controls first for remediation.
- **Report-catalog review tracker** updated with live findings for the reviewed reports.

- **Template upgrades never touch operator edits** — the legacy text-match upgrade in
  `seed()` is replaced by hash-based, ownership-aware upgrades. Edits/reverts through the
  templates API mark a template operator-owned; `POST /api/templates/:id/reset` makes a seeded
  default managed again. Seed now logs operator-owned templates with a newer default available.

### Fixed
- **Deterministic offline font builds** — switched `src/app/layout.tsx` from runtime
  `next/font/google` fetches to the already-installed local `geist` WOFF2 bundles
  (`GeistSans` / `GeistMono`), eliminating intermittent Docker/ARM64 build failures.
- Identity Protection `$top` paging remains capped at 500 for user and service-principal
  risk endpoints.
- `sp-risk-detections` and `risk-detections` no longer surface all-time historical noise;
  they focus on current risk and remediation from the last week.
- `sp-sign-ins` now includes `ipAddress` in live rows and tests.
- `conditional-access-failures` reads policy context from Graph's
  `appliedConditionalAccessPolicies` (v1.0 nested collection) instead of the
  unsupported/nonexistent `conditionalAccessPolicies` `$select`; also requires
  `Policy.Read.ConditionalAccess` so Graph returns the nested CA details.
- Secure Score control status/recommendation rendering now decodes HTML entities and
  avoids duplicated recommendation text.
- **Smoke catalog expect** — `scripts/smoke.sh` expects 26 reports (was 12) and
  templates floor `>=26`.
- **Health version & environment** — `GET /api/health` reads `version` from
  `package.json` and exposes `env` (`ARGUS_ENV`) + live integration status.
- Removed duplicate `create-job-dialog.tsx` / `create-job-form.tsx` dead components and ghost
  `X.509 Certificate` header badge when disconnected (`vault.configured === false`).
- Excluded internal `maintenance_window.*` entries from the Microsoft 365 activity audit feed.
- Restored `IconClose` export for `<CatalogClient>` drawer dismissal and updated `UX-C2` E2E
  selector (`catalog-create-risky-users`) to match the E1.3 drawer flow.
- Fixed `isAlreadyAssignedError` (`/already\s*exists?/i`) so duplicate Graph `/members/$ref`
  assignments remain idempotent, filtered `#EXT#` external guests out of mailbox/directory
  pickers even when `mail` lacks `#EXT#`, and fixed Drizzle `bun:sqlite` `.changes` prune counts.
- Fixed GitHub Actions `upload-artifact@v4` (`include-hidden-files: true`) so `.next` builds
  transfer cleanly into the Linux `E2E (Playwright)` job.

### Migrations
- `0012_white_leper_queen` (`execution_rows`), `0013_purple_katie_power` (`maintenance_windows`
  + `executions.metrics_snapshot`), `0014_blushing_wallop` (`recipient_groups`,
  `jobs.recipient_group_ids`, `settings.global_recipient_group_ids`).
- `0016_wild_tinkerer` (`templates.managed`, `templates.source_hash`); custom clones are marked
  operator-owned in SQL, and `runMigrations()` / `seed()` classify the remaining rows by content
  (current or legacy default → managed; anything edited → operator-owned).

### Tested
- **343 unit/integration tests across 47 files** (`bun test tests/`, 870 assertions): X.509 cert
  generation & `RS256` signing, 7-step Device Code provisioner, mailbox discovery/RBAC script/send,
  managed Entra recipient groups + executor expansion, cron preview, maintenance windows API,
  transactional backup, row diff, `metric_delta`, and Conditional Access / Secure Score reports.
- **26 functional Playwright E2E specs** (`bun run e2e:app`) across desktop (`1440px`/`1280px`)
  and mobile viewports, plus `bun run typecheck`, `bun run lint`, and `bun run build`.

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
