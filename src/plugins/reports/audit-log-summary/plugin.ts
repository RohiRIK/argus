import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface DirectoryAudit {
  id: string;
  activityDisplayName?: string;
  category?: string;
  result?: string;
  initiatedBy?: { user?: { userPrincipalName?: string } };
}

export const plugin = defineReportPlugin<DirectoryAudit>({
  id: "audit-log-summary",
  version: "1.0.0",
  name: "Audit Log Summary",
  category: "infrastructure",
  service: "Microsoft Entra ID",
  icon: "entra",
  dataSource: "graph-v1",
  metrics: ["Directory changes","Activity breakdown","Failed operations"],
  description: "User creation, role changes, policy modifications.",
  requiredPermissions: ["AuditLog.Read.All"],
  baselineSupport: true,
  tags: ["audit", "directory", "changes"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - M365 Operations",
  async fetch(transport) {
    return (
      await transport.get<DirectoryAudit>(
        "/auditLogs/directoryAudits?$top=999&$select=id,activityDisplayName,category,result,initiatedBy",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const byCategory = rows.reduce<Record<string, number>>((acc, r) => {
      const c = r.category ?? "other";
      acc[c] = (acc[c] ?? 0) + 1;
      return acc;
    }, {});
    const failures = rows.filter((r) => r.result === "failure");
    return {
      count: rows.length,
      variables: {
        totalEvents: rows.length,
        failures: failures.length,
        categories: Object.entries(byCategory).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: rows.slice(0, 50).map((r) => ({
        activity: r.activityDisplayName ?? "—",
        category: r.category ?? "—",
        by: r.initiatedBy?.user?.userPrincipalName ?? "system",
        result: r.result ?? "—",
      })),
    };
  },
});
