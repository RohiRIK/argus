# Argus Documentation

> **Version:** 0.2.0
> **Last updated:** 2026-06-16
> **Status:** Living documentation

---

## Quick Start

| Document | Purpose |
|----------|---------|
| [PRD](./00-PRD/PRD.md) | Product requirements — what we're building and why |
| [Architecture](./01-Architecture/ARCHITECTURE.md) | System overview — how it all fits together |
| [Setup Guide](./04-Guides/SETUP.md) | First-time setup — get Argus running |

---

## Architecture (`01-Architecture/`)

Deep technical documentation of every system layer.

| Document | Covers |
|----------|--------|
| [ARCHITECTURE.md](./01-Architecture/ARCHITECTURE.md) | High-level system design, tech stack, deployment |
| [SERVICES.md](./01-Architecture/SERVICES.md) | Business logic — reports, executor, scheduler, vault, graph, dispatch |
| [DATABASE.md](./01-Architecture/DATABASE.md) | Schema (10 tables), client, DAOs, migrations |
| [API.md](./01-Architecture/API.md) | REST endpoints — every route, method, request/response |
| [UI.md](./01-Architecture/UI.md) | Pages, components, design system, navigation |
| [SECURITY.md](./01-Architecture/SECURITY.md) | Vault, auth, permissions, RBAC, audit |
| [TESTING.md](./01-Architecture/TESTING.md) | Test strategy, patterns, coverage, green gate |

---

## Specifications (`02-Specs/`)

Technical specifications with acceptance criteria.

| Document | Covers |
|----------|--------|
| [spec.md](./02-Specs/spec.md) | Main technical spec — goals, NFRs, cross-cutting strategies |
| [spec-ux.md](./02-Specs/spec-ux.md) | Full UX spec — navigation, workflows, future enhancements |
| [spec-backend-efficiency.md](./02-Specs/spec-backend-efficiency.md) | Backend performance findings and fixes |
| [spec-frontend-overhaul.md](./02-Specs/spec-frontend-overhaul.md) | Frontend redesign goals and migration |
| [spec-settings-and-catalog.md](./02-Specs/spec-settings-and-catalog.md) | Settings platform + 11 new reports |

---

## Plans (`03-Plans/`)

Execution plans mapped to specifications.

| Document | Covers |
|----------|--------|
| [done-plan.md](./03-Plans/done-plan.md) | Main execution plan |
| [done-plan-backend-efficiency.md](./03-Plans/done-plan-backend-efficiency.md) | Backend performance plan |
| [done-plan-frontend-overhaul.md](./03-Plans/done-plan-frontend-overhaul.md) | Frontend redesign plan |
| [done-plan-settings-and-catalog.md](./03-Plans/done-plan-settings-and-catalog.md) | Settings + catalog plan |

---

## Guides (`04-Guides/`)

Step-by-step operational guides.

| Document | Covers |
|----------|--------|
| [SETUP.md](./04-Guides/SETUP.md) | First-time setup — Entra ID, permissions, verification |

---

## Reference (`05-Reference/`)

Design system, workflows, and research.

| Document | Covers |
|----------|--------|
| [core-workflows.md](./05-Reference/core-workflows.md) | User journeys — create job, edit, run, logs, settings |
| [new-reports.md](./05-Reference/new-reports.md) | Report candidates — gap analysis, prioritization, blueprint |
| [redesign-frontend.md](./05-Reference/redesign-frontend.md) | Frontend redesign research — multi-model analysis, Vercel study |

---

## Archive (`06-Archive/`)

Deprecated or historical documents.

| Document | Covers |
|----------|--------|
| [NIGHTLY-PROMPT.md](./06-Archive/NIGHTLY-PROMPT.md) | Overnight autonomous session prompt |

---

## Agents (`07-Agents/`)

Agent editor and configuration.

| Document | Covers |
|----------|--------|
| [AGENT-EDITOR.md](./07-Agents/AGENT-EDITOR.md) | Creating, editing, and managing OpenCode agents |

---

## Project Root

| Document | Purpose |
|----------|---------|
| [AGENTS.md](../AGENTS.md) | Project knowledge base — stack, structure, conventions |
| [DESIGN.md](../DESIGN.md) | Design system — tokens, typography, layout |
| [INSTALL.md](../INSTALL.md) | Installation instructions |
| [CHANGELOG.md](../CHANGELOG.md) | Release history |

---

## Reading Order

### New to Argus?

1. [PRD](./00-PRD/PRD.md) — Understand what we're building
2. [Architecture](./01-Architecture/ARCHITECTURE.md) — See how it fits together
3. [Setup Guide](./04-Guides/SETUP.md) — Get it running
4. [User Workflows](./05-Reference/core-workflows.md) — How users interact

### Working on a Feature?

1. [Specifications](./02-Specs/) — Find the relevant spec
2. [Plans](./03-Plans/) — Check the execution plan
3. [Architecture docs](./01-Architecture/) — Understand the layer you're touching
4. [Testing](./01-Architecture/TESTING.md) — Know the green gate

### Debugging?

1. [Services](./01-Architecture/SERVICES.md) — Business logic
2. [Database](./01-Architecture/DATABASE.md) — Schema and DAOs
3. [API](./01-Architecture/API.md) — Route handlers
4. [Security](./01-Architecture/SECURITY.md) — Auth and permissions

---

## Document Conventions

- **Architecture docs** — How the system works (living, updated with code changes)
- **Specifications** — What we're building (acceptance criteria, design decisions)
- **Plans** — How we're building it (phased execution, dependencies)
- **Guides** — How to operate it (step-by-step instructions)
- **Reference** — Supporting materials (research, workflows, design system)

---

**Maintained by:** Sisyphus (AI Agent)
**Last full review:** 2026-06-16
