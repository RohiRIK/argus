import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ReportPlugin, ReportSummary } from "@/services/reports/types";
import { PLUGIN_API_VERSION } from "./sdk";
import { isAllowedReadOnlyPermission, pluginManifestSchema } from "./security";

const declarativeQuerySchema = z.object({
  endpoint: z
    .string()
    .min(2)
    .max(500)
    .refine((v) => v.startsWith("/"), "Endpoint must be a relative Graph path starting with '/'")
    .refine((v) => !v.includes("://") && !v.includes(".."), "External URLs and '..' traversal are forbidden"),
  mode: z.enum(["json", "csv"]).default("json"),
  rowLimit: z.number().int().min(1).max(50).default(50),
  columns: z.array(z.string().min(1).max(64)).min(1).max(10),
  filterEquals: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  rowKeyColumn: z.string().min(1).max(64).optional(),
});

export const declarativePluginSchema = pluginManifestSchema.extend({
  query: declarativeQuerySchema,
});

export type DeclarativePluginSpec = z.infer<typeof declarativePluginSchema>;

export interface QuarantinedPlugin {
  id: string;
  file?: string;
  errors: string[];
}

function parseYamlOrJson(raw: string, ext: ".json" | ".yaml" | ".yml"): unknown {
  if (ext === ".json") return JSON.parse(raw);
  const bunYaml = (globalThis as { Bun?: { YAML?: { parse?: (s: string) => unknown } } }).Bun?.YAML?.parse;
  if (typeof bunYaml === "function") return bunYaml(raw);
  throw new Error("YAML parsing requires Bun runtime");
}

function toFlatCell(value: unknown): string | number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

/** Compile a validated declarative JSON/YAML plugin into a sandboxed `ReportPlugin`. */
export function buildDeclarativePlugin(spec: DeclarativePluginSpec): ReportPlugin<Record<string, unknown>> {
  const { query } = spec;
  const limit = query.rowLimit ?? 50;
  return {
    apiVersion: PLUGIN_API_VERSION,
    id: spec.id,
    version: spec.version,
    name: spec.name,
    category: spec.category,
    description: spec.description,
    requiredPermissions: Object.freeze([...spec.requiredPermissions]) as string[],
    baselineSupport: spec.baselineSupport,
    maturity: spec.maturity,
    tags: spec.tags ? (Object.freeze([...spec.tags]) as string[]) : undefined,
    recommendedSchedule: spec.recommendedSchedule,
    recommendedGroup: spec.recommendedGroup,
    usageConcealmentNote: spec.usageConcealmentNote,
    source: "declarative",
    async fetch(transport) {
      if (query.mode === "csv") {
        if (!transport.getCsv) throw new Error("CSV transport unavailable");
        return (await transport.getCsv(query.endpoint)).rows;
      }
      return (await transport.get<Record<string, unknown>>(query.endpoint)).value;
    },
    summarize(rows): ReportSummary {
      const filters = Object.entries(query.filterEquals ?? {});
      const matched =
        filters.length === 0
          ? rows
          : rows.filter((r) => filters.every(([k, expected]) => r[k] === expected));
      const mapped = matched.slice(0, limit).map((r) => {
        const out: Record<string, string | number> = {};
        for (const col of query.columns) {
          out[col] = toFlatCell(r[col]);
        }
        return out;
      });
      return {
        count: matched.length,
        variables: {
          totalRecords: rows.length,
          matchedRecords: matched.length,
          columns: query.columns.join(", "),
        },
        rows: mapped,
      };
    },
    ...(query.rowKeyColumn
      ? { rowKey: (row: Record<string, string | number>) => String(row[query.rowKeyColumn!] ?? "") }
      : {}),
  };
}

/**
 * Safely load optional runtime declarative plugins (`*.json`, `*.yaml`, `*.yml`)
 * from `ARGUS_PLUGINS_DIR` (defaults to `./data/plugins`). Zero code execution:
 * plugins only declare read-only Graph paths, permissions, and columns. Invalid
 * or over-privileged manifests are quarantined cleanly without breaking boot.
 */
export function loadDeclarativePlugins(dirOverride?: string): {
  plugins: ReportPlugin<Record<string, unknown>>[];
  quarantined: QuarantinedPlugin[];
} {
  const dir = dirOverride ?? process.env.ARGUS_PLUGINS_DIR ?? join(process.cwd(), "data", "plugins");
  if (!existsSync(dir)) return { plugins: [], quarantined: [] };

  const plugins: ReportPlugin<Record<string, unknown>>[] = [];
  const quarantined: QuarantinedPlugin[] = [];

  for (const entry of readdirSync(dir).sort()) {
    const lower = entry.toLowerCase();
    const ext = lower.endsWith(".json")
      ? ".json"
      : lower.endsWith(".yaml")
        ? ".yaml"
        : lower.endsWith(".yml")
          ? ".yml"
          : null;
    if (!ext) continue;

    const fullPath = join(dir, entry);
    try {
      const raw = readFileSync(fullPath, "utf8");
      const rawObj = parseYamlOrJson(raw, ext);
      const parsed = declarativePluginSchema.safeParse(rawObj);
      if (!parsed.success) {
        quarantined.push({
          id: entry,
          file: fullPath,
          errors: parsed.error.issues.map((i) => `${i.path.join(".") || "manifest"}: ${i.message}`),
        });
        continue;
      }

      const scopeErrors = parsed.data.requiredPermissions
        .filter((s) => !isAllowedReadOnlyPermission(s, parsed.data.id))
        .map((s) => `Forbidden or non-read-only Graph scope "${s}"`);

      if (scopeErrors.length > 0) {
        quarantined.push({ id: parsed.data.id, file: fullPath, errors: scopeErrors });
        continue;
      }

      plugins.push(buildDeclarativePlugin(parsed.data));
    } catch (err) {
      quarantined.push({
        id: entry,
        file: fullPath,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  return { plugins, quarantined };
}
