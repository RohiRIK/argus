import { defineReportPlugin } from "@/plugins/sdk";
import { REPORTS_PERM, col, fetchCsv, isStale, num, type CsvRow } from "@/plugins/csv-helpers";
import type { ReportSummary } from "@/services/reports/types";

export const plugin = defineReportPlugin<CsvRow>({
  id: "m365-groups-activity",
  version: "1.0.0",
  name: "M365 Groups Activity",
  category: "infrastructure",
  description: "Stale groups and groups with external members.",
  requiredPermissions: [...REPORTS_PERM],
  baselineSupport: true,
  tags: ["groups", "usage", "governance"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - M365 Operations",
  usageConcealmentNote: true,
  fetch: (t) => fetchCsv(t, "/reports/getOffice365GroupsActivityDetail(period='D7')"),
  summarize(rows): ReportSummary {
    const stale = rows.filter((r) => isStale(col(r, "Last Activity Date")));
    const external = rows.filter((r) => num(col(r, "External Member Count")) > 0);
    return {
      count: stale.length,
      variables: { totalGroups: rows.length, staleGroups: stale.length, withExternalMembers: external.length },
      rows: stale.slice(0, 50).map((r) => ({
        group: col(r, "Group Display Name", "Display Name"),
        members: num(col(r, "Member Count")),
        external: num(col(r, "External Member Count")),
      })),
    };
  },
});
