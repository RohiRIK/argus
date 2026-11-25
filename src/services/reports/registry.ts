import type { ReportDefinition } from "./types";
import { BUILTIN_REPORT_PLUGINS } from "./registry.generated";
import { validatePlugin } from "@/plugins/security";
import { loadDeclarativePlugins, type QuarantinedPlugin } from "@/plugins/declarative";

interface LoadedCatalog {
  reports: Map<string, ReportDefinition<object>>;
  quarantined: QuarantinedPlugin[];
}

function buildCatalog(): LoadedCatalog {
  const reports = new Map<string, ReportDefinition<object>>();
  const quarantined: QuarantinedPlugin[] = [];

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
  for (const decl of runtime.plugins) {
    if (reports.has(decl.id)) {
      quarantined.push({
        id: decl.id,
        errors: [`Declarative plugin id "${decl.id}" collides with a built-in report`],
      });
      continue;
    }
    reports.set(decl.id, decl as unknown as ReportDefinition<object>);
  }

  return { reports, quarantined };
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
