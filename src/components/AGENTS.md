# UI Components

## Overview

Client components + in-house SVG icon system. No third-party component or icon libraries. Custom design system (Vivid+Co darkroom editorial).

## Structure

| File | Purpose |
|------|---------|
| `app-shell.tsx` | Persistent sidebar + header layout, nav groups, theme toggle |
| `icons.tsx` | All SVG icons — 24px grid, 1.7 stroke, `currentColor`, no fill |
| `job-form.tsx` | Shared create/edit job form (schedule preview, send condition, advanced template) |
| `create-job-client.tsx` | Creation-page wrapper — quick-setup presets + JobForm |
| `job-actions.tsx` | Run/disable/delete job actions |
| `settings-nav.tsx` | Settings sub-navigation |
| `ui/` | Primitive components |

### `ui/` Primitives

| File | Purpose |
|------|---------|
| `metric.tsx` | Metric card (label + value + optional delta) |
| `status-pill.tsx` | Status indicator pill (color-coded) |
| `primitives.tsx` | Button, input, select, textarea, label, badge |

## Conventions

- All components use `"use client"` directive
- Icons are inline SVG via `Svg` wrapper — sized via Tailwind classes (`h-4 w-4`)
- No third-party icons (Lucide, Heroicons, etc.) — always add to `icons.tsx`
- Tailwind class merging via `cn()` utility from `@/lib/utils`
- Premium card pattern: `card-premium` class (hairline border, no fill/shadow/elevation)
- Animations: `fade-in`, `fade-in-up`, `scale-in`, `slide-in-right` (Tailwind keyframes)
- Theme: dark/light via `localStorage` key `argus-theme`, `class` strategy
