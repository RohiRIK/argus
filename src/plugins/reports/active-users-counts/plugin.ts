import { defineReportPlugin } from "@/plugins/sdk";
import { REPORTS_PERM, extractServicePairs, fetchCsv, serviceRows, type CsvRow } from "@/plugins/csv-helpers";
import type { ReportSummary } from "@/services/reports/types";

export const plugin = defineReportPlugin<CsvRow>({
  id: "active-users-counts",
  version: "1.0.0",
  name: "Active Users per Service",
  category: "infrastructure",
  description: "Active vs inactive user counts per Microsoft 365 service.",
  requiredPermissions: [...REPORTS_PERM],
  baselineSupport: true,
  tags: ["adoption", "services", "counts"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - M365 Operations",
  usageConcealmentNote: true,
  fetch: (t) => fetchCsv(t, "/reports/getOffice365ServicesUserCounts(period='D7')"),
  summarize(rows): ReportSummary {
    const latest = rows[rows.length - 1] ?? {};
    const pairs = extractServicePairs(latest).length > 0 ? serviceRows(latest) : rows.map((r) => serviceRows(r)[0]);
    const serviceRowsForTotals = pairs.filter((r) => r.service.toLowerCase() !== "office 365");
    const totals = serviceRowsForTotals.length > 0 ? serviceRowsForTotals : pairs;
    const activeUsers = totals.reduce((sum, r) => sum + r.activeUsers, 0);
    const inactiveUsers = totals.reduce((sum, r) => sum + r.inactiveUsers, 0);
    const totalUsers = activeUsers + inactiveUsers;
    return {
      count: inactiveUsers,
      variables: {
        reportDays: rows.length,
        activeUsers,
        inactiveUsers,
        totalUsers,
        inactivePercent: totalUsers > 0 ? Math.round((inactiveUsers / totalUsers) * 100) : 0,
      },
      rows: pairs.slice(0, 50),
    };
  },
});
