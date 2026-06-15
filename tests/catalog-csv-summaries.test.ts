import { expect, test, describe } from "bun:test";
import {
  teamsUserActivityReport,
  mailboxQuotaReport,
  m365GroupsActivityReport,
  onedriveUsageReport,
  sharepointSiteUsageReport,
  emailActivityReport,
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

  test("email activity: zero send AND receive", () => {
    const s = emailActivityReport.summarize([
      { "User Principal Name": "a@x", "Send Count": "0", "Receive Count": "0" },
      { "User Principal Name": "b@x", "Send Count": "0", "Receive Count": "3" },
    ]);
    expect(s.variables.inactiveUsers).toBe(1);
    expect(s.rows?.[0]).toMatchObject({ user: "a@x", sent: 0, received: 0 });
  });

  test("active users counts: surfaces latest row columns", () => {
    const s = activeUsersCountsReport.summarize([
      { "Report Date": "2026-06-13", Exchange: "10" },
      { "Report Date": "2026-06-14", Exchange: "12", Teams: "20" },
    ]);
    expect(s.count).toBe(2);
    expect(s.variables.reportDays).toBe(2);
    expect(s.variables.Exchange).toBe("12"); // latest row
    expect(s.variables.Teams).toBe("20");
  });

  test("registry exports all seven CSV reports", () => {
    expect(csvReports).toHaveLength(7);
  });
});
