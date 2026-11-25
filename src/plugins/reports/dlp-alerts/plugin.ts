import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface DlpAlert {
  id: string;
  title?: string;
  severity?: "informational" | "low" | "medium" | "high";
  status?: string;
  category?: string;
  createdDateTime?: string;
}

export const plugin = defineReportPlugin<DlpAlert>({
  id: "dlp-alerts",
  version: "1.0.0",
  name: "DLP Alerts",
  category: "security",
  description: "Data loss prevention incidents from security alerts.",
  requiredPermissions: ["SecurityAlert.Read.All"],
  baselineSupport: true,
  tags: ["dlp", "purview", "data-protection"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - Security Alerts",
  rowKey: (row) => String(row.title),
  async fetch(transport) {
    return (
      await transport.get<DlpAlert>(
        "/security/alerts_v2?$filter=category eq 'DataLossPrevention'&$top=999" +
          "&$select=id,title,severity,status,category,createdDateTime",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const high = rows.filter((a) => a.severity === "high").length;
    const medium = rows.filter((a) => a.severity === "medium").length;
    const low = rows.filter((a) => a.severity === "low").length;
    return {
      count: rows.length,
      variables: { dlpIncidents: rows.length, high, medium, low },
      rows: rows.slice(0, 50).map((a) => ({ title: a.title ?? "—", severity: a.severity ?? "—" })),
    };
  },
});
