import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

export const plugin = defineReportPlugin<Record<string, unknown>>({
  id: "manual-graph-query",
  version: "1.0.0",
  name: "Manual Graph Query",
  category: "custom",
  service: "Microsoft Graph",
  icon: "graph",
  dataSource: "graph-v1",
  metrics: ["Custom OData path","JSON row extraction","Flexible vars"],
  description: "Run a custom Graph endpoint + $filter + $select and email the results.",
  requiredPermissions: ["(depends on endpoint)"],
  baselineSupport: false,
  tags: ["custom", "graph", "ad-hoc"],
  recommendedSchedule: "weekly",
  async fetch(transport, params) {
    const endpoint = typeof params.endpoint === "string" ? params.endpoint : "";
    if (!endpoint) throw new Error("Manual Graph Query requires a 'endpoint' parameter");
    const qs: string[] = [];
    if (typeof params.filter === "string" && params.filter) qs.push(`$filter=${params.filter}`);
    if (typeof params.select === "string" && params.select) qs.push(`$select=${params.select}`);
    const path = qs.length ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}${qs.join("&")}` : endpoint;
    return (await transport.get<Record<string, unknown>>(path)).value;
  },
  summarize(rows): ReportSummary {
    const keys = rows[0] ? Object.keys(rows[0]).slice(0, 6) : [];
    return {
      count: rows.length,
      variables: { records: rows.length, fields: keys.join(", ") || "—" },
      rows: rows.slice(0, 50).map((r) => {
        const out: Record<string, string | number> = {};
        for (const k of keys) {
          const v = (r as Record<string, unknown>)[k];
          out[k] = typeof v === "object" ? JSON.stringify(v) : (v as string | number);
        }
        return out;
      }),
    };
  },
});
