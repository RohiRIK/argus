import { expect, test, describe } from "bun:test";
import type { GraphTransport } from "../src/services/graph/client";
import {
  riskDetectionsReport,
  spRiskDetectionsReport,
  customAttrAuditsReport,
  spSignInsReport,
  tier3Reports,
} from "../src/services/reports/catalog-tier3";

describe("catalog-tier3 summaries", () => {
  test("user risk detections: current at-risk users + remediation this week", () => {
    const now = new Date().toISOString();
    const s = riskDetectionsReport.summarize([
      { id: "1", riskEventType: "maliciousIPAddress", riskLevel: "high", riskState: "atRisk", riskDetail: "maliciousIPAddress", userPrincipalName: "a@x", detectedDateTime: now, lastUpdatedDateTime: now, currentRiskLevel: "high", currentRiskState: "atRisk", currentRiskLastUpdatedDateTime: now, ipAddress: "203.0.113.10" },
      { id: "2", riskEventType: "leakedCredentials", riskLevel: "medium", riskState: "remediated", riskDetail: "userPerformedSecuredPasswordReset", userPrincipalName: "b@x", detectedDateTime: now, lastUpdatedDateTime: now, currentRiskLevel: "none", currentRiskState: "remediated", currentRiskLastUpdatedDateTime: now },
      { id: "3", riskEventType: "maliciousIPAddress", riskLevel: "high", riskState: "remediated", riskDetail: "userPerformedSecuredPasswordReset", userPrincipalName: "c@x", detectedDateTime: new Date(Date.now() - 14 * 604_800_000).toISOString(), lastUpdatedDateTime: new Date(Date.now() - 14 * 604_800_000).toISOString(), currentRiskLevel: "none", currentRiskState: "remediated", currentRiskLastUpdatedDateTime: new Date(Date.now() - 14 * 604_800_000).toISOString() },
    ]);
    expect(s.count).toBe(2);
    expect(s.variables.highRisk).toBe(2);
    expect(s.variables.activeRisk).toBe(1);
    expect(s.variables.remediatedThisWeek).toBe(1);
    expect(s.variables.types).toContain("maliciousIPAddress: 1");
    expect(s.rows?.[0]).toMatchObject({ user: "a@x", level: "high", why: "maliciousIPAddress · maliciousIPAddress", currentState: "atRisk", remediation: "Pending: verify credential reset, revoke sessions, then dismiss if false positive.", ipAddress: "203.0.113.10" });
    expect(s.rows?.[1]).toMatchObject({ user: "b@x", currentState: "remediated", remediation: "Complete: userPerformedSecuredPasswordReset" });
  });

  test("user risk detections: empty + unknown type fallback", () => {
    const s = riskDetectionsReport.summarize([{ id: "1" }]);
    expect(s.count).toBe(0);
    expect(s.variables.highRisk).toBe(0);
    expect(s.variables.activeRisk).toBe(0);
    expect(s.variables.remediatedThisWeek).toBe(0);
    expect(s.variables.types).toEqual("");
    expect(s.rows).toEqual([]);
  });

  test("SP risk detections: current active + remediation this week", () => {
    const now = new Date().toISOString();
    const s = spRiskDetectionsReport.summarize([
      { id: "1", riskEventType: "investigationsThreatIntelligence", riskLevel: "high", riskState: "atRisk", riskDetail: "none", servicePrincipalDisplayName: "App A", servicePrincipalId: "sp-a", appId: "app-a", detectedDateTime: now, lastUpdatedDateTime: now, currentRiskLevel: "high", currentRiskState: "atRisk", currentRiskLastUpdatedDateTime: now, ipAddress: "203.0.113.20" },
      { id: "2", riskEventType: "leakedCredentials", riskLevel: "medium", riskState: "remediated", riskDetail: "microsoftRevokedSessions", servicePrincipalDisplayName: "App B", servicePrincipalId: "sp-b", appId: "app-b", detectedDateTime: now, lastUpdatedDateTime: now, currentRiskLevel: "none", currentRiskState: "remediated", currentRiskLastUpdatedDateTime: now },
      { id: "3", riskEventType: "maliciousIPAddress", riskLevel: "high", riskState: "remediated", riskDetail: "microsoftRevokedSessions", servicePrincipalDisplayName: "Old App", servicePrincipalId: "sp-c", appId: "app-c", detectedDateTime: new Date(Date.now() - 14 * 604_800_000).toISOString(), lastUpdatedDateTime: new Date(Date.now() - 14 * 604_800_000).toISOString(), currentRiskLevel: "none", currentRiskState: "remediated", currentRiskLastUpdatedDateTime: new Date(Date.now() - 14 * 604_800_000).toISOString() },
    ]);
    expect(s.count).toBe(2);
    expect(s.variables.highRisk).toBe(2);
    expect(s.variables.activeRisk).toBe(1);
    expect(s.variables.remediatedThisWeek).toBe(1);
    expect(s.rows?.[0]).toMatchObject({ servicePrincipal: "App A", appId: "app-a", level: "high", state: "atRisk", why: "investigationsThreatIntelligence", remediation: "Pending: review credential/key exposure, rotate secrets if needed, then dismiss if false positive.", ipAddress: "203.0.113.20" });
    expect(s.rows?.[1]).toMatchObject({ servicePrincipal: "App B", state: "remediated", remediation: "Complete: microsoftRevokedSessions" });
  });

  test("SP risk detections: fetch annotates current risky service principal state", async () => {
    const paths: string[] = [];
    const rows = await spRiskDetectionsReport.fetch(
      {
        get: async <T>(path: string) => {
          paths.push(path);
          if (path.includes("/identityProtection/servicePrincipalRiskDetections")) {
            return { value: [{ id: "1", riskEventType: "investigationsThreatIntelligence", riskLevel: "high", riskState: "atRisk", servicePrincipalDisplayName: "App A", servicePrincipalId: "sp-a", appId: "app-a", detectedDateTime: "2026-06-17T08:00:00Z" }] as T[], latencyMs: 1 };
          }
          if (path.includes("/identityProtection/riskyServicePrincipals")) {
            return { value: [{ id: "sp-a", displayName: "App A", appId: "app-a", riskLevel: "none", riskState: "remediated", riskLastUpdatedDateTime: "2026-06-17T09:00:00Z" }] as T[], latencyMs: 1 };
          }
          return { value: [] as T[], latencyMs: 1 };
        },
      } satisfies GraphTransport,
      {},
    );
    expect(paths[0]).toContain("/identityProtection/servicePrincipalRiskDetections?$top=500&$filter=detectedDateTime ge ");
    expect(paths[0]).toContain("&$select=id,riskEventType,riskLevel,riskState,riskDetail,servicePrincipalDisplayName,servicePrincipalId,appId,detectedDateTime,lastUpdatedDateTime,ipAddress,activity,additionalInfo,keyIds");
    expect(paths[1]).toBe("/identityProtection/riskyServicePrincipals?$top=500&$select=id,displayName,appId,servicePrincipalType,riskLevel,riskState,riskDetail,riskLastUpdatedDateTime,isEnabled,isProcessing");
    expect(rows[0]).toMatchObject({ currentRiskLevel: "none", currentRiskState: "remediated" });
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
      { id: "1", appDisplayName: "App A", servicePrincipalId: "sp-a", ipAddress: "203.0.113.10", createdDateTime: "2026-06-17T08:00:00Z", status: { errorCode: 0 } },
      { id: "2", appDisplayName: "App A", servicePrincipalId: "sp-a", ipAddress: "203.0.113.11", createdDateTime: "2026-06-17T08:01:00Z", status: { errorCode: 50126, failureReason: "bad cred" } },
      { id: "3", appDisplayName: "App B", servicePrincipalId: "sp-b", createdDateTime: "2026-06-17T08:02:00Z" },
    ]);
    expect(s.count).toBe(3);
    expect(s.variables.failed).toBe(1);
    expect(s.variables.distinctApps).toBe(2);
    expect(s.variables.failedApps).toBe(1);
    expect(s.rows?.[0]).toMatchObject({ app: "App A", servicePrincipalId: "sp-a", ipAddress: "203.0.113.10", created: "2026-06-17", result: "success", failureReason: "" });
    expect(s.rows?.[1]).toMatchObject({ ipAddress: "203.0.113.11", result: "failed", failureReason: "bad cred" });
    expect(s.rows?.[2]).toMatchObject({ ipAddress: "—" });
  });

  test("user risk detections: fetch annotates current risky-user state", async () => {
    const paths: string[] = [];
    const rows = await riskDetectionsReport.fetch(
      {
        get: async <T>(path: string) => {
          paths.push(path);
          if (path.includes("/identityProtection/riskDetections")) {
            return { value: [{ id: "1", riskEventType: "maliciousIPAddress", riskLevel: "high", riskState: "atRisk", userPrincipalName: "A@X", detectedDateTime: "2026-06-17T08:00:00Z" }] as T[], latencyMs: 1 };
          }
          if (path.includes("/identityProtection/riskyUsers")) {
            return { value: [{ userPrincipalName: "a@x", riskLevel: "none", riskState: "remediated" }] as T[], latencyMs: 1 };
          }
          return { value: [] as T[], latencyMs: 1 };
        },
      } satisfies GraphTransport,
      {},
    );
    expect(paths[0]).toContain("/identityProtection/riskDetections?$top=500&$filter=detectedDateTime ge ");
    expect(paths[0]).toContain("&$select=id,riskEventType,riskLevel,riskState,riskDetail,userPrincipalName,userDisplayName,detectedDateTime,lastUpdatedDateTime,ipAddress,activity,additionalInfo");
    expect(paths[1]).toBe("/identityProtection/riskyUsers?$top=500&$select=id,userPrincipalName,riskLevel,riskState,riskLastUpdatedDateTime");
    expect(rows[0]).toMatchObject({ currentRiskLevel: "none", currentRiskState: "remediated" });
  });

  test("registry exports all four tier-3 reports", () => {
    expect(tier3Reports.map((r) => r.id).sort()).toEqual(
      ["custom-attr-audits", "risk-detections", "sp-risk-detections", "sp-sign-ins"],
    );
  });
});
