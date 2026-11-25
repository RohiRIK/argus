import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface CustomAttrAudit {
  id: string;
  activityDisplayName?: string;
  result?: string;
  initiatedBy?: { user?: { userPrincipalName?: string } };
  activityDateTime?: string;
}

export const plugin = defineReportPlugin<CustomAttrAudit>({
  id: "custom-attr-audits",
  version: "1.0.0",
  name: "Custom Security Attribute Audit",
  category: "infrastructure",
  service: "Microsoft Entra ID",
  icon: "entra",
  dataSource: "graph-beta",
  metrics: ["Attribute mutations","Actor & target","Audit trail"],
  description: "Audit log of custom security attribute definition and assignment changes.",
  requiredPermissions: ["CustomSecAttributeAuditLogs.Read.All"],
  baselineSupport: true,
  tags: ["attributes", "audit", "beta"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - M365 Operations",
  async fetch(transport) {
    return (
      await transport.get<CustomAttrAudit>(
        // customSecurityAttributeAudits is beta-only and rejects $select; transport routes /beta/.
        "/beta/auditLogs/customSecurityAttributeAudits?$top=500",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const failures = rows.filter((r) => r.result === "failure");
    return {
      count: rows.length,
      variables: { totalChanges: rows.length, failures: failures.length },
      rows: rows.slice(0, 50).map((r) => ({
        activity: r.activityDisplayName ?? "—",
        by: r.initiatedBy?.user?.userPrincipalName ?? "system",
        result: r.result ?? "—",
      })),
    };
  },
});
