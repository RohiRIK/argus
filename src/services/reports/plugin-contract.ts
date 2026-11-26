import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphTransport } from "@/services/graph/client";
import type { ReportDefinition, ReportPlugin } from "./types";
import { scanPluginSource, validatePlugin } from "@/plugins/security";
import { loadDeclarativePlugins, type DeclarativePluginEntry } from "@/plugins/declarative";
import { getDeclarativeEntry, getQuarantinedPlugins, listReports } from "./registry";

/**
 * Shared report-plugin contract (`argus.report/v1`).
 *
 * Single source of truth for `scripts/validate-plugins.ts` (CI) and
 * `tests/plugin-contract.test.ts`. Covers BOTH built-in plugins
 * (`src/plugins/reports/<id>/plugin.ts` + `fixtures.json`) and declarative
 * runtime plugins (`*.json|*.yaml` with an inline `fixtures` block).
 *
 * Server/CLI only — uses `node:fs`; never import from client components.
 */

export const BUILTIN_PLUGINS_DIR = join(process.cwd(), "src", "plugins", "reports");
/** Declarative example plugins shipped with the repo (contract-tested in CI). */
export const DECLARATIVE_EXAMPLES_DIR = join(process.cwd(), "examples", "plugins");

/** Max summarized rows a plugin may emit (email/table cap). */
export const SUMMARY_ROW_CAP = 50;
/** Minimum catalog metric chips a built-in plugin must declare. */
export const BUILTIN_MIN_METRICS = 2;

export interface PluginFixture {
  params: Record<string, unknown>;
  rows: unknown[];
  csvRows?: Record<string, string>[];
}

export type PluginSource = "builtin" | "declarative";

export interface PluginContractTarget {
  /** Human label used as the error prefix (folder name or manifest file). */
  label: string;
  source: PluginSource;
  plugin: unknown;
  /** Raw fixture (fixtures.json contents or inline declarative `fixtures`). `undefined` = missing. */
  fixture: unknown;
  /** Declarative only: the declared output columns every summarized row must match exactly. */
  declaredColumns?: string[];
  /** Built-in only: the plugin id must equal its folder name. */
  expectedId?: string;
}

export interface PluginContractResult {
  id: string;
  label: string;
  source: PluginSource;
  version: string;
  category: string;
  requiredPermissions: string[];
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a fixture's shape. Accepts the legacy bare-array form or
 * `{ params?, rows?, csvRows? }` with at least one of `rows` / `csvRows`.
 */
export function parsePluginFixture(raw: unknown): { ok: true; fixture: PluginFixture } | { ok: false; errors: string[] } {
  if (Array.isArray(raw)) return { ok: true, fixture: { params: {}, rows: raw } };
  if (!isPlainObject(raw)) return { ok: false, errors: ["fixture must be an object or an array of rows"] };

  const errors: string[] = [];
  if (raw.params !== undefined && !isPlainObject(raw.params)) errors.push("fixture.params must be an object");
  if (raw.rows !== undefined && !Array.isArray(raw.rows)) errors.push("fixture.rows must be an array");
  if (raw.csvRows !== undefined) {
    if (!Array.isArray(raw.csvRows)) {
      errors.push("fixture.csvRows must be an array");
    } else if (!raw.csvRows.every((r) => isPlainObject(r) && Object.values(r).every((v) => typeof v === "string"))) {
      errors.push("fixture.csvRows must be objects with string cell values");
    }
  }
  if (raw.rows === undefined && raw.csvRows === undefined) errors.push("fixture must declare rows[] or csvRows[]");
  if (errors.length > 0) return { ok: false, errors };

  const rows = (raw.rows ?? raw.csvRows) as unknown[];
  return {
    ok: true,
    fixture: {
      params: (raw.params as Record<string, unknown> | undefined) ?? {},
      rows,
      csvRows: raw.csvRows as Record<string, string>[] | undefined,
    },
  };
}

/** Read a fixture JSON file. Returns `undefined` when the file does not exist. */
export function readFixtureFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/** An offline `GraphTransport` that replays a fixture for every call. */
export function createFixtureTransport(fixture: PluginFixture): GraphTransport {
  return {
    async get<T = unknown>() {
      return { value: fixture.rows as T[], latencyMs: 1 };
    },
    async batch() {
      return [];
    },
    async getCsv() {
      const rows = (fixture.csvRows ?? fixture.rows) as Record<string, string>[];
      return { headers: Object.keys(rows[0] ?? {}), rows, latencyMs: 1 };
    },
  };
}

function checkMetadata(plugin: ReportPlugin<object>, source: PluginSource): string[] {
  const errors: string[] = [];
  if (plugin.requiredPermissions.length === 0) {
    errors.push("requiredPermissions must declare at least one Graph permission");
  }
  const dupes = plugin.requiredPermissions.filter((s, i, all) => all.indexOf(s) !== i);
  if (dupes.length > 0) errors.push(`requiredPermissions has duplicates: ${[...new Set(dupes)].join(", ")}`);
  if (plugin.source !== undefined && plugin.source !== source) {
    errors.push(`source must be "${source}" (got "${plugin.source}")`);
  }
  if (typeof plugin.service !== "string" || plugin.service.length < 2) errors.push("service must be a non-empty string");
  if (typeof plugin.icon !== "string") errors.push("icon must be set");
  if (typeof plugin.dataSource !== "string") errors.push("dataSource must be set");
  if (source === "builtin" && (!Array.isArray(plugin.metrics) || plugin.metrics.length < BUILTIN_MIN_METRICS)) {
    errors.push(`metrics must list at least ${BUILTIN_MIN_METRICS} catalog metrics`);
  }
  return errors;
}

/**
 * Run the full contract against one plugin: manifest schema + read-only scopes,
 * required metadata, fixture presence/shape, and an offline fetch → summarize
 * run on the fixture and on `[]` (count, row cap, flat row shape, variables,
 * rowKey, declared declarative columns).
 */
export async function checkPluginContract(target: PluginContractTarget): Promise<PluginContractResult> {
  const fallbackId = (target.plugin as { id?: string } | null)?.id ?? target.label;
  const result: PluginContractResult = {
    id: fallbackId,
    label: target.label,
    source: target.source,
    version: String((target.plugin as { version?: string } | null)?.version ?? "?"),
    category: String((target.plugin as { category?: string } | null)?.category ?? "?"),
    requiredPermissions: [],
    errors: [],
  };

  const validation = validatePlugin(target.plugin, target.expectedId);
  if (!validation.ok) {
    result.errors.push(...validation.errors);
    return result;
  }
  const plugin = validation.plugin as ReportPlugin<object>;
  result.id = plugin.id;
  result.requiredPermissions = [...plugin.requiredPermissions];
  result.errors.push(...checkMetadata(plugin, target.source));

  if (target.fixture === undefined) {
    result.errors.push(
      target.source === "builtin"
        ? "missing fixtures.json"
        : "missing inline `fixtures` block (declarative plugins need a fixture for contract parity)",
    );
    return result;
  }
  const parsedFixture = parsePluginFixture(target.fixture);
  if (!parsedFixture.ok) {
    result.errors.push(...parsedFixture.errors);
    return result;
  }
  const fixture = parsedFixture.fixture;

  try {
    const fetched = await plugin.fetch(createFixtureTransport(fixture), fixture.params);
    if (!Array.isArray(fetched)) {
      result.errors.push("fetch() must resolve to an array of rows");
      return result;
    }
    const summary = plugin.summarize(fetched);
    const empty = plugin.summarize([]);

    if (!Number.isInteger(summary.count) || summary.count < 0) {
      result.errors.push(`summary.count must be a non-negative integer (got ${summary.count})`);
    }
    if (!Number.isInteger(empty.count) || empty.count < 0) {
      result.errors.push("empty summarize([]) count must be a non-negative integer");
    }
    if (!isPlainObject(summary.variables)) {
      result.errors.push("summary.variables must be an object");
    } else {
      for (const [k, v] of Object.entries(summary.variables)) {
        if (typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v))) {
          result.errors.push(`summary.variables["${k}"] must be string or finite number`);
        }
      }
    }

    const rows = summary.rows ?? [];
    if (!Array.isArray(rows)) {
      result.errors.push("summary.rows must be an array when provided");
      return result;
    }
    if (rows.length > SUMMARY_ROW_CAP) {
      result.errors.push(`summary.rows exceeds ${SUMMARY_ROW_CAP}-row cap (${rows.length})`);
    }
    rows.forEach((row, idx) => {
      if (!isPlainObject(row)) {
        result.errors.push(`summary.rows[${idx}] must be a flat object`);
        return;
      }
      for (const [k, v] of Object.entries(row)) {
        if (typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v))) {
          result.errors.push(`summary.rows[${idx}].${k} must be string or finite number`);
        }
      }
      if (target.declaredColumns) {
        const keys = Object.keys(row);
        const expected = target.declaredColumns;
        if (keys.length !== expected.length || !expected.every((c, i) => keys[i] === c)) {
          result.errors.push(
            `summary.rows[${idx}] columns [${keys.join(", ")}] do not match declared columns [${expected.join(", ")}]`,
          );
        }
      }
    });

    if (plugin.rowKey && rows.length > 0) {
      const key = plugin.rowKey(rows[0]);
      if (typeof key !== "string" || !key.trim()) {
        result.errors.push("rowKey returned an empty key for the first fixture row");
      }
    }
  } catch (err) {
    result.errors.push(`fixture contract run failed (${err instanceof Error ? err.message : String(err)})`);
  }

  return result;
}

/** Flag duplicate plugin ids across a set of contract results. */
export function findDuplicateIds(results: Array<{ id: string; label: string }>): string[] {
  const seen = new Map<string, string>();
  const errors: string[] = [];
  for (const r of results) {
    const prior = seen.get(r.id);
    if (prior) errors.push(`${r.label}: duplicate plugin id "${r.id}" (already declared by ${prior})`);
    else seen.set(r.id, r.label);
  }
  return errors;
}

/** Built-in plugin folders (`src/plugins/reports/*`), sorted. */
export function listBuiltinPluginFolders(dir = BUILTIN_PLUGINS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * Static checks for one built-in folder: required files and the plugin source
 * security scan over every non-test `.ts` file.
 */
export function checkBuiltinFolder(folder: string, dir = BUILTIN_PLUGINS_DIR): string[] {
  const folderPath = join(dir, folder);
  const errors: string[] = [];
  if (!existsSync(join(folderPath, "plugin.ts"))) errors.push(`${folder}: missing plugin.ts`);
  if (!existsSync(join(folderPath, "fixtures.json"))) errors.push(`${folder}: missing fixtures.json`);
  for (const file of readdirSync(folderPath)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const src = readFileSync(join(folderPath, file), "utf8");
    errors.push(...scanPluginSource(src, `src/plugins/reports/${folder}/${file}`));
  }
  return errors;
}

/** Contract target for a declarative plugin entry (manifest + inline fixture). */
export function declarativeTarget(entry: DeclarativePluginEntry): PluginContractTarget {
  return {
    label: entry.file,
    source: "declarative",
    plugin: entry.plugin,
    fixture: entry.spec.fixtures,
    declaredColumns: entry.spec.query.columns,
  };
}

/**
 * Contract targets for every report the runtime registry exposes (built-in AND
 * declarative), plus registry quarantine entries reported as errors.
 */
export function collectRegistryTargets(builtinDir = BUILTIN_PLUGINS_DIR): {
  targets: PluginContractTarget[];
  errors: string[];
} {
  const targets: PluginContractTarget[] = [];
  const errors = getQuarantinedPlugins().map((q) => `${q.file ?? q.id}: quarantined (${q.errors.join("; ")})`);

  for (const report of listReports() as ReportDefinition<object>[]) {
    if (report.source === "declarative") {
      const entry = getDeclarativeEntry(report.id);
      if (!entry) {
        errors.push(`${report.id}: declarative report has no loaded manifest`);
        continue;
      }
      targets.push(declarativeTarget(entry));
      continue;
    }
    targets.push({
      label: report.id,
      source: "builtin",
      plugin: report,
      fixture: readFixtureFile(join(builtinDir, report.id, "fixtures.json")),
      expectedId: report.id,
    });
  }
  return { targets, errors };
}

/** Contract targets for a directory of declarative manifests (e.g. examples/plugins). */
export function collectDeclarativeDirTargets(dir: string): { targets: PluginContractTarget[]; errors: string[] } {
  const { entries, quarantined } = loadDeclarativePlugins(dir);
  return {
    targets: entries.map(declarativeTarget),
    errors: quarantined.map((q) => `${q.file ?? q.id}: quarantined (${q.errors.join("; ")})`),
  };
}

/** Run the contract over many targets, including cross-plugin id uniqueness. */
export async function runContracts(targets: PluginContractTarget[]): Promise<{
  results: PluginContractResult[];
  errors: string[];
}> {
  const results: PluginContractResult[] = [];
  for (const t of targets) results.push(await checkPluginContract(t));
  const errors = [
    ...results.flatMap((r) => r.errors.map((e) => `${r.label}: ${e}`)),
    ...findDuplicateIds(results),
  ];
  return { results, errors };
}
