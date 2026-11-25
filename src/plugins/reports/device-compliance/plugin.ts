import { defineReportPlugin } from "@/plugins/sdk";
import type { ReportSummary } from "@/services/reports/types";

interface ManagedDevice {
  id: string;
  deviceName?: string;
  complianceState?: "compliant" | "noncompliant" | "unknown" | "error";
  operatingSystem?: string;
  osVersion?: string;
}

export const plugin = defineReportPlugin<ManagedDevice>({
  id: "device-compliance",
  version: "1.0.0",
  name: "Device Compliance (Intune)",
  category: "infrastructure",
  description: "Non-compliant devices, pending actions, OS versions.",
  requiredPermissions: ["DeviceManagementManagedDevices.Read.All"],
  baselineSupport: true,
  tags: ["intune", "devices", "compliance"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - M365 Operations",
  rowKey: (row) => String(row.device),
  async fetch(transport) {
    return (
      await transport.get<ManagedDevice>(
        "/deviceManagement/managedDevices?$top=999&$select=id,deviceName,complianceState,operatingSystem,osVersion",
      )
    ).value;
  },
  summarize(rows): ReportSummary {
    const noncompliant = rows.filter((d) => d.complianceState === "noncompliant");
    const byOs = rows.reduce<Record<string, number>>((acc, d) => {
      const os = d.operatingSystem ?? "unknown";
      acc[os] = (acc[os] ?? 0) + 1;
      return acc;
    }, {});
    return {
      count: noncompliant.length,
      variables: {
        totalDevices: rows.length,
        nonCompliant: noncompliant.length,
        compliant: rows.filter((d) => d.complianceState === "compliant").length,
        osBreakdown: Object.entries(byOs).map(([k, v]) => `${k}: ${v}`).join(", "),
      },
      rows: noncompliant.slice(0, 50).map((d) => ({
        device: d.deviceName ?? "—",
        os: `${d.operatingSystem ?? "?"} ${d.osVersion ?? ""}`.trim(),
        state: d.complianceState ?? "unknown",
      })),
    };
  },
});
