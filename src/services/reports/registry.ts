import type { ReportDefinition } from "./types";
import { BUILTIN_REPORT_PLUGINS } from "./registry.generated";
import { validatePlugin } from "@/plugins/security";
import { loadDeclarativePlugins, type DeclarativePluginEntry, type QuarantinedPlugin } from "@/plugins/declarative";

interface LoadedCatalog {
  reports: Map<string, ReportDefinition<object>>;
  quarantined: QuarantinedPlugin[];
  /** Validated manifests (incl. inline contract fixtures) for registered declarative plugins. */
  declarative: Map<string, DeclarativePluginEntry>;
}

function buildCatalog(): LoadedCatalog {
  const reports = new Map<string, ReportDefinition<object>>();
  const quarantined: QuarantinedPlugin[] = [];
  const declarative = new Map<string, DeclarativePluginEntry>();

  for (const candidate of BUILTIN_REPORT_PLUGINS) {
    const check = validatePlugin(candidate);
    if (!check.ok) {
      quarantined.push({
        id: (candidate as { id?: string })?.id ?? "unknown-builtin",
        errors: check.errors,
      });
      continue;
    }
    if (!reports.has(check.plugin.id)) {
      reports.set(check.plugin.id, check.plugin as ReportDefinition<object>);
    }
  }

  const runtime = loadDeclarativePlugins();
  quarantined.push(...runtime.quarantined);
  for (const entry of runtime.entries) {
    const decl = entry.plugin;
    if (reports.has(decl.id)) {
      quarantined.push({
        id: decl.id,
        errors: [`Declarative plugin id "${decl.id}" collides with a built-in report`],
      });
      continue;
    }
    reports.set(decl.id, decl as unknown as ReportDefinition<object>);
    declarative.set(decl.id, entry);
  }

  return { reports, quarantined, declarative };
}

let cachedCatalog: LoadedCatalog | null = null;

function ensureLoaded(): LoadedCatalog {
  if (!cachedCatalog) cachedCatalog = buildCatalog();
  return cachedCatalog;
}

/** Force reload (used by tests or after adding declarative plugins on disk). */
export function reloadReports(): LoadedCatalog {
  cachedCatalog = buildCatalog();
  return cachedCatalog;
}

export function getReport(id: string): ReportDefinition<object> | undefined {
  return ensureLoaded().reports.get(id);
}

export function listReports(): ReportDefinition<object>[] {
  return [...ensureLoaded().reports.values()];
}

export function getQuarantinedPlugins(): QuarantinedPlugin[] {
  return [...ensureLoaded().quarantined];
}

/** Manifest + source file of a registered declarative plugin (contract tests / validation). */
export function getDeclarativeEntry(id: string): DeclarativePluginEntry | undefined {
  return ensureLoaded().declarative.get(id);
}
