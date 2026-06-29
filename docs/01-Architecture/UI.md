# UI Layer

> **Location:** `src/app/` (pages) + `src/components/` (components)
> **Framework:** Next.js App Router + React 19
> **Styling:** Tailwind CSS (custom design tokens)
> **Icons:** In-house SVG system

---

## Overview

Argus uses Next.js App Router with client-side components. The UI follows a Jenkins-inspired operational model with a premium editorial aesthetic.

### Design System

**Philosophy:** Operator — refined SaaS (Linear/Vercel-grade). Cool-neutral canvas,
one scarce muted-cobalt accent, soft radius, subtle elevation. See
`docs/02-Specs/spec-frontend-operator.md`. (Supersedes the retired "darkroom editorial"
direction — warm graphite/amber/0px/no-shadow/grain.)

| Token | Dark Mode | Light Mode |
|-------|-----------|------------|
| Canvas | `222 16% 9%` (cool near-black) | `220 20% 98%` (cool off-white) |
| Foreground | `210 16% 96%` | `222 24% 14%` |
| Accent | `224 70% 62%` (muted cobalt) | `224 64% 52%` |
| Muted | `215 12% 70%` | `220 10% 38%` |
| Border | `220 10% 24%` | `220 14% 86%` |
| Radius | `4 / 6 / 8 / 12px` | same (theme-invariant) |

**Conventions:**
- Soft radius via `rounded-*` (resolves to `--radius-*` tokens, 4–12px).
- Subtle single-step elevation only — `shadow-sm`/`shadow` for cards/overlays; no stacks, no glow, no hover-lift translate.
- Accent is scarce: primary action, active nav, focus, links. Semantic state colors stay separate.
- No third-party icon libraries; in-house SVG only.

---

## Pages (`src/app/`)

### Dashboard (`/dashboard`)

**Purpose:** Overview of all jobs, status, actions.

**Components:**
- `dashboard-client.tsx` — Main dashboard view
- Metric cards (4-across grid) — Total jobs, active, failed, last run
- Job list — Table with status, last run, next run, actions
- Bulk operations — Select multiple jobs for enable/disable/delete

**Features:**
- Tag filter for organization
- Search by job name
- Execution timeline sparkline
- Job health scoring (healthy/warning/critical)

---

### Catalog (`/catalog`)

**Purpose:** Browse report types → create job.

**Components:**
- `create-job-client.tsx` — Catalog view with report cards
- `catalog-permissions-banner.tsx` — Shows required permissions

**Features:**
- Reports grouped by category (Identity, Security, Infrastructure, Custom)
- Each card shows: description, required permissions, baseline support
- Click → dedicated creation page (`/jobs/new?report=<id>`)

---

### Job Creation (`/jobs/new`)

**Purpose:** Configure and create a new job.

**Components:**
- `create-job-form.tsx` — Job configuration form
- `create-job-dialog.tsx` — Confirmation dialog

**Fields:**
- Job name (pre-filled from report name)
- Description
- Recipients (comma-separated emails)
- Schedule (preset picker or custom cron)
- Conditional rules
- Template selection (Advanced)
- Tags

---

### Job Edit (`/jobs/[id]/edit`)

**Purpose:** Modify existing job configuration.

**Components:**
- `job-form.tsx` — Shared job form
- `job-actions.tsx` — Run, clone, snooze, delete actions

---

### Logs (`/logs`)

**Purpose:** Console-style execution log viewer.

**Features:**
- Filter by level (info/warning/error)
- Click → execution detail page
- Monospace terminal aesthetic

---

### Execution Detail (`/executions/[id]`)

**Purpose:** Full details of a single execution.

**Features:**
- Status and timestamps
- Graph API latency
- Records processed
- Baseline comparison
- Rendered report preview (HTML)
- Delivery status (email/webhook)
- Run history timeline

---

### Execution Compare (`/executions/compare`)

**Purpose:** Side-by-side diff of two executions.

**Features:**
- Pick two executions
- Compare counts, baselines, logs
- Read-only view

---

### Templates (`/templates`)

**Purpose:** Standalone HTML/text template editor.

**Features:**
- Sidebar list of templates
- HTML/Text toggle
- Live preview (auto-updates)
- Variable insertion buttons
- Version history

---

### Settings (`/settings`)

**Purpose:** System configuration.

**Tabs:**
1. **General** (default) — Global recipients, admin contacts, language, timezone, retention, from-address, reply-to, alert threshold
2. **Integrations** — Collapsible vendor cards (Microsoft 365 primary)

**Microsoft 365 card:**
- Credential fields (inline)
- Connection status badge
- Test Connection / Reconnect
- Permission validation
- Webhook management

---

## Components (`src/components/`)

### Layout

| Component | Purpose |
|-----------|---------|
| `app-shell.tsx` | Main layout with sidebar + header + content |
| `settings-nav.tsx` | Settings tab navigation |

### Forms

| Component | Purpose |
|-----------|---------|
| `job-form.tsx` | Job configuration form (shared) |
| `create-job-form.tsx` | Job creation form |
| `create-job-dialog.tsx` | Confirmation dialog |
| `create-job-client.tsx` | Catalog view |

### Display

| Component | Purpose |
|-----------|---------|
| `dashboard-client.tsx` | Dashboard view |
| `catalog-permissions-banner.tsx` | Permissions warning |
| `graph-consent.tsx` | OAuth consent flow |
| `job-actions.tsx` | Job action buttons |

### Icons

| Component | Purpose |
|-----------|---------|
| `icons.tsx` | In-house SVG icon system |

**Icon conventions:**
- 24px grid
- 1.7px stroke
- `currentColor` for fill
- No third-party icon libraries

---

## UI Primitives (`src/components/ui/`)

Shared primitives (no component library):

- `metric.tsx` — Metric display card
- `status-pill.tsx` — Status indicator pill
- `primitives.tsx` — Base UI elements

---

## Navigation

```
Dashboard  (/dashboard)         — Overview of all jobs
Catalog    (/catalog)           — Browse reports → create job
Logs       (/logs)              — Console-style log viewer
Templates  (/templates)         — HTML/text template editor
Settings   (/settings)          — General + Integrations
```

**Sidebar groups:**
- **Operate:** Dashboard, Catalog, Logs
- **Configure:** Templates, Settings

---

## Theme

**Dark/Light toggle:**
- Persisted in `localStorage` key `argus-theme`
- Default: dark
- Toggle in sidebar footer

**Grain texture:**
- CSS noise overlay on body + sidebar
- Subtle texture, not distracting

---

## Animations

- `fade-in` — Page content entry
- Hover transitions on interactive elements
- Status pill pulse for running jobs

---

## RTL Support

- Full Hebrew support
- `dir="rtl"` when language = HE
- Date formatting localized
- UI direction flips automatically

---

## Conventions

- **All client components** use `"use client"`
- **No component library** — custom primitives only
- **No shadows** — depth from typography + contrast
- **No border radius** — 0px everywhere
- **Warm monochrome** — amber accent used sparingly
- **Editorial typography** — hierarchy from size + weight, not containers

---

**References:**
- [Design System](../05-Reference/DESIGN.md) — Visual language
- [Services Layer](./SERVICES.md) — Backend logic
- [API Layer](./API.md) — Data fetching
