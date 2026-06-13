# Spec — Frontend Overhaul + Next.js 16 Migration

> Companion to [`spec.md`](./spec.md). Scope: premium UI redesign, three workflow
> changes, real-navigation E2E, and the Next 14 → 16 upgrade. **Last updated:** 2026-06-13.

## 1. Goals

- G1. UI reads as a bespoke, high-end admin product (Linear/Vercel/Stripe-class), not a Next.js starter.
- G2. Catalog → Template is a direct, one-click workflow per report.
- G3. Template editor supports HTML **and** plain-text bodies via a toggle (both persisted; email sends multipart).
- G4. All app configuration (vault, integrations, permissions) lives under one **Settings** section.
- G5. Run the stack on **Next.js 16** with no regressions; E2E proves real navigation in Docker.

## 2. Next.js 16 migration (grounded in the upgrade guide)

| Change | Action in this codebase |
|--------|-------------------------|
| Async `params` (route.js/page.js) | Every dynamic handler + `executions/[id]/page.tsx` → `params: Promise<…>` + `await params`. Affects: `api/jobs/[id]`(+run,executions), `api/executions/[id]`(+preview), `api/baselines/[jobId]`, `api/integrations/[provider]/*`, `api/templates/[id]`. |
| `serverComponentsExternalPackages` | Rename to top-level `serverExternalPackages`. |
| Turbopack default build | Build/dev pinned to `--webpack` to preserve the `bun:sqlite` `__non_webpack_require__`/`createRequire` loader (Turbopack lacks the webpack global). |
| React 19 | Bump `react`/`react-dom`@19, `@types/react`@19. Components are simple + compatible. |
| Node 20.9+ / TS 5.1+ | Already satisfied (Bun runtime; TS 5.6). |
| `next lint` removed | Drop reliance; `bun run lint` becomes optional/eslint-cli. |
| AMP, runtime config | Not used — no action. |

**Acceptance:** AC-N1 `next build --webpack` green on Next 16. AC-N2 `bun test` + E2E green. AC-N3 Docker container boots + healthy on Next 16.

## 3. Workflow requirements

### 3.1 Catalog → Template (G2)
- Each catalog report card is a link to `/settings/templates?report=<reportId>` (templates live under Settings, see 3.3) — or `/templates?report=<id>` if templates stay top-level. **Decision:** keep **Templates** as a top-level section (it is a primary workflow), and deep-link `/templates?report=<reportId>`.
- The template editor reads `?report=` and pre-selects that report's default template.
- **AC-C1** Clicking report "Risky Users Report" lands on the template editor with that report's template selected.

### 3.2 Template HTML/Text toggle (G3)
- Add `textBody` (nullable text) to the `templates` table; seed a sensible plain-text default per report.
- Editor has a segmented toggle **HTML | Text**:
  - HTML mode → edit `htmlBody`, preview = rendered iframe.
  - Text mode → edit `textBody`, preview = monospace plain-text render (sample-data substituted, no HTML).
- Save persists the active body; both bodies retained.
- Email dispatcher sends multipart (text alternative when `textBody` present).
- **AC-T1** Toggling HTML↔Text swaps the editor content + preview rendering. **AC-T2** Saving in each mode persists that body. **AC-T3** `/api/templates/preview` accepts `mode: "html"|"text"`.

### 3.3 Integrations → Settings (G4)
- `/settings` becomes a sectioned hub with sub-navigation: **Credentials** (vault + test connection), **Integrations** (M365 + webhooks + placeholders), **Permissions** (status + remediate).
- Routes: `/settings` (Credentials default), `/settings/integrations`, `/settings/permissions`. Shared settings layout renders the sub-nav.
- Remove "Integrations" from the primary sidebar; it appears only under Settings.
- **AC-S1** Sidebar has no top-level Integrations. **AC-S2** `/settings` shows sub-nav; clicking "Integrations" routes to `/settings/integrations` and shows the M365 card + webhook manager.

## 4. Premium UI direction (G1, PRD §9 anti-slop)

- Distinct visual identity: refined type scale, restrained accent gradient on the brand mark + primary only, layered elevation, hairline borders, generous spacing, tabular numerics for metrics.
- Sidebar with grouped sections (Operate / Configure) + a top command-style header with breadcrumb/title.
- Polished primitives: segmented control, tabs, tooltip-ish titles, refined cards with header rules, console viewer with severity color-coding, skeleton loaders, empty states with dotted grid.
- Motion: subtle fade/translate on route content; hover elevation on cards. No floating 3D, no random glassmorphism, no generic hero gradient.
- Dark + light both first-class; RTL-safe (logical spacing).

**Acceptance:** AC-U1 No default-starter artifacts (no unstyled lists, no default Next link styles). AC-U2 Dashboard < 2s with 50 jobs. AC-U3 Dark/light both render cleanly.

## 5. E2E with real navigation (G5)

Playwright must **click**, not just `goto`:
- AC-E1 From `/dashboard`, click sidebar **Catalog** → URL `/catalog`.
- AC-E2 On Catalog, click a report card → URL `/templates?report=<id>`, editor shows that template.
- AC-E3 In editor, click **Text** toggle → editor shows text body; click **HTML** → back to HTML.
- AC-E4 Click sidebar **Settings** → `/settings`; click **Integrations** sub-nav → `/settings/integrations`, M365 card visible.
- AC-E5 Whole suite runs green against the app (Docker-verified build).

## 6. Risks / assumptions

- R1 Turbopack vs `bun:sqlite`: mitigated by `--webpack`. If `--webpack` is dropped later, the DB loader must be revisited.
- R2 React 19 type churn (forwardRef, ReactNode) — bump `@types/react` 19; fix any type drift.
- R3 Adding `textBody` is a schema migration — generate + apply; seed backfills defaults.
- A1 Templates stay a top-level section (primary workflow); only Integrations moves into Settings.
