import { expect, test, describe } from "bun:test";
import {
  secureScoreReport,
  provisioningSummaryReport,
  riskyServicePrincipalsReport,
} from "../src/services/reports/catalog-new";

describe("catalog-new (Tier-1 JSON reports)", () => {
  test("secure-score summarizes current/max and pct", () => {
    const s = secureScoreReport.summarize([
      {
        id: "1",
        currentScore: 60,
        maxScore: 100,
        averageComparativeScores: [{ basis: "AllTenants", averageScore: 45 }],
        controlScores: [{ controlCategory: "Identity", controlName: "MFA", score: 8 }],
      },
    ]);
    expect(s.count).toBe(60);
    expect(s.variables.pctOfMax).toBe(60);
    expect(s.variables.peerAvg).toBe(45);
    expect(s.variables.identityControls).toBe(8);
  });

  test("secure-score tolerates empty result", () => {
    const s = secureScoreReport.summarize([]);
    expect(s.count).toBe(0);
    expect(s.variables.pctOfMax).toBe(0);
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
