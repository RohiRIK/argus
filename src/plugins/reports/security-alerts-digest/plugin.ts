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
    const high = rows.filter((a) => a.severity === "high").length;
    const medium = rows.filter((a) => a.severity === "medium").length;
    const low = rows.filter((a) => a.severity === "low").length;
    const active = rows.filter((a) => a.status !== "resolved");
    return {
      count: active.length,
      variables: { totalAlerts: rows.length, activeAlerts: active.length, high, medium, low },
      rows: rows
        .filter((a) => a.severity === "high" || a.severity === "medium")
        .slice(0, 50)
        .map((a) => ({ title: a.title ?? "—", severity: a.severity ?? "—", status: a.status ?? "—" })),
    };
  },
});
