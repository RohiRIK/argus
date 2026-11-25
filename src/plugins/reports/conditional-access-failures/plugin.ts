import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface CaPolicy {
  displayName?: string;
  result?: string;
  enforcedGrantControls?: string[];
  enforcedSessionControls?: string[];
}

interface CaSignIn {
  id: string;
  userPrincipalName: string;
  createdDateTime?: string;
  conditionalAccessStatus?: "success" | "failure" | "notApplied";
  status?: { errorCode?: number; failureReason?: string };
  appDisplayName?: string;
  ipAddress?: string;
  clientAppUsed?: string;
  appliedConditionalAccessPolicies?: CaPolicy[];
}

function caPolicies(row: CaSignIn): CaPolicy[] {
  return row.appliedConditionalAccessPolicies ?? [];
}

function caPolicySummary(policies: CaPolicy[] | undefined): string {
  if (!policies?.length) return "—";
  return policies.map((p) => `${p.displayName ?? "unknown policy"}${p.result ? ` (${p.result})` : ""}`).join("; ");
}

function caReason(row: CaSignIn): string {
  const reason = row.status?.failureReason;
  if (reason) return reason;
  const policyResult = caPolicies(row).find((p) => p.result)?.result;
  return policyResult ?? "policy block";
}

function caRecommendation(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes("mfa") || lower.includes("multi-factor")) return "Complete MFA registration/enrollment or review the MFA Conditional Access policy.";
  if (lower.includes("device") || lower.includes("compliant")) return "Use a compliant managed device or review device compliance policy assignment.";
  if (lower.includes("location") || lower.includes("network")) return "Sign in from an allowed location/network or adjust named-location policy.";
  return "Review the Conditional Access policy, user context, and app context before changing policy.";
}

function shortDateTime(value?: string): string {
  if (!value) return "—";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

export const plugin = defineReportPlugin<CaSignIn>({
  id: "conditional-access-failures",
  version: "1.0.0",
  name: "Conditional Access Failures",
  category: "security",
  service: "Microsoft Entra ID",
  icon: "conditional-access",
  dataSource: "graph-v1",
  metrics: ["Blocked sign-ins","Failing CA policies","Impacted users"],
  description: "Blocked sign-ins, policy gaps, device non-compliance, and MFA failures.",
  requiredPermissions: ["AuditLog.Read.All", "Policy.Read.ConditionalAccess"],
  baselineSupport: true,
  tags: ["conditional-access", "mfa", "policies"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - Identity & Access",
  rowKey: (row) => `${row.user}|${row.app}|${row.created}`,
  async fetch(transport) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    return (
      await transport.get<CaSignIn>(
        "/auditLogs/signIns?$filter=createdDateTime ge " +
          `${since} and conditionalAccessStatus eq 'failure'&$top=999` +
          "&$select=id,userPrincipalName,createdDateTime,conditionalAccessStatus,status,appDisplayName,ipAddress,clientAppUsed,appliedConditionalAccessPolicies",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const users = new Set(rows.map((r) => r.userPrincipalName));
    const apps = new Set(rows.map((r) => r.appDisplayName).filter(Boolean));
    const byPolicy = rows.reduce<Record<string, number>>((acc, r) => {
      for (const p of caPolicies(r)) {
        const k = p.displayName ?? "unknown policy";
        acc[k] = (acc[k] ?? 0) + 1;
      }
      return acc;
    }, {});
    return {
      count: rows.length,
      variables: {
        blockedSignIns: rows.length,
        affectedUsers: users.size,
        affectedApps: apps.size,
        policies: Object.entries(byPolicy).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: rows.slice(0, 50).map((r) => {
        const reason = caReason(r);
        return {
          user: r.userPrincipalName,
          app: r.appDisplayName ?? "—",
          policy: caPolicySummary(caPolicies(r)),
          reason,
          recommendation: caRecommendation(reason),
          created: shortDateTime(r.createdDateTime),
          ipAddress: r.ipAddress ?? "—",
          clientApp: r.clientAppUsed ?? "—",
        };
      }),
    };
  },
});
