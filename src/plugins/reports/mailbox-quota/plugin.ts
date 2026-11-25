import { defineReportPlugin } from "@/plugins/sdk";
import { REPORTS_PERM, col, fetchCsv, num, type CsvRow } from "@/plugins/csv-helpers";
import type { ReportSummary } from "@/services/reports/types";

export const plugin = defineReportPlugin<CsvRow>({
  id: "mailbox-quota",
  version: "1.0.0",
  name: "Mailbox Quota Status",
  category: "infrastructure",
  description: "Mailboxes approaching their prohibit-send quota.",
  requiredPermissions: [...REPORTS_PERM],
  baselineSupport: true,
  tags: ["exchange", "mailbox", "storage"],
  recommendedSchedule: "daily",
  recommendedGroup: "Argus - M365 Operations",
  usageConcealmentNote: true,
  fetch: (t) => fetchCsv(t, "/reports/getMailboxUsageDetail(period='D7')"),
  summarize(rows): ReportSummary {
    const near = rows.filter((r) => {
      const used = num(col(r, "Storage Used"));
      const quota = num(col(r, "Prohibit Send Quota", "Storage Allocated"));
      return quota > 0 && used / quota >= 0.9;
    });
    return {
      count: near.length,
      variables: { totalMailboxes: rows.length, nearQuota: near.length },
      rows: near.slice(0, 50).map((r) => ({
        mailbox: col(r, "User Principal Name", "Display Name"),
        usedBytes: num(col(r, "Storage Used")),
      })),
    };
  },
});
