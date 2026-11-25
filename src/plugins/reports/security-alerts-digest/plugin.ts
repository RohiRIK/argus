import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface SecurityAlert {
  id: string;
  title?: string;
  severity?: "informational" | "low" | "medium" | "high";
  status?: string;
  category?: string;
  createdDateTime?: string;
}

export const plugin = defineReportPlugin<SecurityAlert>({
  id: "security-alerts-digest",
  version: "1.0.0",
  name: "Security Alerts Digest",
  category: "security",
  service: "Microsoft Defender",
  icon: "defender",
  dataSource: "graph-v1",
  metrics: ["Active alerts","Severity breakdown","Detection provider"],
  description: "Aggregated alerts from Microsoft Defender / Sentinel.",
  requiredPermissions: ["SecurityAlert.Read.All"],
  baselineSupport: true,
  tags: ["defender", "sentinel", "alerts"],
  recommendedSchedule: "hourly",
  recommendedGroup: "Argus - Security Alerts",
  rowKey: (row) => String(row.title),
  async fetch(transport) {
    return (
      await transport.get<SecurityAlert>(
        "/security/alerts_v2?$top=999&$select=id,title,severity,status,category,createdDateTime",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const active = rows.filter((a) => a.status !== "resolved");
    const high = active.filter((a) => a.severity === "high").length;
    const medium = active.filter((a) => a.severity === "medium").length;
    const low = active.filter((a) => a.severity === "low").length;
    const prioritized = active.filter((a) => a.severity === "high" || a.severity === "medium");
    const displayed = prioritized.length > 0 ? prioritized : active;
    return {
      count: active.length,
      variables: { totalAlerts: rows.length, activeAlerts: active.length, high, medium, low },
      rows: displayed
        .slice(0, 50)
        .map((a) => ({ title: a.title ?? "—", severity: a.severity ?? "—", status: a.status ?? "—" })),
    };
  },
});
