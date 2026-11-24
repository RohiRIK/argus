# Argus Documentation

> **Version:** 0.4.0
> **Last updated:** 2026-09-27
> **Status:** Living documentation (public set)

Internal PRD / specs / plans / reference / archive live locally and are gitignored.
This index lists only what ships on GitHub.

---

## Quick Start

| Document | Purpose |
|----------|---------|
| [Architecture](./01-Architecture/ARCHITECTURE.md) | System overview — how it all fits together |
| [Setup Guide](./04-Guides/SETUP.md) | First-time setup — get Argus running |
| [Report catalog](./04-Guides/report-catalog.md) | Built-in reports and live-review status |

---

## Architecture (`01-Architecture/`)

Deep technical documentation of every system layer.

| Document | Covers |
|----------|--------|
| [ARCHITECTURE.md](./01-Architecture/ARCHITECTURE.md) | High-level system design, tech stack, deployment |
| [SERVICES.md](./01-Architecture/SERVICES.md) | Business logic — reports, executor, scheduler, vault, graph, dispatch |
| [DATABASE.md](./01-Architecture/DATABASE.md) | Schema, client, DAOs, migrations |
| [API.md](./01-Architecture/API.md) | REST endpoints — every route, method, request/response |
| [UI.md](./01-Architecture/UI.md) | Pages, components, design system, navigation |
| [SECURITY.md](./01-Architecture/SECURITY.md) | Vault, auth, permissions, RBAC, audit |
| [TESTING.md](./01-Architecture/TESTING.md) | Test strategy, patterns, coverage, green gate |

---

## Guides (`04-Guides/`)

Step-by-step operational guides.

| Document | Covers |
|----------|--------|
| [SETUP.md](./04-Guides/SETUP.md) | First-time setup — Entra ID, permissions, verification |
| [report-catalog.md](./04-Guides/report-catalog.md) | Report catalog / live-review tracker |

---

## Project Root

| Document | Purpose |
|----------|---------|
| [AGENTS.md](../AGENTS.md) | Project knowledge base — stack, structure, conventions |
| [DESIGN.md](../DESIGN.md) | Design system — tokens, typography, layout |
| [INSTALL.md](../INSTALL.md) | Installation instructions |
| [CHANGELOG.md](../CHANGELOG.md) | Release history |
| [README.md](../README.md) | Project overview |

---

## Reading Order

### New to Argus?

1. [Architecture](./01-Architecture/ARCHITECTURE.md) — See how it fits together
2. [Setup Guide](./04-Guides/SETUP.md) — Get it running
3. [Report catalog](./04-Guides/report-catalog.md) — What reports ship today

### Debugging?

1. [Services](./01-Architecture/SERVICES.md) — Business logic
2. [Database](./01-Architecture/DATABASE.md) — Schema and DAOs
3. [API](./01-Architecture/API.md) — Route handlers
4. [Security](./01-Architecture/SECURITY.md) — Auth and permissions
5. [Testing](./01-Architecture/TESTING.md) — Green gate

---

**Last full public-index review:** 2026-09-27
