import { defineReportPlugin } from "@/plugins/sdk";
import { REPORTS_PERM, col, fetchCsv, isStale, type CsvRow } from "@/plugins/csv-helpers";
import type { ReportSummary } from "@/services/reports/types";

export const plugin = defineReportPlugin<CsvRow>({
  id: "teams-user-activity",
  version: "1.0.0",
  name: "Teams User Activity",
  category: "infrastructure",
  description: "Per-user Teams messages, calls, meetings — spot inactive licensed users.",
  requiredPermissions: [...REPORTS_PERM],
  baselineSupport: true,
  tags: ["teams", "usage", "adoption"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - M365 Operations",
  usageConcealmentNote: true,
  fetch: (t) => fetchCsv(t, "/reports/getTeamsUserActivityUserDetail(period='D7')"),
  summarize(rows): ReportSummary {
    const inactive = rows.filter((r) => isStale(col(r, "Last Activity Date")));
    return {
      count: inactive.length,
      variables: { totalUsers: rows.length, inactiveUsers: inactive.length },
      rows: inactive.slice(0, 50).map((r) => ({
        user: col(r, "User Principal Name"),
        lastActivity: col(r, "Last Activity Date") || "never",
      })),
    };
  },
});
