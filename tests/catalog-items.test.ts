import { describe, expect, test } from "bun:test";
import {
  automatedStateLabel,
  automationsByPairedReport,
  catalogState,
  countCatalogItems,
  filterCatalogItems,
  mapAutomationCategory,
  mergeCatalogItems,
  parseCatalogTypeParam,
  sortCatalogItems,
  type CatalogAutomationInput,
  type CatalogItem,
  type CatalogReportInput,
  type CatalogRunnerRef,
} from "@/lib/catalog-items";
import { listAutomations } from "@/services/automations/registry";
import { listReports } from "@/services/reports/registry";

const reports: CatalogReportInput[] = [
  {
    id: "risky-users",
    name: "Risky Users",
    category: "identity",
    description: "Users flagged by Identity Protection",
    requiredPermissions: ["IdentityRiskyUser.Read.All"],
    baselineSupport: true,
    tags: ["risk"],
    service: "Microsoft Entra ID",
  },
  {
    id: "license-utilization",
    name: "License Utilization",
    category: "infrastructure",
    description: "SKU usage",
    requiredPermissions: ["Organization.Read.All"],
    baselineSupport: false,
    maturity: "preview",
  },
];

const automations: CatalogAutomationInput[] = [
  {
    id: "high-risk-user-containment",
    version: "1.0.0",
    name: "High-Risk User Containment",
    category: "security",
    riskLevel: "high",
    description: "Revoke sessions for high-risk users",
    requiredPermissions: ["User.ReadWrite.All"],
    recommendedSchedule: "hourly",
    recommendedMode: "audit",
    service: "Entra ID Protection",
    icon: "entra",
    dataSource: "graph-v1",
    tags: ["containment"],
    pairedReportId: "risky-users",
  },
  {
    id: "dormant-user-license-reclaim",
    version: "1.0.0",
    name: "Dormant License Reclaim",
    category: "licensing",
    riskLevel: "medium",
    description: "Remove licenses from dormant users",
    requiredPermissions: ["User.ReadWrite.All"],
    recommendedSchedule: "weekly",
    recommendedMode: "audit",
    service: "Microsoft 365 Licensing",
    icon: "licenses",
    dataSource: "graph-v1",
    tags: [],
    pairedReportId: null,
  },
];

const items = mergeCatalogItems(reports, automations);

describe("mergeCatalogItems", () => {
  test("keeps every report and automation, reports first, unique keys", () => {
    expect(items.map((i) => i.key)).toEqual([
      "report:risky-users",
      "report:license-utilization",
      "automation:high-risk-user-containment",
      "automation:dormant-user-license-reclaim",
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  test("fills report defaults and maps automation categories", () => {
    const lic = items.find((i) => i.id === "license-utilization")!;
    expect(lic.service).toBe("Microsoft 365");
    expect(lic.icon).toBe("graph");
    expect(lic.recommendedSchedule).toBe("weekly");
    const reclaim = items.find((i) => i.id === "dormant-user-license-reclaim")!;
    expect(reclaim.type).toBe("automation");
    expect(reclaim.category).toBe("infrastructure");
    expect(reclaim.subcategory).toBe("licensing");
    expect(reclaim.riskLevel).toBe("medium");
  });

  test("every built-in automation maps onto a shared category chip", () => {
    for (const a of listAutomations()) {
      expect(["identity", "security", "infrastructure", "custom"]).toContain(mapAutomationCategory(a.category));
    }
    expect(mapAutomationCategory("conditional-access")).toBe("security");
    expect(mapAutomationCategory("devices")).toBe("infrastructure");
  });
});

describe("catalogState", () => {
  test("available / paused / automated", () => {
    expect(catalogState(undefined)).toBe("available");
    expect(catalogState([])).toBe("available");
    expect(catalogState([{ id: "1", name: "a", status: "disabled" }])).toBe("paused");
    expect(
      catalogState([
        { id: "1", name: "a", status: "paused" },
        { id: "2", name: "b", status: "active" },
      ]),
    ).toBe("automated");
  });

  test("automatedStateLabel shows mode and schedule for a single policy", () => {
    const one: CatalogRunnerRef[] = [{ id: "p", name: "P", status: "active", mode: "audit", schedule: "daily" }];
    expect(automatedStateLabel(one)).toBe("Audit · daily");
    expect(automatedStateLabel([{ ...one[0], mode: "enforce" }])).toBe("Enforce · daily");
    expect(automatedStateLabel([{ id: "j", name: "J", status: "active", schedule: "Weekly" }])).toBe("Automated · Weekly");
    expect(automatedStateLabel([...one, { ...one[0], id: "q" }])).toBe("Automated · 2 policies");
    expect(
      automatedStateLabel([
        { id: "j1", name: "J", status: "active" },
        { id: "j2", name: "K", status: "active" },
      ]),
    ).toBe("Automated · 2 jobs");
  });
});

describe("filterCatalogItems / sortCatalogItems / countCatalogItems", () => {
  const runners: Record<string, CatalogRunnerRef[]> = {
    "report:risky-users": [{ id: "j", name: "J", status: "active" }],
    "automation:dormant-user-license-reclaim": [{ id: "p", name: "P", status: "disabled", mode: "audit" }],
  };
  const stateOf = (i: CatalogItem) => catalogState(runners[i.key]);

  test("type filter", () => {
    expect(filterCatalogItems(items, { type: "automation" }, stateOf).map((i) => i.type)).toEqual([
      "automation",
      "automation",
    ]);
    expect(filterCatalogItems(items, { type: "report" }, stateOf)).toHaveLength(2);
    expect(filterCatalogItems(items, { type: "all" }, stateOf)).toHaveLength(4);
  });

  test("state filter applies to both types", () => {
    expect(filterCatalogItems(items, { state: "automated" }, stateOf).map((i) => i.id)).toEqual(["risky-users"]);
    expect(filterCatalogItems(items, { state: "paused" }, stateOf).map((i) => i.id)).toEqual([
      "dormant-user-license-reclaim",
    ]);
    expect(filterCatalogItems(items, { state: "available" }, stateOf)).toHaveLength(2);
  });

  test("category, service, preview, pack keys and search combine", () => {
    expect(filterCatalogItems(items, { category: "infrastructure" }, stateOf).map((i) => i.id)).toEqual([
      "license-utilization",
      "dormant-user-license-reclaim",
    ]);
    expect(filterCatalogItems(items, { service: "Microsoft Entra ID" }, stateOf).map((i) => i.id)).toEqual([
      "risky-users",
    ]);
    expect(filterCatalogItems(items, { previewOnly: true }, stateOf).map((i) => i.id)).toEqual(["license-utilization"]);
    expect(
      filterCatalogItems(items, { keys: new Set(["automation:high-risk-user-containment"]) }, stateOf),
    ).toHaveLength(1);
    expect(filterCatalogItems(items, { query: "high risk" }, stateOf).map((i) => i.id)).toEqual([
      "high-risk-user-containment",
    ]);
    expect(filterCatalogItems(items, { query: "RECLAIM", type: "report" }, stateOf)).toHaveLength(0);
  });

  test("sort modes", () => {
    expect(sortCatalogItems(items, "recommended", () => 0).map((i) => i.key)).toEqual(items.map((i) => i.key));
    expect(sortCatalogItems(items, "name", () => 0)[0].name).toBe("Dormant License Reclaim");
    const active = sortCatalogItems(items, "active-first", (i) => runners[i.key]?.length ?? 0);
    expect(active.slice(0, 2).map((i) => i.name)).toEqual(["Dormant License Reclaim", "Risky Users"]);
  });

  test("counts", () => {
    const c = countCatalogItems(items, stateOf);
    expect(c.types).toEqual({ all: 4, report: 2, automation: 2 });
    expect(c.categories.infrastructure).toBe(2);
    expect(c.states).toEqual({ automated: 1, paused: 1, available: 2 });
  });
});

describe("pairing + type param", () => {
  test("automationsByPairedReport groups by report id", () => {
    const m = automationsByPairedReport(automations);
    expect(m.get("risky-users")).toEqual([{ id: "high-risk-user-containment", name: "High-Risk User Containment" }]);
    expect(m.has("license-utilization")).toBe(false);
  });

  test("every built-in automation's pairedReportId names a real report", () => {
    const reportIds = new Set(listReports().map((r) => r.id));
    const m = automationsByPairedReport(listAutomations().map((a) => ({ ...a, pairedReportId: a.pairedReportId ?? null })));
    expect(m.size).toBeGreaterThan(0);
    for (const reportId of m.keys()) expect(reportIds.has(reportId)).toBe(true);
  });

  test("report and automation ids never collide (card test ids use the bare id)", () => {
    const reportIds = new Set(listReports().map((r) => r.id));
    for (const a of listAutomations()) expect(reportIds.has(a.id)).toBe(false);
  });

  test("parseCatalogTypeParam", () => {
    expect(parseCatalogTypeParam("automation")).toBe("automation");
    expect(parseCatalogTypeParam("automations")).toBe("automation");
    expect(parseCatalogTypeParam(["report"])).toBe("report");
    expect(parseCatalogTypeParam(undefined)).toBe("all");
    expect(parseCatalogTypeParam("bogus")).toBe("all");
  });
});
