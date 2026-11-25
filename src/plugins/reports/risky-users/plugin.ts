import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface RiskyUser {
  id: string;
  userPrincipalName: string;
  riskLevel?: "low" | "medium" | "high" | "none";
  riskState?: string;
}

export const plugin = defineReportPlugin<RiskyUser>({
  id: "risky-users",
  version: "1.0.0",
  name: "Risky Users Report",
  category: "identity",
  description: "Users flagged by Identity Protection, with risk levels.",
  requiredPermissions: ["IdentityRiskyUser.Read.All"],
  baselineSupport: true,
  tags: ["identity-protection", "risk", "entra"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - Security Alerts",
  rowKey: (row) => String(row.user),
  async fetch(transport) {
    return (
      await transport.get<RiskyUser>(
        // Identity Protection endpoints cap $top at 500; transport pages the rest.
        "/identityProtection/riskyUsers?$top=500&$select=id,userPrincipalName,riskLevel,riskState",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const high = rows.filter((r) => r.riskLevel === "high");
    const atRisk = rows.filter((r) => r.riskState !== "remediated" && r.riskState !== "dismissed");
    return {
      count: atRisk.length,
      variables: {
        totalFlagged: rows.length,
        highRisk: high.length,
        atRisk: atRisk.length,
        topRiskUsers: high.slice(0, 5).map((u) => u.userPrincipalName).join(", ") || "none",
      },
      rows: atRisk.slice(0, 50).map((u) => ({
        user: u.userPrincipalName,
        level: u.riskLevel ?? "none",
        state: u.riskState ?? "—",
      })),
    };
  },
});
