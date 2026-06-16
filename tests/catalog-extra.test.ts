import { describe, test, expect } from "bun:test";
import {
  inactiveGuestUsersReport,
  dormantLicensedUsersReport,
  securityAlertsDigestReport,
  dlpAlertsReport,
  conditionalAccessFailuresReport,
  deviceComplianceReport,
  auditLogSummaryReport,
  manualGraphQueryReport,
} from "../src/services/reports/catalog-extra";
import { listReports } from "../src/services/reports/registry";
import type { GraphTransport } from "../src/services/graph/client";

const tx = (rows: unknown[]): GraphTransport => ({ get: async () => ({ value: rows as never[], latencyMs: 1 }) });
const old = new Date(Date.now() - 200 * 86_400_000).toISOString();

describe("full catalog", () => {
  test("registers all 26 reports", () => {
    expect(listReports().length).toBe(26);
  });
});

test("inactive-guest-users flags 90d+ inactive", () => {
  const s = inactiveGuestUsersReport.summarize([
    { id: "1", userPrincipalName: "g1@x", signInActivity: { lastSignInDateTime: old } },
    { id: "2", userPrincipalName: "g2@x", signInActivity: { lastSignInDateTime: new Date().toISOString() } },
    { id: "3", userPrincipalName: "g3@x" },
  ]);
  expect(s.count).toBe(2); // g1 stale + g3 never
  expect(s.variables.neverSignedIn).toBe(1);
});

test("license-reclamation: disabled/never/dormant get reclaim recommendations", async () => {
  const txPath = (users: unknown[], skus: unknown[]): GraphTransport => ({
    get: async (path: string) => ({ value: (path.includes("subscribedSkus") ? skus : users) as never[], latencyMs: 1 }),
  });
  const rows = await dormantLicensedUsersReport.fetch(
    txPath(
      [
        { id: "1", displayName: "Disabled", userPrincipalName: "d@x", accountEnabled: false, assignedLicenses: [{ skuId: "s1" }], signInActivity: { lastSignInDateTime: new Date().toISOString() } },
        { id: "2", displayName: "Active", userPrincipalName: "a@x", accountEnabled: true, assignedLicenses: [{ skuId: "s1" }], signInActivity: { lastSignInDateTime: new Date().toISOString() } },
        { id: "3", displayName: "Never", userPrincipalName: "n@x", accountEnabled: true, assignedLicenses: [{ skuId: "s2" }] },
        { id: "4", displayName: "Stale", userPrincipalName: "st@x", accountEnabled: true, assignedLicenses: [{ skuId: "s1" }], signInActivity: { lastSignInDateTime: old } },
        { id: "5", displayName: "Unlicensed", userPrincipalName: "u@x", accountEnabled: true, assignedLicenses: [] },
      ],
      [{ skuId: "s1", skuPartNumber: "E5" }, { skuId: "s2", skuPartNumber: "E3" }],
    ),
    { dormantDays: 30 },
  );
  const s = dormantLicensedUsersReport.summarize(rows);
  expect(s.variables.licensedUsers).toBe(4); // unlicensed excluded
  expect(s.count).toBe(3); // disabled + never + stale (active kept)
  expect(s.variables.disabledLicensed).toBe(1);
  expect(s.variables.neverSignedIn).toBe(1);
  expect(s.rows?.find((r) => r.user === "Disabled")?.recommendation).toContain("disabled");
  expect(s.rows?.find((r) => r.user === "Disabled")?.licenses).toBe("E5");
});

test("security-alerts-digest counts active + severity", () => {
  const s = securityAlertsDigestReport.summarize([
    { id: "1", severity: "high", status: "new" },
    { id: "2", severity: "medium", status: "resolved" },
  ]);
  expect(s.count).toBe(1); // active
  expect(s.variables.high).toBe(1);
});

test("dlp-alerts counts incidents", () => {
  expect(dlpAlertsReport.summarize([{ id: "1", severity: "high" }]).count).toBe(1);
});

test("conditional-access-failures aggregates users/apps", () => {
  const s = conditionalAccessFailuresReport.summarize([
    { id: "1", userPrincipalName: "a@x", appDisplayName: "App1" },
    { id: "2", userPrincipalName: "a@x", appDisplayName: "App2" },
  ]);
  expect(s.count).toBe(2);
  expect(s.variables.affectedUsers).toBe(1);
  expect(s.variables.affectedApps).toBe(2);
});

test("device-compliance counts noncompliant", () => {
  const s = deviceComplianceReport.summarize([
    { id: "1", complianceState: "noncompliant", operatingSystem: "Windows" },
    { id: "2", complianceState: "compliant", operatingSystem: "iOS" },
  ]);
  expect(s.count).toBe(1);
  expect(s.variables.compliant).toBe(1);
});

test("audit-log-summary buckets categories + failures", () => {
  const s = auditLogSummaryReport.summarize([
    { id: "1", category: "UserManagement", result: "success" },
    { id: "2", category: "RoleManagement", result: "failure" },
  ]);
  expect(s.count).toBe(2);
  expect(s.variables.failures).toBe(1);
});

describe("manual-graph-query", () => {
  test("builds path from params and counts rows", async () => {
    let path = "";
    const transport: GraphTransport = {
      get: async (p: string) => {
        path = p;
        return { value: [{ id: "1", displayName: "x" }] as never[], latencyMs: 1 };
      },
    };
    const rows = await manualGraphQueryReport.fetch(transport, { endpoint: "/groups", select: "id,displayName" });
    expect(path).toBe("/groups?$select=id,displayName");
    const s = manualGraphQueryReport.summarize(rows);
    expect(s.count).toBe(1);
  });

  test("throws without endpoint", async () => {
    await expect(manualGraphQueryReport.fetch(tx([]), {})).rejects.toThrow();
  });
});
