/**
 * Pure helpers for the unified /catalog: read-only report plugins and
 * tenant-changing automations shown as one list of catalog items.
 *
 * No React, DB or service imports (type-only imports are fine) so this module
 * is safe in client components and trivially unit-testable.
 */
import type { PluginDataSource, PluginIconKey } from "@/services/reports/types";
import type { AutomationCategory, AutomationRiskLevel } from "@/services/automations/types";

export type CatalogItemType = "report" | "automation";
export type CatalogTypeFilter = "all" | CatalogItemType;

/** The four category chips shared by reports and automations. */
export type CatalogCategory = "identity" | "security" | "infrastructure" | "custom";
export const CATALOG_CATEGORIES: readonly CatalogCategory[] = ["identity", "security", "infrastructure", "custom"];

/**
 * What a catalog item currently is for this install (same rule for both types):
 * - "automated": at least one active job (report) / active policy (automation)
 * - "paused": jobs/policies exist but none is active
 * - "available": nothing set up yet
 */
export type CatalogState = "automated" | "paused" | "available";
export type CatalogStateFilter = "all" | CatalogState;

/** A job (report) or policy (automation) that runs a catalog item. */
export type CatalogRunnerRef = {
  id: string;
  name: string;
  /** Jobs: active/paused/…; policies: active/disabled. Only "active" counts as automated. */
  status: string;
  /** Human schedule label, e.g. "daily" or "Daily at 08:00". */
  schedule?: string;
  /** Automation policies only. */
  mode?: "audit" | "enforce";
};

export type CatalogReportInput = {
  id: string;
  version?: string;
  name: string;
  category: CatalogCategory;
  description: string;
  requiredPermissions: string[];
  baselineSupport: boolean;
  tags?: string[];
  maturity?: "stable" | "preview";
  recommendedSchedule?: "hourly" | "daily" | "weekly";
  recommendedGroup?: string;
  usageConcealmentNote?: boolean;
  source?: "builtin" | "declarative";
  service?: string;
  icon?: PluginIconKey;
  dataSource?: PluginDataSource;
  metrics?: string[];
  author?: string;
};

export type CatalogAutomationInput = {
  id: string;
  version: string;
  name: string;
  category: AutomationCategory;
  riskLevel: AutomationRiskLevel;
  description: string;
  requiredPermissions: string[];
  recommendedSchedule: "hourly" | "daily" | "weekly";
  recommendedMode: "audit" | "enforce";
  service: string;
  icon: PluginIconKey;
  dataSource: "graph-v1" | "graph-beta";
  tags: string[];
  pairedReportId: string | null;
};

/** One row of the unified catalog. `key` is unique across both types. */
export type CatalogItem = {
  key: string;
  type: CatalogItemType;
  id: string;
  name: string;
  description: string;
  category: CatalogCategory;
  /** The automation's own finer category (e.g. "licensing"); reports: same as category. */
  subcategory: string;
  service: string;
  icon: PluginIconKey;
  version: string;
  dataSource: PluginDataSource;
  tags: string[];
  metrics: string[];
  author: string;
  requiredPermissions: string[];
  recommendedSchedule: "hourly" | "daily" | "weekly";
  maturity: "stable" | "preview";
  /** Automations only. */
  riskLevel?: AutomationRiskLevel;
  recommendedMode?: "audit" | "enforce";
  pairedReportId?: string | null;
};

export function catalogItemKey(type: CatalogItemType, id: string): string {
  return `${type}:${id}`;
}

/** Map an automation's category onto the closest shared catalog chip. Never drops an item. */
export function mapAutomationCategory(category: AutomationCategory): CatalogCategory {
  switch (category) {
    case "identity":
      return "identity";
    case "security":
    case "conditional-access":
      return "security";
    case "licensing":
    case "governance":
    case "devices":
      return "infrastructure";
    default:
      return "custom";
  }
}

export function reportToCatalogItem(r: CatalogReportInput): CatalogItem {
  return {
    key: catalogItemKey("report", r.id),
    type: "report",
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    subcategory: r.category,
    service: r.service ?? "Microsoft 365",
    icon: r.icon ?? "graph",
    version: r.version ?? "1.0.0",
    dataSource: r.dataSource ?? "graph-v1",
    tags: r.tags ?? [],
    metrics: r.metrics ?? [],
    author: r.author ?? "Argus Official",
    requiredPermissions: r.requiredPermissions,
    recommendedSchedule: r.recommendedSchedule ?? "weekly",
    maturity: r.maturity ?? "stable",
  };
}

export function automationToCatalogItem(a: CatalogAutomationInput): CatalogItem {
  return {
    key: catalogItemKey("automation", a.id),
    type: "automation",
    id: a.id,
    name: a.name,
    description: a.description,
    category: mapAutomationCategory(a.category),
    subcategory: a.category,
    service: a.service,
    icon: a.icon,
    version: a.version,
    dataSource: a.dataSource,
    tags: a.tags,
    metrics: [],
    author: "Argus Official",
    requiredPermissions: a.requiredPermissions,
    recommendedSchedule: a.recommendedSchedule,
    maturity: "stable",
    riskLevel: a.riskLevel,
    recommendedMode: a.recommendedMode,
    pairedReportId: a.pairedReportId,
  };
}

/** Reports first (registry order), then automations (registry order). */
export function mergeCatalogItems(
  reports: readonly CatalogReportInput[],
  automations: readonly CatalogAutomationInput[],
): CatalogItem[] {
  return [...reports.map(reportToCatalogItem), ...automations.map(automationToCatalogItem)];
}

export function catalogState(runners: readonly CatalogRunnerRef[] | undefined): CatalogState {
  if (!runners || runners.length === 0) return "available";
  return runners.some((r) => r.status === "active") ? "automated" : "paused";
}

/** reportId → automations that are based on it (an automation's `pairedReportId`). */
export function automationsByPairedReport(
  automations: readonly Pick<CatalogAutomationInput, "id" | "name" | "pairedReportId">[],
): Map<string, { id: string; name: string }[]> {
  const out = new Map<string, { id: string; name: string }[]>();
  for (const a of automations) {
    if (!a.pairedReportId) continue;
    const list = out.get(a.pairedReportId) ?? [];
    list.push({ id: a.id, name: a.name });
    out.set(a.pairedReportId, list);
  }
  return out;
}

/** `?type=` query value → initial type filter (anything unknown → "all"). */
export function parseCatalogTypeParam(value: string | string[] | undefined | null): CatalogTypeFilter {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "automation" || v === "automations") return "automation";
  if (v === "report" || v === "reports") return "report";
  return "all";
}

export type CatalogFilters = {
  query?: string;
  type?: CatalogTypeFilter;
  category?: "all" | CatalogCategory;
  service?: string;
  state?: CatalogStateFilter;
  /** Restrict to these item keys (an active solution pack). */
  keys?: ReadonlySet<string> | null;
  previewOnly?: boolean;
};

/** Text searched by the catalog search box. */
export function catalogSearchText(item: CatalogItem): string {
  return [
    item.name,
    item.description,
    item.id,
    item.service,
    item.author,
    item.type,
    item.subcategory,
    item.riskLevel ? `${item.riskLevel} risk` : "",
    ...item.metrics,
    ...item.tags,
  ]
    .join(" ")
    .toLowerCase();
}

export function filterCatalogItems(
  items: readonly CatalogItem[],
  filters: CatalogFilters,
  stateOf: (item: CatalogItem) => CatalogState,
): CatalogItem[] {
  const q = (filters.query ?? "").trim().toLowerCase();
  return items.filter((item) => {
    if (filters.keys && !filters.keys.has(item.key)) return false;
    if (filters.type && filters.type !== "all" && item.type !== filters.type) return false;
    if (filters.category && filters.category !== "all" && item.category !== filters.category) return false;
    if (filters.service && filters.service !== "all" && item.service !== filters.service) return false;
    if (filters.previewOnly && item.maturity !== "preview") return false;
    if (filters.state && filters.state !== "all" && stateOf(item) !== filters.state) return false;
    if (q && !catalogSearchText(item).includes(q)) return false;
    return true;
  });
}

export type CatalogSortMode = "recommended" | "name" | "active-first";

export function sortCatalogItems(
  items: readonly CatalogItem[],
  mode: CatalogSortMode,
  runnerCount: (item: CatalogItem) => number,
): CatalogItem[] {
  if (mode === "name") return [...items].sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "active-first") {
    return [...items].sort((a, b) => {
      const diff = runnerCount(b) - runnerCount(a);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }
  return [...items];
}

export type CatalogCounts = {
  types: Record<CatalogTypeFilter, number>;
  categories: Record<"all" | CatalogCategory, number>;
  states: Record<CatalogState, number>;
};

export function countCatalogItems(
  items: readonly CatalogItem[],
  stateOf: (item: CatalogItem) => CatalogState,
): CatalogCounts {
  const counts: CatalogCounts = {
    types: { all: items.length, report: 0, automation: 0 },
    categories: { all: items.length, identity: 0, security: 0, infrastructure: 0, custom: 0 },
    states: { automated: 0, paused: 0, available: 0 },
  };
  for (const item of items) {
    counts.types[item.type] += 1;
    counts.categories[item.category] += 1;
    counts.states[stateOf(item)] += 1;
  }
  return counts;
}

/** Short label for a policy/job schedule shown on the state tag. */
export function automatedStateLabel(runners: readonly CatalogRunnerRef[]): string {
  const active = runners.filter((r) => r.status === "active");
  if (active.length === 0) return "Automated";
  if (active.length > 1) return `Automated · ${active.length} ${active.some((r) => r.mode) ? "policies" : "jobs"}`;
  const [only] = active;
  const head = only.mode ? (only.mode === "enforce" ? "Enforce" : "Audit") : "Automated";
  return only.schedule ? `${head} · ${only.schedule}` : head;
}
