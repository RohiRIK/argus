import { expect, test, describe } from "bun:test";
import {
  riskDetectionsReport,
  spRiskDetectionsReport,
  customAttrAuditsReport,
  spSignInsReport,
  tier3Reports,
} from "../src/services/reports/catalog-tier3";

describe("catalog-tier3 summaries", () => {
  test("user risk detections: counts high-risk + groups by type", () => {
    const s = riskDetectionsReport.summarize([
      { id: "1", riskEventType: "anonymizedIPAddress", riskLevel: "high", userPrincipalName: "a@x" },
      { id: "2", riskEventType: "anonymizedIPAddress", riskLevel: "low", userPrincipalName: "b@x" },
      { id: "3", riskEventType: "unfamiliarFeatures", riskLevel: "high" },
    ]);
    expect(s.count).toBe(3);
    expect(s.variables.highRisk).toBe(2);
    expect(s.variables.types).toContain("anonymizedIPAddress: 2");
    expect(s.rows?.[0]).toMatchObject({ user: "a@x", level: "high" });
  });

  test("user risk detections: empty + unknown type fallback", () => {
    const s = riskDetectionsReport.summarize([{ id: "1" }]);
    expect(s.count).toBe(1);
    expect(s.variables.highRisk).toBe(0);
    expect(s.variables.types).toContain("unknown: 1");
    expect(s.rows?.[0]).toMatchObject({ user: "—", type: "—", level: "none" });
  });

  test("SP risk detections: high-risk count + row mapping", () => {
    const s = spRiskDetectionsReport.summarize([
      { id: "1", riskEventType: "leakedCredentials", riskLevel: "high", servicePrincipalDisplayName: "App A" },
      { id: "2", riskLevel: "low" },
    ]);
    expect(s.count).toBe(2);
    expect(s.variables.highRisk).toBe(1);
    expect(s.rows?.[0]).toMatchObject({ servicePrincipal: "App A", level: "high" });
    expect(s.rows?.[1]).toMatchObject({ servicePrincipal: "—", type: "—" });
  });

  test("custom attribute audits: counts failures + actor fallback", () => {
    const s = customAttrAuditsReport.summarize([
      { id: "1", activityDisplayName: "Add", result: "success", initiatedBy: { user: { userPrincipalName: "admin@x" } } },
      { id: "2", activityDisplayName: "Delete", result: "failure" },
    ]);
    expect(s.count).toBe(2);
    expect(s.variables.failures).toBe(1);
    expect(s.rows?.[0]).toMatchObject({ activity: "Add", by: "admin@x" });
    expect(s.rows?.[1]).toMatchObject({ by: "system", result: "failure" });
  });

  test("SP sign-ins: failed count + distinct apps + result label", () => {
    const s = spSignInsReport.summarize([
      { id: "1", appDisplayName: "App A", status: { errorCode: 0 } },
      { id: "2", appDisplayName: "App A", status: { errorCode: 50126, failureReason: "bad cred" } },
      { id: "3", appDisplayName: "App B" },
    ]);
    expect(s.count).toBe(3);
    expect(s.variables.failed).toBe(1);
    expect(s.variables.distinctApps).toBe(2);
    expect(s.rows?.[0].result).toBe("success");
    expect(s.rows?.[1].result).toBe("bad cred");
  });

  test("registry exports all four tier-3 reports", () => {
    expect(tier3Reports.map((r) => r.id).sort()).toEqual(
      ["custom-attr-audits", "risk-detections", "sp-risk-detections", "sp-sign-ins"],
    );
  });
});
