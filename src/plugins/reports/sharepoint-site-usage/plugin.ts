import { defineReportPlugin } from "@/plugins/sdk";
import { REPORTS_PERM, col, fetchCsv, isStale, type CsvRow } from "@/plugins/csv-helpers";
import type { ReportSummary } from "@/services/reports/types";

export const plugin = defineReportPlugin<CsvRow>({
  id: "sharepoint-site-usage",
  version: "1.0.0",
  name: "SharePoint Site Usage",
  category: "infrastructure",
  description:
    "Inactive SharePoint sites (no activity in the window). Note: real site names only appear if report-name concealment is OFF (M365 Admin → Settings → Org settings → Reports → uncheck “Display concealed names”).",
  requiredPermissions: [...REPORTS_PERM],
  baselineSupport: true,
  tags: ["sharepoint", "sites", "usage"],
  recommendedSchedule: "weekly",
  recommendedGroup: "Argus - M365 Operations",
  usageConcealmentNote: true,
  fetch: (t) => fetchCsv(t, "/reports/getSharePointSiteUsageDetail(period='D7')"),
  summarize(rows): ReportSummary {
    const inactive = rows.filter((r) => isStale(col(r, "Last Activity Date")));
    return {
      count: inactive.length,
      variables: { totalSites: rows.length, inactiveSites: inactive.length },
      rows: inactive.slice(0, 50).map((r) => ({
        site: col(r, "Site URL", "Owner Display Name", "Owner Principal Name", "Site Id") || "—",
        template: col(r, "Root Web Template") || "—",
        lastActivity: col(r, "Last Activity Date") || "never",
      })),
    };
  },
});
