import { test, expect, describe } from "bun:test";
import { signInAnomaliesReport, type SignIn } from "../src/services/reports/sign-in-anomalies";

describe("sign-in-anomalies summarize", () => {
  const rows: SignIn[] = [
    { id: "1", userPrincipalName: "a@x", appDisplayName: "My App", appId: "app-1", ipAddress: "1.1.1.1", status: { errorCode: 65001, failureReason: "consent {identifier}" }, location: { countryOrRegion: "US" }, createdDateTime: "2026-06-16T05:40:00Z" },
    { id: "2", userPrincipalName: "a@x", appDisplayName: "My App", appId: "app-1", ipAddress: "1.1.1.1", status: { errorCode: 65001 }, createdDateTime: "2026-06-16T06:00:00Z" },
    { id: "3", userPrincipalName: "b@x", status: { errorCode: 0 }, createdDateTime: "2026-06-16T07:00:00Z" }, // success — not an anomaly
    { id: "4", userPrincipalName: "c@x", status: { errorCode: 99999, failureReason: "weird {token} thing" }, createdDateTime: "2026-06-16T08:00:00Z" },
  ];

  test("counts failures only and excludes successful sign-ins", () => {
    expect(signInAnomaliesReport.summarize(rows).count).toBe(3); // two 65001 + one 99999; success dropped
  });

  test("aggregates by user+error+app with attempt count, app label, status, date", () => {
    const r0 = signInAnomaliesReport.summarize(rows).rows?.[0];
    expect(r0).toMatchObject({ user: "a@x", app: "My App (app-1)", status: "Failed", attempts: 2 });
    expect(String(r0?.date)).toContain("2026-06-16"); // most-recent attempt in the group
  });

  test("decodes known error codes + recommendation, and never emits placeholder garble", () => {
    const out = signInAnomaliesReport.summarize(rows).rows ?? [];
    const consent = out.find((r) => r.user === "a@x");
    expect(consent?.reason).toBe("App needs admin consent");
    expect(String(consent?.recommendation)).toContain("consent");
    // Unmapped code whose raw reason has a placeholder → clean code reference, not garble.
    const weird = out.find((r) => r.user === "c@x");
    expect(weird?.reason).toBe("Sign-in failed (error 99999)");
  });
});
