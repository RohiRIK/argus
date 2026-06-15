# Argus — Overnight Autonomous Session — 2026-06-15

Branch: `nightly/2026-06-15` (never merged/pushed to `main`).
Driver: Claude Code (Opus 4.8), unattended.

## Baseline (Phase 0)

- `git checkout -b nightly/2026-06-15` ✅
- `bunx tsc --noEmit` → 0 errors ✅
- `bun test tests/` → 139 pass / 0 fail (21 files) ✅
- `bun run build` → exit 0 ✅

Green baseline confirmed. Starting Phase 1.

---

## Items

<!-- one block appended per finished item -->

## Final Summary (Phase 4) — 2026-06-15

**Status: complete.** Backlog shipped (F6 skipped per user request mid-run). Final gate **green**: `tsc` 0 errors · **219 tests / 0 fail** · `build` exit 0 · coverage **88.9%/89.6%**. **CI green** on the nightly branch. Never touched `main`, `.env`, or secrets; every commit passed the gate.

> Follow-up after the run: the **Graph grant orchestration (D2) is now unit-tested** via a dependency-injected fake client (GRANT-3/4/5/6/7, 403/409 paths) — `permissions-grant.ts` 31% → 99% lines. Only the actual live `/adminconsent` click + real Graph network calls remain genuinely manual. See the "Graph grant orchestration now unit-tested" block below.

### Commits (feature commits; each followed by a small `docs(nightly)` SHA-record commit)

| Item | Commit | Migration |
|------|--------|-----------|
| Phase 1 — CI workflow | `a61c258` | — |
| Phase 2 — Graph two-step consent + redirect + grant audit | `a076022` | `0007` (audit) |
| F1 — Dashboard search + status/report-type filters | `114c2bc` | — |
| F2 — Report download (HTML + CSV) | `8d5b8ed` | — |
| F3 — Snooze a job | `9cdc966` | `0008` (jobs.snoozed_until) |
| F4 — Compare two executions | `340fe23` | — |
| F5 — Template version history | `d9456de` | `0009` (template_versions) |
| F7 — Test coverage → 88% | `a0f15cd` | — |
| F8 — Test-send + failure alerts | `ad2a50f` | `0010` (settings.alert_threshold) |
| CI fix — `.gitignore` swallowed `src/app/api/logs` + `src/app/logs` | `79abe9f` | — |

### MANUAL TEST NEEDED (live M365 tenant — see per-item runbooks below)

1. **Phase 2 — Graph two-step consent**: add the two bootstrap scopes in Entra, click *Authorize self-management* → consent → confirm redirect banner + auto re-test, then *Grant missing permissions* clears the missing list. (Full steps in the Phase 2 block.)
2. **F8 — Test-send**: a job's *Test-send* button emails a `[TEST]` sample to admin contacts.
3. **F8 — Failure alerts**: set a threshold, fail a job N× → one admin alert email on the Nth failure.

### Skipped / not done

- **F6 — HE / RTL**: skipped per user request mid-run. No code changed; left for a future session.

### Notes / gotchas for the reviewer

- A pre-existing `.gitignore` rule (`logs/`, unanchored) had been silently **excluding two real source files** (`src/app/api/logs/route.ts`, `src/app/logs/page.tsx`) from git — local builds passed because the files exist on disk, but CI's clean checkout failed `tsc`. Caught by the new CI on the first run; fixed in `79abe9f` (anchored to `/logs/` + tracked both files). Worth a glance.
- The LTM `GitCommit` plugin hook errored (`Module not found … GitCommit.bundle.mjs`) on every commit — non-fatal, commits + the varlock secret scan succeeded each time.

## Phase 1: CI (GitHub Actions) — 2026-06-15 04:47

- **What:** Added `.github/workflows/ci.yml` — on push + pull_request → setup-bun@v2 → `bun install --frozen-lockfile` → `bunx tsc --noEmit` → `bun test tests/` → `bun run build`. Job-level `ARGUS_MASTER_KEY` (64-hex zeros) so DB/vault-touching tests pass.
- **Files:** `.github/workflows/ci.yml`, `NIGHTLY.md`
- **Gate:** tsc 0 · tests 139 pass · build exit 0 (no code change — config only).
- **Commit:** `a61c258` — pushed to `origin/nightly/2026-06-15`.
- **CI:** run `27524662543` queued on the nightly branch — workflow picked up ✅.

## Phase 2: Fix Graph authorization flow — 2026-06-15

- **What:**
  - **Admin-consent redirect return** handled on `/settings/integrations`. Pure parser `parseAdminConsentReturn(URLSearchParams)` → `{status: success|error|none, tenant?, error?, errorDescription?}`. On `?admin_consent=True&tenant=…` the page shows a success banner + auto re-runs Test Connection; on `?error=…` it shows the error; then scrubs the query string via `history.replaceState`.
  - **Two-step flow made explicit** in the M365 card: **Step 1 · Authorize self-management** (one-time admin consent of the two bootstrap scopes) and **Step 2 · Grant missing permissions**. Step 2 is **disabled until bootstrap scopes are present** (`hasBootstrapScopes(granted)`), with an inline reason. Bootstrap readiness is derived from the granted-scope set returned by Test Connection.
  - **GRANT-6 audit log:** new `audit` table (`action, provider, outcome, detail json, createdAt`) + `auditDao` (record/list). `grantMissingPermissions` now records every attempt's outcome (success / partial / error). New `GET /api/integrations/microsoft365/audit` + a "Recent grant activity" viewer in the card.
  - Pure helpers moved to server-free `src/lib/graph-consent.ts` (so the client page doesn't bundle server code); re-exported from `permissions-grant.ts` for existing import sites.
- **Files:** `src/lib/graph-consent.ts` (new), `src/services/graph/permissions-grant.ts`, `src/db/schema.ts`, `src/db/dao/audit.ts` (new), `src/app/api/integrations/[provider]/audit/route.ts` (new), `src/app/settings/integrations/page.tsx`, `drizzle/0007_salty_zeigeist.sql` (new migration), `tests/graph-consent.test.ts` (new), `tests/db.test.ts`.
- **Unit tests:** `parseAdminConsentReturn` (success/error/none/precedence/case), `hasBootstrapScopes` (gating), `auditDao` roundtrip; existing `mapScopesToRoleIds` / `buildRequiredResourceAccess` / `computeMissing` still green.
- **Gate:** tsc 0 · tests 149 pass / 0 fail · build exit 0.
- **Commit:** `a076022` — pushed to `origin/nightly/2026-06-15`.

### MANUAL TEST NEEDED (live tenant — human's morning test)

The actual Microsoft consent click cannot be exercised without a real M365 tenant. Runbook:

1. In **Entra → App registrations → (Argus app) → API permissions**, add **`Application.ReadWrite.All`** + **`AppRoleAssignment.ReadWrite.All`** (Application permissions) to the app. (One-time.)
2. In Argus → **Settings → Integrations → Microsoft 365**, click **Step 1 · Authorize self-management** → complete admin consent in the Microsoft window → you are redirected back to `/settings/integrations?admin_consent=True&tenant=…`.
   - **Expect:** green "Self-management authorized…" banner, the query string is scrubbed, and Test Connection re-runs automatically. If consent was declined you instead get a red banner with the error description.
3. Click **Test Connection** (if not already auto-run). Step 2 should now be **enabled** (bootstrap scopes detected).
4. Click **Step 2 · Grant missing permissions** → confirm the **Missing permissions** list clears and **Test Connection** greens.
5. Confirm the grant attempt appears under **Recent grant activity** with outcome `success`.
   - Negative path: if you click Step 2 *before* Step 1, the button is disabled with "Locked until Step 1 is complete"; if forced, `/grant` returns the clear D1-bootstrap error and the audit log records an `error` outcome.

## F1: Dashboard search + status/report-type filters — 2026-06-15

- **What:** Pure `filterJobs()` in `src/lib/job-filter.ts` — free-text search by job name + status filter (display-status: disabled/success/warning/failed/suppressed) + report-type filter + existing tag filter, all AND-composed. Dashboard toolbar gains a search box, two `<select>`s, and a `N / total` result count beside the tag filter.
- **Files:** `src/lib/job-filter.ts` (new), `src/components/dashboard-client.tsx`, `tests/job-filter.test.ts` (new).
- **Tests:** 13 cases — display-status mapping, name search (case/trim), status/report/tag filters, AND composition.
- **Gate:** tsc 0 · tests 159 pass · build 0.
- **Commit:** `114c2bc`.

## F2: Report download (HTML + CSV) — 2026-06-15

- **What:** Execution-detail page gains **Download HTML** (the stored rendered report) and **Download CSV** buttons. New `GET /api/executions/:id/download?format=html|csv` serves the report with a `Content-Disposition: attachment` filename `argus-execution-<short>.<ext>`. CSV is built from the data we actually persist — a `key,value` run summary plus every `baselineSnapshot` metric (`metric:<name>`); raw report rows aren't stored, so the snapshot metrics are the structured export.
- **Files:** `src/lib/export.ts` (new — `csvEscape`/`toCsv`/`executionCsvRows`/`executionToCsv`), `src/app/api/executions/[id]/download/route.ts` (new), `src/app/executions/[id]/page.tsx`, `tests/export.test.ts` (new).
- **Tests:** 10 cases — RFC-4180 escaping (commas/quotes/newlines), CRLF joining, summary rows, metric prefixing, empty-field omission.
- **Gate:** tsc 0 · tests 167 pass · build 0.
- **Commit:** `8d5b8ed`.

## F3: Snooze a job — 2026-06-15

- **What:** Pause a job's scheduled runs for N hours/days without disabling it. New nullable `jobs.snoozed_until` column. Scheduler keeps the cron task alive but **skips the fire** while `isSnoozed(snoozedUntil)` (so it **auto-resumes** the instant the time passes — no re-register needed). Dashboard card shows a **"Snoozed · <date>"** pill; `JobActions` gains a **Snooze** presets popover (1h / 24h / 7d) and an **Un-snooze** button. New `POST`/`DELETE /api/jobs/:id/snooze` (Zod-validated amount+unit). Manual **Run** is unaffected (snooze only gates the scheduler).
- **Files:** `src/lib/snooze.ts` (new), `src/db/schema.ts`, `src/db/dao/jobs.ts`, `src/services/scheduler.ts`, `src/app/api/jobs/[id]/snooze/route.ts` (new), `src/components/job-actions.tsx`, `src/components/dashboard-client.tsx`, `src/app/dashboard/page.tsx`, `drizzle/0008_massive_earthquake.sql` (new), `tests/snooze.test.ts` (new).
- **Tests:** 9 cases — `computeSnoozeUntil` (hours/days/reject non-positive), `isSnoozed` (future/past/boundary/null/invalid).
- **Gate:** tsc 0 · tests 174 pass · build 0.
- **Commit:** `9cdc966`.

## F4: Compare two executions — 2026-06-15

- **What:** Read-only side-by-side comparison at `/executions/compare?a=<id>&b=<id>`: two identity cards, a **metric diff table** (records, Graph latency, and every baseline-snapshot metric — unioned, sorted, with `Δ = b − a` and tone for up/down), and the two runs' **console logs side-by-side**. Entry point: a **"Compare with previous"** link on the execution detail page (auto-targets the next-older run for that job).
- **Files:** `src/lib/compare.ts` (new — `executionMetrics`/`diffMetrics`/`diffExecutions`), `src/app/executions/compare/page.tsx` (new), `src/app/executions/[id]/page.tsx`, `tests/compare.test.ts` (new).
- **Tests:** 8 cases — metric flattening (incl. missing snapshot), positive/negative/null deltas, key union+sort, end-to-end exec diff.
- **Gate:** tsc 0 · tests 181 pass · build 0.

## One-click Authorize — append app registration + grant (OAuth) — 2026-06-15

**Why:** the Azure portal showed the `argus-test` app registration had **only `User.Read` (Delegated)** declared — none of the 13 application permissions. So "Grant admin consent" granted nothing (it only consents *declared* perms), and live Test Connection confirmed **0 granted**. The user wants an **Authorize** button that runs the Microsoft authorization workflow to **append the permissions to the app registration and grant them**, surfaced in Settings, Catalog, and the Job form. Plan: `~/.claude/plans/frolicking-cooking-chipmunk.md`.

- **Delegated admin OAuth ("Authorize" button):** confirmed (Microsoft Learn) that *delegated* scopes support **dynamic consent without pre-declaration**. New flow: `GET /api/integrations/microsoft365/authorize` builds a v2 `oauth2/v2.0/authorize` URL requesting delegated `Application.ReadWrite.All` + `AppRoleAssignment.ReadWrite.All` (+ CSRF `state` cookie); the admin signs in; the callback `…/authorize/callback` exchanges the code for the admin's delegated token and **declares (PATCH `requiredResourceAccess`) + grants (appRoleAssignments)** all 13 scopes, audits it, and redirects to `…?authorized=ok|err`. The delegated token is used transiently, never persisted/logged.
- **Script fallback:** `buildConsentSetupSnippet` now **declares (Update-MgApplication) AND grants** — run once as Global Admin, no app config. The Settings setup panel also shows the **exact redirect URI to register** + portal deep link.
- **Three surfaces:** `<GraphConsent>` primary button is now **Authorize** (popup) and handles the `authorized=ok|err` return; used in Settings (full), Job create/edit (compact), and a new **Catalog "Permissions required" banner** (`catalog-permissions-banner.tsx`).
- **Files:** `src/services/graph/admin-authorize.ts` (new — `exchangeCodeForToken`, `appendAndGrant`, injectable fetch), `src/app/api/integrations/[provider]/authorize/route.ts` + `…/authorize/callback/route.ts` (new), `src/lib/graph-consent.ts` (`buildAdminAuthorizeUrl`, delegated scopes, callback path, cookie name, declare+grant snippet), `src/components/graph-consent.tsx`, `src/components/catalog-permissions-banner.tsx` (new), `src/app/catalog/page.tsx`, `tests/graph-consent.test.ts`, `tests/admin-authorize.test.ts` (new).
- **Tests:** `buildAdminAuthorizeUrl` (endpoint/scopes/state/prompt), snippet declares+grants, `appendAndGrant` orchestration via injected fake fetch (declare PATCH + grant POSTs + 409 + unknown-scope → stillMissing), `exchangeCodeForToken` success/error.
- **Gate:** tsc 0 · tests 230 pass · build 0. **Runtime verified** against the live tenant creds: authorize URL well-formed (delegated write scopes, real tenant), callback CSRF guard redirects `?authorized=err&reason=state`, catalog 200.
- **Commit:** _(below)_

### MANUAL TEST NEEDED (live tenant — the actual sign-in)
1. **One-time:** register redirect URI **`http://localhost:8100/api/integrations/microsoft365/authorize/callback`** (and your deployed origin's equivalent) on the app → Authentication → Web → Redirect URIs. (Shown in Settings → Integrations → One-time setup.)
2. Settings → Integrations → **Authorize** → sign in as Global Admin → consent the two delegated scopes → Argus appends the 13 perms to the app registration + grants them → redirect → **Re-validate** greens. The Azure "Configured permissions" list should now show the 13.
3. **Fallback (no redirect URI):** expand One-time setup → copy the PowerShell → run once as Global Admin → Re-validate.

## Consent flow redesign — interactive, in Settings + Job form — 2026-06-15

**Why:** the old two-step "Authorize self-management" → "Grant missing permissions" couldn't work for admins: Microsoft's `/adminconsent` only grants permissions **already declared** on the app, so Step 1 was a no-op unless 2 bootstrap scopes were hand-added in Entra; and a chicken-and-egg (reading granted scopes needs `Application.Read.All`) left Step 2 **locked forever** while showing a scary all-missing list. Plan: `~/.claude/plans/frolicking-cooking-chipmunk.md`.

- **Fixed the lock (foundation):** `ConnectionTestResult.steps.permissions` gains `readable:boolean`. When the probe can't enumerate grants (403), the UI now says **"consent pending — can't read grants yet"** instead of "everything missing." The redirect handler **trusts `admin_consent=True`** to unlock the advanced grant (no read required).
- **Secure default — one interactive click:** new shared **`<GraphConsent>`** component (`src/components/graph-consent.tsx`). A **"Grant admin consent"** button opens the Microsoft admin-consent popup → the admin approves with their own account. A guided **one-time setup** disclosure shows the exact required scopes + a copy-paste **Microsoft Graph PowerShell snippet** (`buildConsentSetupSnippet`, resolves scopes in the admin's own session — no GUIDs, **Argus needs zero elevated permissions**) + an Entra portal deep link.
- **Advanced (opt-in, behind a disclosure):** the programmatic self-grant, gated on the (now-correct) bootstrap-ready signal. `runGrant` now **surfaces manifest-PATCH failures** (`manifestError`) instead of silently swallowing them.
- **In both surfaces:** `<GraphConsent variant="full" />` replaces the Settings two-step block; `<GraphConsent variant="compact" reportScopes={…} />` replaces the job-form "Required permissions" panel (Grant admin consent + Re-check + "Full setup in Settings →"). Same flow on create **and** edit.
- **Shared source of truth:** new `GET /api/integrations/microsoft365/required-permissions` → `{ scopes, snippet, clientId }` (13 scopes verified live).
- **Files:** `src/services/graph/connection-test.ts`, `src/services/graph/permissions-grant.ts`, `src/lib/graph-consent.ts`, `src/components/graph-consent.tsx` (new), `src/app/api/integrations/[provider]/required-permissions/route.ts` (new), `src/app/settings/integrations/page.tsx`, `src/components/job-form.tsx`, `tests/graph-consent.test.ts`, `tests/permissions-grant-flow.test.ts`.
- **Security win:** secure default lets Argus run with **no** `Application.ReadWrite.All` / `AppRoleAssignment.ReadWrite.All` (Tier-0) — those become opt-in Advanced only.
- **Gate:** tsc 0 · tests 223 pass · build 0. Dev server: required-permissions API + `/settings/integrations` + `/jobs/new` all 200.
- **Commit:** `eae07e7`

### MANUAL TEST NEEDED (live tenant)
1. Settings → Integrations → expand **One-time setup**, run the PowerShell snippet once as a Global Admin (or add scopes in the portal). Then click **Grant admin consent** → approve in the popup → **Re-validate** greens.
2. Job create/edit → permissions panel → **Grant admin consent** → approve → **Re-check** shows granted.
3. Negative: before consent, **Re-validate** shows "consent pending — can't read grants yet" (not a false all-missing list).

## Follow-up: Graph grant orchestration now unit-tested (DI) — 2026-06-15

- **What:** Made the Microsoft Graph client **injectable** into `grantMissingPermissions` (new `GrantDeps { client, clientId, testConnection }`; defaults still wire the live shared client + vault + `testConnection`). This let me unit-test the full D2 orchestration with a fake client + injected probe — **no tenant required** — closing the biggest gap that was previously "MANUAL TEST NEEDED".
- **Coverage:** `permissions-grant.ts` **30.6% → 98.85% lines / 100% funcs**. Overall **88.9% / 89.6%**.
- **Tests added (8):** GRANT-3 (an appRoleAssignment per missing role; missing clears), GRANT-4 (manifest `requiredResourceAccess` declared), GRANT-5 (403 → bootstrap-hint error + `error` audit), 409 already-assigned treated as granted, partial grant → `partial` audit, unknown scope skipped, nothing-missing no-op, missing-client-id guard. GRANT-6 audit outcomes asserted against a real DB.
- **Files:** `src/services/graph/permissions-grant.ts` (DI seam), `tests/permissions-grant-flow.test.ts` (new).
- **Gate:** tsc 0 · tests 219 pass · build 0.
- **Commit:** `7872c54`
- **Still genuinely manual (live tenant only):** the real `/adminconsent` click + redirect round-trip, and the actual Graph network calls against a tenant. The *logic* of all of it is now automated.

## F8: Test-send + Job failure alerts — 2026-06-15

- **What:**
  - **Test-send** ("email me a sample"): `POST /api/jobs/:id/test-send` renders a sample report (sample data + the job's resolved template) and sends it to the request's `to`, else admin contacts, else global recipients, with a `[TEST]` subject prefix. Guarded on a validated mailbox. **Test-send** button added to the job card actions.
  - **Job failure alerts**: new `settings.alert_threshold` (0 = off). After a run ends `failed`, the executor emails admin contacts **once**, exactly when the consecutive-failure streak reaches the threshold (`shouldAlertOnFailures` fires at `=== threshold`, not on every later fail). Best-effort — alert failure never masks the original error. New **Failure alert threshold** field on the General settings tab.
  - Pure builders + counters in `src/services/dispatch/alerts.ts` (`consecutiveFailures`, `shouldAlertOnFailures`, `buildFailureAlertEmail`, `buildTestSendEmail`).
- **Files:** `src/services/dispatch/alerts.ts` (new), `src/services/executor.ts`, `src/app/api/jobs/[id]/test-send/route.ts` (new), `src/db/schema.ts`, `src/lib/validation.ts`, `src/app/settings/page.tsx`, `src/components/job-actions.tsx`, `drizzle/0010_deep_terror.sql` (new), `tests/alerts.test.ts` (new), `tests/executor.test.ts`.
- **Tests:** alerts pure logic (streak counting, threshold edge cases incl. no re-fire + 0-disables, alert/test-send message construction) + an executor integration test asserting admins get one email when a job hits the threshold.
- **Gate:** tsc 0 · tests 211 pass · build 0.
- **Commit:** `ad2a50f`

### MANUAL TEST NEEDED (live tenant — sends real email)

The send paths use Graph `sendMail` from the shared mailbox — verify on a real tenant once credentials are validated (Settings → Integrations → Test Connection green):

1. **Test-send:** open any job's actions → **Test-send**. Expect a `[TEST] …` sample email at your admin contacts (or the job's recipients). If the mailbox isn't validated the API returns a clear "run Test Connection first" error (no send).
2. **Failure alerts:** set **Failure alert threshold** = N on the General tab. Make a job fail N times in a row (e.g. point it at a report whose scope isn't granted). Expect exactly one alert email to admin contacts on the Nth failure, none before, and no repeat on failure N+1.

## F7: Test coverage → 80% — 2026-06-15

- **What:** Baseline coverage was already **86.3% funcs / 87.3% lines** (≥80%). Backfilled the weakest pure-logic areas to lift it and harden the new report summaries: tier-3 report summaries, tier-2 CSV usage-report summaries, and the email-dispatch guard/seam. Final: **88.2% funcs / 88.2% lines**, 198 tests / 0 fail. (Remaining gaps are live-Graph paths — `connection-test`, `permissions-grant` D2, `scheduler` cron callbacks — which need a real tenant; covered by the Phase-2 manual runbook.)
- **Files:** `tests/catalog-tier3.test.ts` (new), `tests/catalog-csv-summaries.test.ts` (new), `tests/dispatch-email.test.ts` (new).
- **Tests added:** tier-3 summaries (risk detections, SP risk, custom-attr audits, SP sign-ins — high-risk/failure/distinct-app counts + row mapping + fallbacks); CSV summaries (teams/mailbox/groups/onedrive/sharepoint/email/active-users — stale/near-quota/inactive thresholds, incl. the `col()` substring-match ordering quirk); email dispatch (empty-recipient `DispatchError` guard + transport injection seam).
- **Gate:** tsc 0 · tests 198 pass · build 0 · coverage 88.2%/88.2%.
- **Commit:** `a0f15cd`

## F6: HE / RTL — SKIPPED

Skipped per user request mid-run (2026-06-15). No code changed. Remains open for a future session: when `settings.language === "he"`, set `<html dir="rtl" lang="he">` and render dates in Hebrew (`he-IL`) locale.

## F5: Template version history — 2026-06-15

- **What:** Every template save snapshots the **prior** content into a new `template_versions` row (transactional with the update, so history never diverges). Templates editor gains a **Version history** list (newest first, `v#` + subject + timestamp) with **Revert** per version. Reverting restores a snapshot's content and is itself versioned. New `GET /api/templates/:id/versions` + `POST /api/templates/:id/versions/:versionId/revert`.
- **Files:** `src/db/schema.ts` (new `template_versions` table + `idx_template_versions_template`), `src/db/dao/templates.ts` (snapshot-on-update + `templateVersionsDao`), `src/app/api/templates/[id]/versions/route.ts` (new), `src/app/api/templates/[id]/versions/[versionId]/revert/route.ts` (new), `src/app/templates/page.tsx`, `drizzle/0009_cooing_hellcat.sql` (new), `tests/templates.test.ts`, `tests/db.test.ts` (now 11 tables).
- **Tests:** snapshot-per-save, newest-first ordering, revert restores prior content + re-versions.
- **Gate:** tsc 0 · tests 182 pass · build 0.
- **Commit:** `d9456de`
- **Commit:** `340fe23`
