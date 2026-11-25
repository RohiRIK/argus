import { defineReportPlugin } from "@/plugins/sdk";
import { REPORTS_PERM, col, fetchCsv, num, type CsvRow } from "@/plugins/csv-helpers";
import type { ReportSummary } from "@/services/reports/types";

export const plugin = defineReportPlugin<CsvRow>({
  id: "onedrive-usage",
  version: "1.0.0",
  name: "OneDrive Storage & Quota",
  category: "infrastructure",
  description: "OneDrive accounts approaching their storage allocation.",
  requiredPermissions: [...REPORTS_PERM],
  baselineSupport: true,
  tags: ["onedrive", "storage", "quota"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - M365 Operations",
  usageConcealmentNote: true,
  fetch: (t) => fetchCsv(t, "/reports/getOneDriveUsageAccountDetail(period='D7')"),
  summarize(rows): ReportSummary {
    const near = rows.filter((r) => {
      const used = num(col(r, "Storage Used"));
      const alloc = num(col(r, "Storage Allocated"));
      return alloc > 0 && used / alloc >= 0.9;
    });
    return {
      count: near.length,
      variables: { totalAccounts: rows.length, nearQuota: near.length },
      rows: near.slice(0, 50).map((r) => ({
        owner: col(r, "Owner Principal Name", "Owner Display Name"),
        usedBytes: num(col(r, "Storage Used")),
      })),
    };
  },
});
