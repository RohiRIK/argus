import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface MfaUser {
  userPrincipalName: string;
  isMfaRegistered?: boolean;
  isMfaCapable?: boolean;
}

export const plugin = defineReportPlugin<MfaUser>({
  id: "mfa-registration",
  version: "1.0.0",
  name: "MFA Registration Status",
  category: "identity",
  service: "Microsoft Entra ID",
  icon: "entra",
  dataSource: "graph-v1",
  metrics: ["MFA coverage %","Unregistered users","Default auth method"],
  description: "Who enrolled in MFA, who bypassed, who is pending.",
  requiredPermissions: ["AuditLog.Read.All", "UserAuthenticationMethod.Read.All"],
  baselineSupport: true,
  tags: ["mfa", "authentication", "coverage"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - Identity & Access",
  rowKey: (row) => String(row.user),
  async fetch(transport) {
    return (
      await transport.get<MfaUser>(
        "/reports/authenticationMethods/userRegistrationDetails?$top=999&$select=userPrincipalName,isMfaRegistered,isMfaCapable",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const notRegistered = rows.filter((u) => !u.isMfaRegistered);
    return {
      count: notRegistered.length,
      variables: {
        totalUsers: rows.length,
        registered: rows.length - notRegistered.length,
        notRegistered: notRegistered.length,
        registeredPercent: rows.length ? Math.round(((rows.length - notRegistered.length) / rows.length) * 100) : 0,
      },
      rows: notRegistered.slice(0, 50).map((u) => ({ user: u.userPrincipalName, capable: String(Boolean(u.isMfaCapable)) })),
    };
  },
});
