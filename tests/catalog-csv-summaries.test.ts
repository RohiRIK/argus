import { expect, test, describe } from "bun:test";
import {
  teamsUserActivityReport,
  mailboxQuotaReport,
  m365GroupsActivityReport,
  onedriveUsageReport,
  sharepointSiteUsageReport,
  activeUsersCountsReport,
  csvReports,
} from "../src/services/reports/catalog-csv";

const OLD = "2000-01-01"; // definitely stale
const FRESH = new Date().toISOString(); // definitely active

describe("catalog-csv summaries (Tier-2 usage reports)", () => {
  test("teams: flags users with stale last-activity (substring header match)", () => {
    const s = teamsUserActivityReport.summarize([
      { "User Principal Name": "a@x", "Last Activity Date": OLD },
      { "User Principal Name": "b@x", "Last Activity Date": FRESH },
      { "User Principal Name": "c@x", "Last Activity Date": "" }, // empty = stale
    ]);
    expect(s.variables.totalUsers).toBe(3);
    expect(s.variables.inactiveUsers).toBe(2);
    expect(s.count).toBe(2);
    expect(s.rows?.find((r) => r.user === "c@x")?.lastActivity).toBe("never");
  });

  test("mailbox quota: near-quota at >=90% used (num strips units)", () => {
    const s = mailboxQuotaReport.summarize([
      { "User Principal Name": "a@x", "Storage Used (Byte)": "95", "Prohibit Send Quota (Byte)": "100" },
      { "User Principal Name": "b@x", "Storage Used (Byte)": "10", "Prohibit Send Quota (Byte)": "100" },
      { "User Principal Name": "c@x", "Storage Used (Byte)": "5", "Prohibit Send Quota (Byte)": "0" }, // quota 0 → excluded
    ]);
    expect(s.variables.totalMailboxes).toBe(3);
    expect(s.variables.nearQuota).toBe(1);
    expect(s.rows?.[0]).toMatchObject({ mailbox: "a@x", usedBytes: 95 });
  });

  test("m365 groups: stale count + external-member count", () => {
    // Real M365 CSVs list "Member Count" before "External Member Count"; col() matches
    // the first header containing the needle, so order matters here.
    const s = m365GroupsActivityReport.summarize([
      { "Group Display Name": "G1", "Last Activity Date": OLD, "Member Count": "5", "External Member Count": "2" },
      { "Group Display Name": "G2", "Last Activity Date": FRESH, "Member Count": "3", "External Member Count": "0" },
    ]);
    expect(s.variables.staleGroups).toBe(1);
    expect(s.variables.withExternalMembers).toBe(1);
    expect(s.rows?.[0]).toMatchObject({ group: "G1", members: 5, external: 2 });
  });

  test("onedrive: near-quota at >=90% allocated", () => {
    const s = onedriveUsageReport.summarize([
      { "Owner Principal Name": "a@x", "Storage Used (Byte)": "91", "Storage Allocated (Byte)": "100" },
      { "Owner Principal Name": "b@x", "Storage Used (Byte)": "50", "Storage Allocated (Byte)": "100" },
    ]);
    expect(s.variables.nearQuota).toBe(1);
    expect(s.rows?.[0]).toMatchObject({ owner: "a@x", usedBytes: 91 });
  });

  test("sharepoint: inactive sites by last activity", () => {
    const s = sharepointSiteUsageReport.summarize([
      { "Site URL": "/s1", "Last Activity Date": OLD },
      { "Site URL": "/s2", "Last Activity Date": FRESH },
    ]);
    expect(s.variables.inactiveSites).toBe(1);
    expect(s.rows?.[0]).toMatchObject({ site: "/s1" });
  });

  test("active users counts: service-level active/inactive summary", () => {
    const s = activeUsersCountsReport.summarize([
      { "Report Date": "2026-06-13", "Service Display Name": "Exchange", "Active Users": "90", "Inactive Users": "10" },
      { "Report Date": "2026-06-13", "Service Display Name": "Teams", "Active Users": "100", "Inactive Users": "0" },
    ]);
    expect(s.count).toBe(10);
    expect(s.variables.reportDays).toBe(2);
    expect(s.variables.totalUsers).toBe(200);
    expect(s.rows?.[0]).toMatchObject({
      service: "Exchange",
      activeUsers: 90,
      inactiveUsers: 10,
      totalUsers: 100,
      inactivePercent: 10,
    });
    expect(s.rows?.[1]?.recommendation).toContain("No inactive users");
  });

  test("active users counts: parses Office 365 service active/inactive columns", () => {
    const s = activeUsersCountsReport.summarize([
      {
        "Report Refresh Date": "2026-06-15",
        "Exchange Active": "0",
        "Exchange Inactive": "20",
        "Teams Active": "5",
        "Teams Inactive": "10",
        "Office 365 Active": "5",
        "Office 365 Inactive": "30",
        "Report Period": "7",
      },
    ]);
    expect(s.count).toBe(30);
    expect(s.variables.activeUsers).toBe(5);
    expect(s.variables.inactiveUsers).toBe(30);
    expect(s.rows?.map((r) => r.service)).toEqual(["Exchange", "Teams", "Office 365"]);
    expect(s.rows?.[0]).toMatchObject({ service: "Exchange", activeUsers: 0, inactiveUsers: 20, totalUsers: 20, inactivePercent: 100 });
  });

  test("active users counts: empty result stays zero", () => {
    const s = activeUsersCountsReport.summarize([]);
    expect(s.count).toBe(0);
    expect(s.variables.activeUsers).toBe(0);
    expect(s.variables.inactiveUsers).toBe(0);
    expect(s.rows).toHaveLength(0);
  });

  test("registry exports all six CSV reports", () => {
    expect(csvReports).toHaveLength(6);
  });
});
