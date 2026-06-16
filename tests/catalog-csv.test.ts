import { expect, test, describe } from "bun:test";
import { parseCsv } from "../src/services/graph/client";
import { mailboxQuotaReport, teamsUserActivityReport } from "../src/services/reports/catalog-csv";
import { riskDetectionsReport, spSignInsReport } from "../src/services/reports/catalog-tier3";

describe("parseCsv", () => {
  test("parses headers + rows, handles quoted fields with commas/quotes", () => {
    const csv = 'Name,Note\n"Doe, John","a ""quote"""\nJane,plain';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["Name", "Note"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Name: "Doe, John", Note: 'a "quote"' });
    expect(rows[1]).toEqual({ Name: "Jane", Note: "plain" });
  });
  test("empty input → empty", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("CSV report summaries (P7)", () => {
  test("mailbox-quota flags mailboxes >=90% quota", () => {
    const s = mailboxQuotaReport.summarize([
      { "User Principal Name": "a@x", "Storage Used (Byte)": "95", "Prohibit Send Quota (Byte)": "100" },
      { "User Principal Name": "b@x", "Storage Used (Byte)": "10", "Prohibit Send Quota (Byte)": "100" },
    ]);
    expect(s.count).toBe(1);
  });
  test("teams-user-activity flags stale last-activity", () => {
    const s = teamsUserActivityReport.summarize([
      { "User Principal Name": "a@x", "Last Activity Date": "" },
      { "User Principal Name": "b@x", "Last Activity Date": new Date().toISOString().slice(0, 10) },
    ]);
    expect(s.count).toBe(1);
  });
});

describe("tier-3 summaries (P8)", () => {
  test("risk-detections counts + flags high risk", () => {
    const s = riskDetectionsReport.summarize([
      { id: "1", riskEventType: "anonymizedIPAddress", riskLevel: "high" },
      { id: "2", riskEventType: "unfamiliarFeatures", riskLevel: "low" },
    ]);
    expect(s.count).toBe(2);
    expect(s.variables.highRisk).toBe(1);
  });
  test("sp-sign-ins counts failures", () => {
    const s = spSignInsReport.summarize([
      { id: "1", appDisplayName: "App", status: { errorCode: 0 } },
      { id: "2", appDisplayName: "App2", status: { errorCode: 50126, failureReason: "bad" } },
    ]);
    expect(s.count).toBe(2);
    expect(s.variables.failed).toBe(1);
  });
});
