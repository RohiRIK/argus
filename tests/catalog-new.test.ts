import { expect, test, describe } from "bun:test";
import {
  secureScoreReport,
  provisioningSummaryReport,
  riskyServicePrincipalsReport,
} from "../src/services/reports/catalog-new";

describe("catalog-new (Tier-1 JSON reports)", () => {
  test("secure-score summarizes current/max, trend, categories, and control recommendations", () => {
    const s = secureScoreReport.summarize([
      {
        id: "1",
        createdDateTime: "2026-06-17T00:00:00Z",
        currentScore: 60,
        maxScore: 100,
        activeUserCount: 12,
        licensedUserCount: 10,
        enabledServices: ["HasExchange"],
        averageComparativeScores: [{ basis: "AllTenants", averageScore: 45 }],
        controlScores: [
          { controlCategory: "Identity", controlName: "MFA", score: 8, implementationStatus: "MFA is enabled.", scoreInPercentage: 100 },
          { controlCategory: "Data", controlName: "DLP", score: 0, implementationStatus: "<p>DLP is not configured&nbsp;</p>", scoreInPercentage: 0 },
        ],
      },
      { id: "2", currentScore: 55, maxScore: 100 },
    ]);
    expect(s.count).toBe(60);
    expect(s.variables.pctOfMax).toBe(60);
    expect(s.variables.previousScore).toBe(55);
    expect(s.variables.scoreDelta).toBe(5);
    expect(s.variables.scoreTrend).toBe("up");
    expect(s.variables.peerAvg).toBe(45);
    expect(s.variables.identityControls).toBe(8);
    expect(s.variables.dataControls).toBe(0);
    expect(s.variables.activeUsers).toBe(12);
    expect(s.variables.enabledServices).toBe("HasExchange");
    expect(s.rows?.[0]).toMatchObject({ category: "Data", control: "DLP", score: 0, status: "DLP is not configured", recommendation: "Not implemented — implement this control to raise Secure Score." });
  });

  test("secure-score tolerates empty result", () => {
    const s = secureScoreReport.summarize([]);
    expect(s.count).toBe(0);
    expect(s.variables.pctOfMax).toBe(0);
  });

  test("secure-score fetches seven daily snapshots", async () => {
    let path = "";
    await secureScoreReport.fetch({ get: async (p: string) => { path = p; return { value: [], latencyMs: 1 }; } }, {});
    expect(path).toBe("/security/secureScores?$top=7");
  });

  test("provisioning-summary counts failures and skips", () => {
    const s = provisioningSummaryReport.summarize([
      { id: "1", provisioningAction: "create", provisioningStatusInfo: { status: "failure" }, targetIdentity: { displayName: "u1" } },
      { id: "2", provisioningAction: "update", provisioningStatusInfo: { status: "success" } },
      { id: "3", provisioningAction: "create", provisioningStatusInfo: { status: "skipped" } },
    ]);
    expect(s.count).toBe(1); // failures key the condition
    expect(s.variables.totalEvents).toBe(3);
    expect(s.variables.skipped).toBe(1);
    expect(s.rows?.[0]?.target).toBe("u1");
  });

  test("risky-service-principals flags atRisk + compromised", () => {
    const s = riskyServicePrincipalsReport.summarize([
      { id: "1", displayName: "app1", riskLevel: "high", riskState: "atRisk" },
      { id: "2", displayName: "app2", riskLevel: "high", riskState: "confirmedCompromised" },
      { id: "3", displayName: "app3", riskLevel: "low", riskState: "remediated" },
    ]);
    expect(s.count).toBe(2);
    expect(s.variables.highRisk).toBe(2);
    expect(s.variables.compromised).toBe(1);
  });
});
