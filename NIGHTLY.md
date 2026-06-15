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
