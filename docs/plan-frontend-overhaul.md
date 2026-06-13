# Plan — Frontend Overhaul + Next.js 16

From [`spec-frontend-overhaul.md`](./spec-frontend-overhaul.md). Linear deps; commit + verify per phase.

## C0 — Next.js 16 migration (foundation)
- Bump `next@16`, `react@19`, `react-dom@19`, `@types/react@19`, `@types/react-dom@19`, `eslint-config-next@16`.
- `next.config.mjs`: `experimental.serverComponentsExternalPackages` → top-level `serverExternalPackages`; keep headers; no webpack key.
- Scripts: `build`/`dev`/`start` pin `--webpack` (preserve bun:sqlite loader).
- Async `params`: convert all dynamic route handlers + `executions/[id]/page.tsx` to `Promise` params + `await`.
- **Verify:** `bun run typecheck`, `bun test`, `next build --webpack` green. **AC-N1/N2.**

## C1 — Template text body (textBody)
- Schema: add `textBody text` (nullable) to `templates`; `db:generate` migration.
- `renderReport`/`renderSubject`: add text rendering (strip-free plain-text body render with same vars, no HTML escaping needed for text/plain output).
- Seed: default `textBody` per report.
- `/api/templates/preview`: accept `mode`; render html or text.
- Email dispatcher: include text alternative when present.
- **Verify:** unit tests (text render, preview mode). **AC-T2/T3.**

## C2 — Settings consolidation
- `src/app/settings/layout.tsx` with sub-nav (Credentials / Integrations / Permissions).
- Move integrations UI → `/settings/integrations`; add `/settings/permissions`; `/settings` = Credentials.
- Remove Integrations from sidebar nav; Settings stays.
- **Verify:** routes render; **AC-S1/S2.**

## C3 — Catalog → Template deep-link
- Catalog report cards become `<Link href="/templates?report=<id>">`.
- Templates editor reads `?report=` (useSearchParams) → preselect that report's template.
- **Verify:** **AC-C1.**

## C4 — HTML/Text toggle
- Segmented control in editor; switches edited body (htmlBody/textBody) + preview mode.
- Save persists active body.
- **Verify:** **AC-T1.**

## C5 — Premium UI polish
- Elevate tokens (type scale, elevation, accent), sidebar grouped sections (Operate/Configure), refined header, segmented control + tabs primitives, motion, console polish, skeletons/empty states.
- **Verify:** **AC-U1/U3**, build green.

## C6 — Real-navigation E2E + Docker
- Rewrite E2E to click nav + cards + toggles + settings sub-nav (AC-E1..E5).
- Rebuild Docker image (Next 16, bun 1.3-alpine) + `docker compose up` + smoke + run E2E against build.
- **Verify:** all E2E green; container healthy. **AC-N3, AC-E5.**

## C7 — Final sweep
- tsc + unit + build + e2e + docker; openltm log; commit per phase; final report.
