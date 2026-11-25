import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface ProvisioningEvent {
  id: string;
  activityDateTime?: string;
  provisioningAction?: string;
  provisioningStatusInfo?: { status?: "success" | "failure" | "skipped" | "warning" };
  sourceIdentity?: { displayName?: string };
  targetIdentity?: { displayName?: string };
  servicePrincipal?: { displayName?: string };
}

export const plugin = defineReportPlugin<ProvisioningEvent>({
  id: "provisioning-summary",
  version: "1.0.0",
  name: "Provisioning Log Summary",
  category: "infrastructure",
  description: "HR-to-Entra and SCIM sync events — surfaces failed and skipped provisioning.",
  requiredPermissions: ["AuditLog.Read.All", "Directory.Read.All"],
  baselineSupport: true,
  tags: ["scim", "provisioning", "sync"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - M365 Operations",
  async fetch(transport) {
    return (
      await transport.get<ProvisioningEvent>(
        // /auditLogs/provisioning does not allow $select — request the full objects.
        "/auditLogs/provisioning?$top=999",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const statusOf = (e: ProvisioningEvent) => e.provisioningStatusInfo?.status ?? "unknown";
    const failures = rows.filter((e) => statusOf(e) === "failure");
    const skipped = rows.filter((e) => statusOf(e) === "skipped");
    const byAction = rows.reduce<Record<string, number>>((acc, e) => {
      const a = e.provisioningAction ?? "other";
      acc[a] = (acc[a] ?? 0) + 1;
      return acc;
    }, {});
    return {
      count: failures.length,
      variables: {
        totalEvents: rows.length,
        failures: failures.length,
        skipped: skipped.length,
        actions: Object.entries(byAction).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: failures.slice(0, 50).map((e) => ({
        target: e.targetIdentity?.displayName ?? "—",
        app: e.servicePrincipal?.displayName ?? "—",
        action: e.provisioningAction ?? "—",
        status: statusOf(e),
      })),
    };
  },
});
