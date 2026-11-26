---
name: argus-plugin
description: Create or change an Argus catalog plugin — a report (read-only Graph data → email/history), an automation (plans and applies tenant changes with audit/enforce/rollback), or the email template they render with. Use when asked to add a new report, automation or template to Argus, or to fix one that fails `bun run plugin:validate`.
---

# Building an Argus plugin

Argus has one catalog with two plugin kinds that share the same app (jobs/policies, schedules, recipients, sender, templates, run history, audit). Every plugin must pass its **contract**, which CI enforces in the `Plugins (security · contract)` job. Never weaken a contract rule to make a plugin pass.

Pick the kind first:

| Need | Kind | Graph access | Lives in |
|------|------|--------------|----------|
| Show or alert on tenant data | **Report** | read-only (reporting app) | `src/plugins/reports/<id>/` or a declarative YAML/JSON manifest |
| Change the tenant (disable, remove, assign, fix drift) | **Automation** | read + write (separate automation app) | `src/services/automations/catalog/custom/<id>.ts` |
| Change how an email looks | **Template** | — | Templates page / `templates` table (no code) |

If the request only reads data, it is a report, not an automation.

## Report plugin

1. Scaffold: `bun run plugin:new <kebab-id> --category=identity|security|infrastructure|custom`
   (creates `plugin.ts`, `fixtures.json`, `plugin.test.ts` and updates `registry.generated.ts`).
2. Edit `plugin.ts` (`defineReportPlugin` from `@/plugins/sdk`):
   - `requiredPermissions`: every Graph **application** permission it uses — read scopes only (`*.Read.All`). Write scopes are rejected.
   - `fetch(transport)`: only `transport.get` / `transport.getCsv`; follow paging through the transport.
   - `summarize(rows)`: return `count`, `variables` (numbers/strings for `metric_delta` and templates) and at most 50 display `rows` of strings/finite numbers.
   - `rowKey(row)`: a stable identity, so `new_items` conditions detect real changes.
3. Put realistic Graph responses in `fixtures.json` (no real tenant data, no secrets).
4. A declarative alternative (no code): a YAML/JSON manifest with an inline `fixtures` block — see `examples/plugins/`. Copy one, then point `ARGUS_PLUGINS_DIR` at it.
5. Verify: `bun run plugin:validate && bun test tests/plugin-contract.test.ts && bun run docs:catalog` (regenerates the catalog/permission doc; commit it).

## Automation plugin

1. Scaffold: `bun run plugin:new <kebab-id> --kind=automation --category=conditional-access|identity|security|licensing|governance|devices`
   (creates `src/services/automations/catalog/custom/<id>.ts` and registers it in `catalog/custom/index.ts`). The template passes the contract as-is.
2. Edit the definition (`AutomationDefinition` in `src/services/automations/types.ts`). Contract rules:
   - `plan(transport, params)` is **read-only**: only `get`/`getOne`. The engine blocks writes during plan and the contract fails on any write call. Each planned action needs `targetType`, `targetId`, `targetLabel`, `actionType`, `reason`, `beforeState`, and should carry `plannedAfterState`.
   - `apply(transport, action, params)` makes exactly the planned change and returns `afterState` plus a `rollbackPayload` (`method` POST|PATCH|DELETE, Graph `path`, `body`, human `description`) whenever the change is reversible.
   - `requiredPermissions`: every Graph application permission used (read + write); at least one write scope. They feed the automation app's consent list (least privilege: only active automations are granted by default).
   - `riskLevel`: `high` for anything that disables, deletes or changes access, or uses a privileged scope (`User.ReadWrite.All`, `Application.ReadWrite.All`, `Directory.ReadWrite.All`, role/CA policy writes…). Privileged scopes can never be `low`. High risk must have `recommendedMode: "audit"`.
   - `pairedReportId`: the report this automation acts on, if one exists (the catalog links them).
   - `paramSchema`: unique keys, types `string|number|boolean|string_list|select`, defaults matching the type, an exclusion list for anything that touches users/devices.
   - Plan must work on an empty tenant (no throw, `evaluatedCount ≥ 0`).
3. Add a behaviour test next to the existing ones (see `tests/automations-lifecycle.test.ts`): a fake transport with a few objects, assert the planned actions, run `apply`, and assert the write and rollback payload. `tests/automations-smoke.test.ts` also runs every automation Audit → Enforce → Rollback through the engine.
4. Verify: `bun run plugin:validate && bun test tests/automation-contract.test.ts tests/automations-smoke.test.ts`.

Product rules the engine enforces (don't work around them): new policies start in **audit**; switching to **enforce** needs a finished audit run of the current settings plus an explicit confirmation by a signed-in user; `maxActionsPerRun` halts oversized runs; every enforce/rollback is audited with the user.

## Templates

Reports share one template (`reportType "*"`) and automation runs share one (`automation:*`); both are seeded as Argus-managed and upgraded by `bun run db:seed` only while unedited (`managed` + `sourceHash`). Operators edit them on the Templates page; edits make them operator-owned and seed never touches them again. To change a **shipped** default:

1. Edit `src/services/report-engine/default-template.ts` (reports) or `src/services/report-engine/automation-template.ts` (automations). Use only variables the renderer provides (`buildVars` / `buildRawFragments` for reports; the list at the top of `automation-template.ts` for automations). Values are HTML-escaped; only the documented raw fragments (`detailsTable`, `actionsTable`, …) are injected as HTML.
2. If you rename or remove the old default text, add it to the known-legacy sets in `src/services/report-engine/managed-template.ts` so existing unedited installs are still recognised and upgraded.
3. Verify: `bun test tests/template-contract.test.ts tests/template-ownership.test.ts tests/templates.test.ts`.

## Before you finish

- `bun run typecheck && bun run lint && bun test tests/ && bun run plugin:validate`
- Conventional Commit, e.g. `feat(plugins): add <id> automation`.
- Never put tenant data, real UPNs or secrets in fixtures, tests or examples.
