# Plan — Settings & Platform + Catalog Reports (Core scope)

> Implements [`spec-settings-and-catalog.md`](./spec-settings-and-catalog.md). Scope = **Core**:
> A1 tz, A2 retention, A3 from/reply, A5 backup, A7 docs + B1/B2/B3 reports.
> **Deferred:** A4 digest/quiet-hours, A6 auth/RBAC (own epic).
> Each phase ends with `/simplify` + verify (tsc → tests → build).

## Workstream C — Reliability & Legibility (front of queue, from live testing feedback)

Real bugs found while testing against a live tenant. These run **first**.

| Phase | Deliverable | Fixes |
|-------|-------------|-------|
| **C1** | Required-permissions panel on the creation page (JobForm fetches catalog → shows the report's Graph scopes + "grant in Entra" hint) | "no permission section in creation" |
| **C2** | **Real connection test** — `testConnection` probes Graph per required scope incl. `Mail.Send`, returns the **specific missing scopes**; Permissions panel + Test Connection list them; no more false-green | "test marks green", "never tells which permission", "Mail.Send not granted" |
| **C3** | Per-report **default template content** (distinct bodies/variables) so previews differ | "every template same preview" |
| **C4** | **End-to-end run reliability** — a job run surfaces *why* it produced nothing (403 scope / no data / send failure) in the execution detail; clearer error + suppression reasons | "ran a report, got nothing" |
| **C5** | **Legibility/contrast pass** — audit dim/low-contrast text ("blurry/dim, hard to read"), raise muted-foreground contrast to WCAG AA | "text not clear, dim" |
| **C6** | **One-click permission grant** — D1 bootstrap admin-consent link + D2 programmatic grant of missing scopes (declare + appRoleAssignment via Graph) | GRANT-1..7 |

Then the original settings/reports phases:

| Phase | Deliverable | Spec AC |
|-------|-------------|---------|
| **P1** | Settings schema + validation + General-tab UI for tz / retention / from / reply (one migration) | ST-1, RT-1, FR-1 |
| **P2** | Timezone wiring: scheduler `{timezone}`, TZ-aware `nextRuns`/`describeSchedule`, dashboard preview | ST-2..4 |
| **P3** | Retention wiring: prune caller reads `retentionDays` (+ stretch: prune executions/logs) | RT-2..4 |
| **P4** | From/Reply-To wiring in the email-send path | FR-2..4 |
| **P5** | Backup export/import API + General-tab Export/Import | BK-1..4 |
| **P6** | CSV transport seam: `GraphTransport.getCsv` + parser + retry parity | CSV-1..4 |
| **P7** | 7 CSV usage reports (`catalog-csv.ts`) + register + seed + tests + count updates | RPT-CSV-* |
| **P8** | 4 Tier-3 JSON reports + register + seed + tests | RPT-JSON-* |
| **P9** | Docs: workflow.md §8 mark shipped + add §8.5 | DOC-1/2, A7 |

**Dependencies:** P2/P3/P4 depend on P1 (columns). P7 depends on P6 (getCsv). P8 independent. P9 last.
**Final tallies:** 26 reports, 26 templates, +6 settings columns (`timezone, retentionDays, fromAddress, replyTo` now; quietHours/digest deferred).
