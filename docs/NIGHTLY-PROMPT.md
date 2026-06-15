# Argus — Overnight Autonomous Session (paste this into a fresh Claude Code session)

You are running **unattended overnight** on the Argus repo. Goal: ship new features, add CI,
and fix the Microsoft Graph authorization flow — safely, so the human reviews in the morning.
Repo: `~/.../06-Projects/23-Argus` · Stack: Next.js 16 App Router + Bun + Drizzle (bun:sqlite) ·
Package manager: **bun** (never npm).

---

## NON-NEGOTIABLE GUARDRAILS (read twice)

1. **Branch only.** First thing: `git checkout -b nightly/2026-06-15`. NEVER commit to `main`,
   NEVER merge to `main`. Pushing the **nightly branch** is allowed (so CI runs); merging is not.
2. **Green gate on every commit.** A commit lands only if `bunx tsc --noEmit` (0 errors),
   `bun test tests/` (0 fail), and `bun run build` all pass. If an item goes red and you can't
   fix it in ~15 min, `git restore`/revert that item and move on. **Never leave the tree broken.**
3. **No secrets, no `.env`, no `main`.** Do not touch `.env`, vault data, or credentials.
4. **Live-tenant work = build + document, don't fake-verify.** Anything needing a real Microsoft
   365 tenant (the actual Graph consent click, real `Mail.Send`, real CSV report shapes) — build
   it, unit-test the pure logic, and write the **manual verification steps** in `NIGHTLY.md` for
   the human. Do NOT claim it works end-to-end.
5. **Log everything** (see Logging).

---

## CONTEXT — read these first (do not skip)

- `docs/spec-settings-and-catalog.md` — spec + acceptance criteria (Workstreams A–D)
- `docs/plan-settings-and-catalog.md` — phase plan (C-workstream + P1–P9 already shipped)
- `docs/workflow.md` §8 / §8.5 — feature backlog
- `CHANGELOG.md` — what shipped in v0.2.0
- Run `git log --oneline -10` and `bun test tests/` to confirm a green baseline before starting.

Commands you'll use: `bunx tsc --noEmit` · `bun test tests/` · `bun run build` ·
`bun run db:generate` (after schema edits) · `bun run db:migrate` (apply to dev DB) ·
`bun run e2e` (Playwright, starts its own server) · `bun run dev` / `bun run start` (port 8100).

---

## LOGGING

- Create `NIGHTLY.md` at the repo root. Append a block per item:
  `## <feature> — <timestamp>` → what changed, files, gate result (tsc/tests/build), commit SHA,
  and `MANUAL TEST NEEDED:` notes for anything live-tenant-dependent.
- After each finished feature, also run `/capture` and `/openltm:memory learn` to persist insight.

---

## PHASES (in order)

### Phase 0 — Setup
- `git checkout -b nightly/2026-06-15`; create `NIGHTLY.md`; confirm baseline green.

### Phase 1 — CI (GitHub Actions)
- Add `.github/workflows/ci.yml`: on push + pull_request → `bun install` → `bunx tsc --noEmit`
  → `bun test tests/` → `bun run build`. Use `oven-sh/setup-bun@v2`. Set
  `ARGUS_MASTER_KEY: "0000000000000000000000000000000000000000000000000000000000000000"`
  (64 hex) as a job env so DB/vault-touching tests pass. Commit, push the nightly branch,
  confirm the workflow is picked up.

### Phase 2 — Fix the Graph authorization flow (PRIORITY)
**The bug:** clicking *Authorize self-management* opens Microsoft `/adminconsent`, which only
consents permissions **already declared in the app manifest** — so it does NOT grant the report
scopes. Those are added by the *second* button, **Grant missing permissions** (the programmatic
`appRoleAssignment` in `src/services/graph/permissions-grant.ts`), which only works AFTER the two
bootstrap scopes (`Application.ReadWrite.All` + `AppRoleAssignment.ReadWrite.All`) are consented.
It's a deliberate two-step that the UX presents as one click.

Do:
- Handle the **admin-consent redirect return**: `/settings/integrations?admin_consent=True&tenant=…`
  (or `?error=…`). On return, show a clear result and auto re-run Test Connection.
- Make the **two-step flow explicit** in the M365 card: Step 1 "Authorize self-management"
  (one-time), Step 2 "Grant missing permissions". Disable Step 2 until bootstrap scopes are
  present; explain why.
- Add the **GRANT-6 audit log** (record grant attempts + outcomes; a simple `audit` table + a
  small viewer, or append to the logs table).
- Unit-test the pure logic (redirect-param parsing, `mapScopesToRoleIds`, `buildRequiredResourceAccess`,
  `computeMissing`). The live consent click is the human's morning test — write the exact runbook
  in `NIGHTLY.md`:
  1. Add `Application.ReadWrite.All` + `AppRoleAssignment.ReadWrite.All` to the Entra app once.
  2. Click *Authorize self-management* → consent → returns to Argus.
  3. Click *Grant missing permissions* → confirm the Missing list clears + Test Connection greens.

### Phase 3 — New features (backlog, ordered low→high risk)
Build each one, fully, in this order. Stop a feature only if it can't go green.
1. **Dashboard search** — text search by job name + filter by status/report-type (next to the tag filter). Pure UI.
2. **Report download** — execution-detail button → download rendered HTML, and rows as CSV. Data already stored.
3. **Snooze a job** — pause N hours/days without disabling; scheduler skips while snoozed; auto-resume; "snoozed until X" pill + un-snooze. (migration + scheduler guard)
4. **Compare two executions** — pick two, side-by-side diff of counts/baseline/logs. Read-only.
5. **Template version history** — snapshot a template on save; list + revert previous versions. (migration + UI)
6. **HE / RTL** — when language = HE, apply `dir="rtl"` + Hebrew-locale dates (today it's only saved).
7. **Test coverage → 80%** — backfill unit tests for executor, scheduler, dispatch/email, backup, the new report summaries.

Buildable but mark **MANUAL TEST NEEDED** (need tenant to verify send):
- **Test-send** ("email me a sample") · **Job failure alerts** (notify admins after N consecutive fails).

### Phase 4 — Wrap up
- Open a **draft PR** from `nightly/2026-06-15` → `main` (do NOT merge) titled
  `nightly: features + CI + auth flow` with the `NIGHTLY.md` summary in the body.
- Final `NIGHTLY.md` section: everything done, every commit SHA, all `MANUAL TEST NEEDED` items,
  and anything you got stuck on.

---

## PER-FEATURE WORKFLOW — run these skills in THIS chronological order

For **every** backlog item and the auth fix, follow the full chain (don't skip steps):

1. `/spec` — explore code + LTM, write acceptance criteria for the item.
2. `/plan` — break the item into tasks mapped to those criteria.
3. `/build` (task-by-task) **or** `/dev` (full-auto) — implement. Run `bun run db:generate`
   + `bun run db:migrate` after any schema change.
4. `/test` — TDD / regression for the item (and `/tdd` when writing a feature test-first).
5. `/e2e` — only for items with a real user flow (search, download, snooze, compare); skip for pure-logic.
6. `/simplify` — post-implementation cleanup of the changed code.
7. `/capture` — save progress to context + fire `/learn` (and `/openltm:memory learn` for durable insight).
8. `/verify` — the gate: tsc → tests → build → security → diff. **Must be green.**
9. `/code-review` — review the item's diff; fix CRITICAL/HIGH before committing.
10. **Commit on the branch** (conventional message, no `Co-Authored-By` footer) → **push the nightly
    branch** so CI runs. **Do NOT** use `/commit-push-pr` (it targets main) and **do NOT** merge.

Use `/loop` (self-paced, no interval) to drive this overnight: each loop iteration = pick the next
backlog item → run steps 1–10 → append to `NIGHTLY.md` → continue. End the loop when the backlog
is done or you're blocked, then do Phase 4.

---

## STOP CONDITIONS
- Backlog complete → Phase 4 → stop.
- Same item red twice after a revert → skip it, note in `NIGHTLY.md`, continue.
- Anything that would touch `main`, push to `main`, edit `.env`, or expose a secret → STOP that
  action, log it, continue with the next item.
