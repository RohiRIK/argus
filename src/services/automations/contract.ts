import type { AutomationDefinition, AutomationGraphTransport, AutomationParamField } from "./types";
import { listReports } from "@/services/reports/registry";

/**
 * The automation plugin contract — the same idea as the report plugin contract
 * (`src/services/reports/plugin-contract.ts`). Enforced by
 * `bun run plugin:validate` and `tests/automation-contract.test.ts` in CI, so a
 * new automation (hand-written or scaffolded with `bun run plugin:new --kind=automation`)
 * cannot ship unless it meets every rule below.
 *
 * Static rules
 *  - apiVersion "argus.automation/v1", kebab-case id (unique), semver version.
 *  - name/description/service present; category, riskLevel, icon, dataSource valid.
 *  - requiredPermissions: non-empty, well-formed Graph application permission
 *    names, no duplicates, at least one write scope (otherwise it is a report).
 *  - High-privilege scopes can't be riskLevel "low"; high risk must recommend "audit".
 *  - pairedReportId, when set, names a real report in the report registry.
 *  - paramSchema: unique keys, valid types, select fields have options, default
 *    values match the declared type, provision only on string / string_list fields.
 *
 * Behaviour rules (run offline against an empty fake Graph, default params)
 *  - plan() makes no write calls (POST/PATCH/DELETE) — it must be safe to run in audit.
 *  - plan() returns { evaluatedCount ≥ 0, summary, actions[] } on an empty tenant, and
 *    every planned action is well-formed (target, actionType, reason, beforeState;
 *    rollbackPayload, when present, names an HTTP method + Graph path).
 *  Enforce + rollback behaviour per automation is covered by tests/automations-smoke.test.ts.
 */

export const AUTOMATION_API_VERSION = "argus.automation/v1";
const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/u;
const SEMVER_RE = /^\d+\.\d+\.\d+$/u;
const SCOPE_RE = /^[A-Z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/u;
const CATEGORIES = new Set(["conditional-access", "identity", "security", "licensing", "governance", "devices"]);
const RISKS = new Set(["low", "medium", "high"]);
const SCHEDULES = new Set(["hourly", "daily", "weekly", "monthly"]);
const PARAM_TYPES = new Set(["string", "number", "boolean", "string_list", "select"]);
const DATA_SOURCES = new Set(["graph-v1", "graph-beta"]);

/** Scopes that can take over users, apps or the tenant; never allowed on riskLevel "low". */
export const HIGH_PRIVILEGE_SCOPES = new Set([
  "Directory.ReadWrite.All",
  "Application.ReadWrite.All",
  "AppRoleAssignment.ReadWrite.All",
  "RoleManagement.ReadWrite.Directory",
  "Policy.ReadWrite.ConditionalAccess",
  "Policy.ReadWrite.AuthenticationMethod",
  "Policy.ReadWrite.Authorization",
  "User.ReadWrite.All",
  "DelegatedPermissionGrant.ReadWrite.All",
]);

export interface AutomationContractResult {
  id: string;
  errors: string[];
}

function checkParam(f: AutomationParamField, seen: Set<string>): string[] {
  const errors: string[] = [];
  const where = `param "${f.key}"`;
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(f.key)) errors.push(`${where}: key must be an identifier`);
  if (seen.has(f.key)) errors.push(`${where}: duplicate key`);
  seen.add(f.key);
  if (!PARAM_TYPES.has(f.type)) errors.push(`${where}: unknown type "${f.type}"`);
  if (!f.label?.trim()) errors.push(`${where}: label is required`);
  if (!f.description?.trim()) errors.push(`${where}: description is required`);
  if (f.type === "select" && !(f.options && f.options.length > 0)) errors.push(`${where}: select needs options`);
  if (f.defaultValue !== undefined) {
    const v = f.defaultValue;
    const ok =
      (f.type === "string" && typeof v === "string") ||
      (f.type === "number" && typeof v === "number" && Number.isFinite(v)) ||
      (f.type === "boolean" && typeof v === "boolean") ||
      (f.type === "string_list" && Array.isArray(v) && v.every((x) => typeof x === "string")) ||
      (f.type === "select" && typeof v === "string" && (f.options ?? []).some((o) => o.value === v));
    if (!ok) errors.push(`${where}: defaultValue does not match type ${f.type}`);
  }
  if (f.provision && f.type !== "string" && f.type !== "string_list") {
    errors.push(`${where}: provision is only supported on string or string_list params`);
  }
  return errors;
}

/** Static checks that need no Graph calls. */
export function checkAutomationStatic(def: AutomationDefinition, reportIds: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  if (def.apiVersion !== AUTOMATION_API_VERSION) errors.push(`apiVersion must be "${AUTOMATION_API_VERSION}"`);
  if (!ID_RE.test(def.id)) errors.push(`id "${def.id}" must be kebab-case (3–64 chars)`);
  if (!SEMVER_RE.test(def.version)) errors.push(`version "${def.version}" must be semver (x.y.z)`);
  if (!def.name?.trim()) errors.push("name is required");
  if ((def.description ?? "").trim().length < 20) errors.push("description must explain what it changes (≥ 20 chars)");
  if (!def.service?.trim()) errors.push("service is required");
  if (!CATEGORIES.has(def.category)) errors.push(`unknown category "${def.category}"`);
  if (!RISKS.has(def.riskLevel)) errors.push(`unknown riskLevel "${def.riskLevel}"`);
  if (!SCHEDULES.has(def.recommendedSchedule)) errors.push(`unknown recommendedSchedule "${def.recommendedSchedule}"`);
  if (def.recommendedMode !== "audit" && def.recommendedMode !== "enforce") errors.push("recommendedMode must be audit or enforce");
  if (def.riskLevel === "high" && def.recommendedMode !== "audit") errors.push('high-risk automations must recommend "audit"');
  if (!DATA_SOURCES.has(def.dataSource)) errors.push(`unknown dataSource "${def.dataSource}"`);
  if (!def.icon) errors.push("icon is required");
  if (!Array.isArray(def.tags) || def.tags.length === 0) errors.push("at least one tag is required");

  const perms = def.requiredPermissions ?? [];
  if (perms.length === 0) errors.push("requiredPermissions must list the Graph application permissions it needs");
  if (new Set(perms).size !== perms.length) errors.push("requiredPermissions has duplicates");
  for (const p of perms) if (!SCOPE_RE.test(p)) errors.push(`malformed permission "${p}"`);
  if (perms.length && !perms.some((p) => /ReadWrite|\.Send|\.Write|Manage/u.test(p))) {
    errors.push("no write permission — an automation that only reads should be a report plugin");
  }
  const privileged = perms.filter((p) => HIGH_PRIVILEGE_SCOPES.has(p));
  if (privileged.length && def.riskLevel === "low") {
    errors.push(`riskLevel can't be "low" when requesting ${privileged.join(", ")}`);
  }

  if (def.pairedReportId && !reportIds.has(def.pairedReportId)) {
    errors.push(`pairedReportId "${def.pairedReportId}" is not a report in the catalog`);
  }

  const seen = new Set<string>();
  for (const f of def.paramSchema ?? []) errors.push(...checkParam(f, seen));
  if (typeof def.plan !== "function") errors.push("plan() is required");
  if (typeof def.apply !== "function") errors.push("apply() is required");
  return errors;
}

/** Params for an offline plan: declared defaults, plus a harmless placeholder for required fields without one. */
export function contractParams(def: AutomationDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.paramSchema ?? []) {
    if (f.defaultValue !== undefined) out[f.key] = structuredClone(f.defaultValue);
    else if (f.required) {
      out[f.key] =
        f.type === "number" ? 1 :
        f.type === "boolean" ? false :
        f.type === "string_list" ? [] :
        f.type === "select" ? f.options?.[0]?.value :
        "00000000-0000-0000-0000-000000000000";
    }
  }
  return out;
}

/** An empty tenant: every list is empty, every object is {}; any write is recorded. */
export function emptyTenantTransport(): { transport: AutomationGraphTransport; writes: string[] } {
  const writes: string[] = [];
  const transport: AutomationGraphTransport = {
    get: async <T,>() => ({ value: [] as T[], latencyMs: 0 }),
    getOne: async <T,>() => ({ data: {} as T, latencyMs: 0 }),
    post: async <T,>(path: string) => (writes.push(`POST ${path}`), { data: {} as T, latencyMs: 0 }),
    patch: async <T,>(path: string) => (writes.push(`PATCH ${path}`), { data: {} as T, latencyMs: 0 }),
    delete: async (path: string) => (writes.push(`DELETE ${path}`), { latencyMs: 0 }),
  };
  return { transport, writes };
}

export async function checkAutomationBehaviour(def: AutomationDefinition): Promise<string[]> {
  const errors: string[] = [];
  const { transport, writes } = emptyTenantTransport();
  try {
    const result = await def.plan(transport, contractParams(def));
    if (!result || typeof result !== "object") return ["plan() must return a result object"];
    if (!Number.isInteger(result.evaluatedCount) || result.evaluatedCount < 0) errors.push("plan(): evaluatedCount must be an integer ≥ 0");
    if (typeof result.summary !== "string" || !result.summary.trim()) errors.push("plan(): summary must be a non-empty string");
    if (!Array.isArray(result.actions)) errors.push("plan(): actions must be an array");
    else {
      result.actions.forEach((a, i) => {
        const at = `plan(): action[${i}]`;
        for (const k of ["targetType", "targetId", "targetLabel", "actionType", "reason"] as const) {
          if (typeof a[k] !== "string" || !a[k]) errors.push(`${at}.${k} must be a non-empty string`);
        }
        if (!a.beforeState || typeof a.beforeState !== "object") errors.push(`${at}.beforeState must be an object`);
        const rb = a.rollbackPayload;
        if (rb && (!["POST", "PATCH", "DELETE"].includes(rb.method) || !rb.path?.startsWith("/"))) {
          errors.push(`${at}.rollbackPayload needs method POST|PATCH|DELETE and a Graph path`);
        }
      });
    }
  } catch (err) {
    errors.push(`plan() threw on an empty tenant: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (writes.length) errors.push(`plan() made write calls (${writes.join(", ")}) — plan must be read-only`);
  return errors;
}

/** Run the full contract over a list of automations (default: the registry). */
export async function runAutomationContracts(defs: AutomationDefinition[]): Promise<AutomationContractResult[]> {
  const reportIds = new Set(listReports().map((r) => r.id));
  const ids = new Map<string, number>();
  for (const d of defs) ids.set(d.id, (ids.get(d.id) ?? 0) + 1);
  const results: AutomationContractResult[] = [];
  for (const def of defs) {
    const errors = checkAutomationStatic(def, reportIds);
    if ((ids.get(def.id) ?? 0) > 1) errors.push(`duplicate id "${def.id}"`);
    errors.push(...(await checkAutomationBehaviour(def)));
    results.push({ id: def.id, errors });
  }
  return results;
}
