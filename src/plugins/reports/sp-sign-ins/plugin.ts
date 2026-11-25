import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

function shortDate(value?: string): string {
  return value ? value.slice(0, 10) : "—";
}

function failureReason(status?: { errorCode?: number; failureReason?: string }): string {
  if (!status || status.errorCode === 0) return "";
  return status.failureReason ?? "failed";
}

interface SpSignIn {
  id: string;
  appDisplayName?: string;
  servicePrincipalId?: string;
  ipAddress?: string;
  status?: { errorCode?: number; failureReason?: string };
  createdDateTime?: string;
}

export const plugin = defineReportPlugin<SpSignIn>({
  id: "sp-sign-ins",
  version: "1.0.0",
  name: "Service Principal Sign-Ins",
  category: "security",
  service: "Microsoft Entra ID",
  icon: "credentials",
  dataSource: "graph-beta",
  metrics: ["Workload sign-in fails","App IDs & IPs","Error frequency"],
  description: "Non-human identity sign-ins (best-effort; the filter may be unsupported on some tenants).",
  requiredPermissions: ["AuditLog.Read.All"],
  baselineSupport: true,
  tags: ["workload-identity", "sign-in", "beta"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - Security Alerts",
  async fetch(transport) {
    return (
      await transport.get<SpSignIn>(
        // The signInEventTypes filter is beta-only; transport routes /beta/.
        "/beta/auditLogs/signIns?$top=500&$filter=signInEventTypes/any(t:t eq 'servicePrincipal')" +
          "&$select=id,appDisplayName,servicePrincipalId,ipAddress,status,createdDateTime",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const failed = rows.filter((r) => (r.status?.errorCode ?? 0) !== 0);
    const apps = new Set(rows.map((r) => r.appDisplayName).filter(Boolean));
    const failedApps = new Set(failed.map((r) => r.appDisplayName).filter(Boolean));
    return {
      count: rows.length,
      variables: { totalSignIns: rows.length, failed: failed.length, distinctApps: apps.size, failedApps: failedApps.size },
      rows: rows.slice(0, 50).map((r) => ({
        app: r.appDisplayName ?? "—",
        servicePrincipalId: r.servicePrincipalId ?? "—",
        ipAddress: r.ipAddress ?? "—",
        created: shortDate(r.createdDateTime),
        result: (r.status?.errorCode ?? 0) === 0 ? "success" : "failed",
        failureReason: failureReason(r.status),
      })),
    };
  },
});
