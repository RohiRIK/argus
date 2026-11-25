import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface RiskyServicePrincipal {
  id: string;
  displayName?: string;
  appId?: string;
  isEnabled?: boolean;
  riskLevel?: "low" | "medium" | "high" | "none";
  riskState?: "atRisk" | "confirmedCompromised" | "remediated" | "dismissed" | "none";
}

export const plugin = defineReportPlugin<RiskyServicePrincipal>({
  id: "risky-service-principals",
  version: "1.0.0",
  name: "Risky Service Principals",
  category: "security",
  description: "Non-human identities (apps, managed identities) flagged by Identity Protection.",
  requiredPermissions: ["IdentityRiskyServicePrincipal.Read.All"],
  baselineSupport: true,
  tags: ["workload-identity", "apps", "risk"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - Security Alerts",
  rowKey: (row) => String(row.appId),
  async fetch(transport) {
    return (
      await transport.get<RiskyServicePrincipal>(
        // Identity Protection endpoints cap $top at 500; transport pages the rest via @odata.nextLink.
        "/identityProtection/riskyServicePrincipals?$top=500&$select=id,displayName,appId,isEnabled,riskLevel,riskState",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const high = rows.filter((r) => r.riskLevel === "high");
    const atRisk = rows.filter((r) => r.riskState === "atRisk" || r.riskState === "confirmedCompromised");
    return {
      count: atRisk.length,
      variables: {
        totalFlagged: rows.length,
        highRisk: high.length,
        atRisk: atRisk.length,
        compromised: rows.filter((r) => r.riskState === "confirmedCompromised").length,
        topRisky: high.slice(0, 5).map((r) => r.displayName ?? r.appId ?? "—").join(", ") || "none",
      },
      rows: atRisk.slice(0, 50).map((r) => ({
        servicePrincipal: r.displayName ?? "—",
        appId: r.appId ?? "—",
        level: r.riskLevel ?? "none",
        state: r.riskState ?? "—",
      })),
    };
  },
});
