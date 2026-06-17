import type { GraphTransport } from "@/services/graph/client";
import type { ReportDefinition, ReportSummary } from "./types";

/**
 * Tier-2 usage reports (docs/new-reports.md) — Microsoft 365 `/reports/*` CSV
 * endpoints. They all need `Reports.Read.All` and the transport's `getCsv` seam.
 * Column names vary by tenant/locale, so `col()` matches headers by substring.
 */

type Row = Record<string, string>;
const REPORTS_PERM = ["Reports.Read.All"];
const DAY = 86_400_000;

// Returns the first NON-EMPTY value among candidate columns (matched by header
// substring). Falling through on empty is essential when a tenant conceals some
// fields (anonymized usage reports) but populates others.
function col(row: Row, ...needles: string[]): string {
  const keys = Object.keys(row);
  for (const n of needles) {
    const k = keys.find((key) => key.toLowerCase().includes(n.toLowerCase()));
    if (k && row[k]?.trim()) return row[k];
  }
  return "";
}
function num(v: string): number {
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function isStale(lastActivity: string, days = 7): boolean {
  if (!lastActivity) return true;
  const t = Date.parse(lastActivity);
  return Number.isNaN(t) ? true : Date.now() - t > days * DAY;
}

function servicePairs(row: Row): string[] {
  const services = new Set<string>();
  for (const key of Object.keys(row)) {
    const activeMatch = key.match(/^(.*)\s+Active$/i);
    const inactiveMatch = key.match(/^(.*)\s+Inactive$/i);
    const service = activeMatch?.[1] ?? inactiveMatch?.[1];
    if (service) services.add(service.trim());
  }
  return [...services];
}
function serviceCell(row: Row, service: string, suffix: "Active" | "Inactive"): string {
  const needle = `${service} ${suffix}`.toLowerCase();
  return Object.entries(row).find(([key]) => key.toLowerCase() === needle)?.[1] ?? "";
}
function serviceRows(row: Row) {
  const services = servicePairs(row);
  if (services.length === 0) {
    const service = col(row, "Service Display Name") || "Microsoft 365";
    const activeUsers = num(col(row, "Active Users"));
    const inactiveUsers = num(col(row, "Inactive Users"));
    const totalUsers = activeUsers + inactiveUsers;
    const inactivePercent = totalUsers > 0 ? Math.round((inactiveUsers / totalUsers) * 100) : 0;
    return [
      {
        service,
        activeUsers,
        inactiveUsers,
        totalUsers,
        inactivePercent,
        recommendation: inactiveUsers > 0 ? "Review inactive users and remove stale access if no longer needed." : "No inactive users detected for this service.",
      },
    ];
  }
  return services.map((service) => {
    const activeUsers = num(serviceCell(row, service, "Active"));
    const inactiveUsers = num(serviceCell(row, service, "Inactive"));
    const totalUsers = activeUsers + inactiveUsers;
    const inactivePercent = totalUsers > 0 ? Math.round((inactiveUsers / totalUsers) * 100) : 0;
    return {
      service,
      activeUsers,
      inactiveUsers,
      totalUsers,
      inactivePercent,
      recommendation: inactiveUsers > 0 ? "Review inactive users and remove stale access if no longer needed." : "No inactive users detected for this service.",
    };
  });
}
async function fetchCsv(transport: GraphTransport, path: string): Promise<Row[]> {
  if (!transport.getCsv) throw new Error("This report requires CSV transport, which is unavailable.");
  return (await transport.getCsv(path)).rows;
}

export const teamsUserActivityReport: ReportDefinition<Row> = {
  id: "teams-user-activity",
  name: "Teams User Activity",
  category: "infrastructure",
  description: "Per-user Teams messages, calls, meetings — spot inactive licensed users.",
  requiredPermissions: REPORTS_PERM,
  baselineSupport: true,
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
};

export const mailboxQuotaReport: ReportDefinition<Row> = {
  id: "mailbox-quota",
  name: "Mailbox Quota Status",
  category: "infrastructure",
  description: "Mailboxes approaching their prohibit-send quota.",
  requiredPermissions: REPORTS_PERM,
  baselineSupport: true,
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
};

export const m365GroupsActivityReport: ReportDefinition<Row> = {
  id: "m365-groups-activity",
  name: "M365 Groups Activity",
  category: "infrastructure",
  description: "Stale groups and groups with external members.",
  requiredPermissions: REPORTS_PERM,
  baselineSupport: true,
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
};

export const onedriveUsageReport: ReportDefinition<Row> = {
  id: "onedrive-usage",
  name: "OneDrive Storage & Quota",
  category: "infrastructure",
  description: "OneDrive accounts approaching their storage allocation.",
  requiredPermissions: REPORTS_PERM,
  baselineSupport: true,
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
      rows: near.slice(0, 50).map((r) => ({ owner: col(r, "Owner Principal Name", "Owner Display Name"), usedBytes: num(col(r, "Storage Used")) })),
    };
  },
};

export const sharepointSiteUsageReport: ReportDefinition<Row> = {
  id: "sharepoint-site-usage",
  name: "SharePoint Site Usage",
  category: "infrastructure",
  description:
    "Inactive SharePoint sites (no activity in the window). Note: real site names only appear if report-name concealment is OFF (M365 Admin → Settings → Org settings → Reports → uncheck “Display concealed names”).",
  requiredPermissions: REPORTS_PERM,
  baselineSupport: true,
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
};

// Email Activity report removed — replaced by the more actionable
// "Dormant Licensed Users" report (catalog-extra.ts), which keys off real
// sign-in activity + assigned licenses rather than a 7-day mailbox window.

export const activeUsersCountsReport: ReportDefinition<Row> = {
  id: "active-users-counts",
  name: "Active Users per Service",
  category: "infrastructure",
  description: "Active vs inactive user counts per Microsoft 365 service.",
  requiredPermissions: REPORTS_PERM,
  baselineSupport: true,
  fetch: (t) => fetchCsv(t, "/reports/getOffice365ServicesUserCounts(period='D7')"),
  summarize(rows): ReportSummary {
    const latest = rows[rows.length - 1] ?? {};
    const pairs = servicePairs(latest).length > 0 ? serviceRows(latest) : rows.map((r) => serviceRows(r)[0]);
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
};

export const csvReports = [
  teamsUserActivityReport,
  mailboxQuotaReport,
  m365GroupsActivityReport,
  onedriveUsageReport,
  sharepointSiteUsageReport,
  activeUsersCountsReport,
];
