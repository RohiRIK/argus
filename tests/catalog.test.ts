import { describe, test, expect } from "bun:test";
import {
  riskyUsersReport,
  mfaRegistrationReport,
  licenseUtilizationReport,
  appSecretsExpiryReport,
} from "../src/services/reports/catalog";
import { listReports, getReport } from "../src/services/reports/registry";
import type { GraphTransport } from "../src/services/graph/client";

const tx = (rows: unknown[]): GraphTransport => ({ get: async () => ({ value: rows as never[], latencyMs: 1 }) });

describe("registry", () => {
  test("registers 5 reports", () => {
    expect(listReports().length).toBe(5);
    expect(getReport("risky-users")).toBeDefined();
    expect(getReport("nope")).toBeUndefined();
  });
});

describe("risky-users", () => {
  test("counts at-risk, flags high", async () => {
    const rows = await riskyUsersReport.fetch(
      tx([
        { id: "1", userPrincipalName: "a@x", riskLevel: "high", riskState: "atRisk" },
        { id: "2", userPrincipalName: "b@x", riskLevel: "low", riskState: "remediated" },
      ]),
      {},
    );
    const s = riskyUsersReport.summarize(rows);
    expect(s.count).toBe(1); // only non-remediated
    expect(s.variables.highRisk).toBe(1);
  });
});

describe("mfa-registration", () => {
  test("counts unregistered + percent", () => {
    const s = mfaRegistrationReport.summarize([
      { userPrincipalName: "a@x", isMfaRegistered: true },
      { userPrincipalName: "b@x", isMfaRegistered: false },
      { userPrincipalName: "c@x", isMfaRegistered: false },
    ]);
    expect(s.count).toBe(2);
    expect(s.variables.registeredPercent).toBe(33);
  });
});

describe("license-utilization", () => {
  test("computes available + overprovisioned", () => {
    const s = licenseUtilizationReport.summarize([
      { skuPartNumber: "E3", prepaidUnits: { enabled: 100 }, consumedUnits: 80 },
      { skuPartNumber: "E5", prepaidUnits: { enabled: 10 }, consumedUnits: 12 },
    ]);
    expect(s.variables.totalEnabled).toBe(110);
    expect(s.variables.available).toBe(18);
    expect(s.count).toBe(1); // E5 overprovisioned
  });
});

describe("app-secrets-expiry", () => {
  test("buckets credentials by expiry window", () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const later = new Date(Date.now() + 200 * 86_400_000).toISOString();
    const s = appSecretsExpiryReport.summarize([
      { displayName: "App1", appId: "a", passwordCredentials: [{ displayName: "s1", endDateTime: soon }] },
      { displayName: "App2", appId: "b", keyCredentials: [{ displayName: "cert", endDateTime: later }] },
    ]);
    expect(s.count).toBe(1); // only the one within 90d
    expect(s.variables.expiringWithin30).toBe(1);
  });
});
