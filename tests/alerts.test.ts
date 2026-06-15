import { expect, test, describe } from "bun:test";
import {
  consecutiveFailures,
  shouldAlertOnFailures,
  buildFailureAlertEmail,
  buildTestSendEmail,
} from "../src/services/dispatch/alerts";

describe("consecutiveFailures", () => {
  test("counts the leading failed streak (newest-first)", () => {
    expect(consecutiveFailures(["failed", "failed", "success"])).toBe(2);
  });
  test("zero when the newest run did not fail", () => {
    expect(consecutiveFailures(["success", "failed", "failed"])).toBe(0);
  });
  test("empty list is zero", () => {
    expect(consecutiveFailures([])).toBe(0);
  });
  test("all-failed counts every entry", () => {
    expect(consecutiveFailures(["failed", "failed", "failed"])).toBe(3);
  });
});

describe("shouldAlertOnFailures", () => {
  test("fires exactly when the streak reaches the threshold", () => {
    expect(shouldAlertOnFailures(["failed", "failed", "failed"], 3)).toBe(true);
  });
  test("does not fire below the threshold", () => {
    expect(shouldAlertOnFailures(["failed", "failed"], 3)).toBe(false);
  });
  test("does not re-fire past the threshold (one alert per breach)", () => {
    expect(shouldAlertOnFailures(["failed", "failed", "failed", "failed"], 3)).toBe(false);
  });
  test("threshold 0 disables alerting", () => {
    expect(shouldAlertOnFailures(["failed", "failed", "failed"], 0)).toBe(false);
  });
});

describe("buildFailureAlertEmail", () => {
  test("subject + body name the job and streak; includes error and recipients", () => {
    const m = buildFailureAlertEmail({
      jobName: "Daily Sign-ins",
      consecutiveFailures: 3,
      errorMessage: "403 Forbidden",
      recipients: ["admin@x.com"],
      from: "shared@x.com",
      replyTo: "noreply@x.com",
    });
    expect(m.subject).toContain("Daily Sign-ins");
    expect(m.subject).toContain("3×");
    expect(m.html).toContain("403 Forbidden");
    expect(m.to).toEqual(["admin@x.com"]);
    expect(m.from).toBe("shared@x.com");
    expect(m.replyTo).toBe("noreply@x.com");
  });
  test("omits the error line when none given", () => {
    const m = buildFailureAlertEmail({ jobName: "J", consecutiveFailures: 2, recipients: ["a@x"], from: "s@x" });
    expect(m.html).not.toContain("Latest error");
  });
});

describe("buildTestSendEmail", () => {
  test("prefixes [TEST] when absent", () => {
    expect(buildTestSendEmail({ subject: "Report", html: "<p>x</p>", recipients: ["a@x"], from: "s@x" }).subject).toBe("[TEST] Report");
  });
  test("does not double-prefix", () => {
    expect(buildTestSendEmail({ subject: "[TEST] Report", html: "<p>x</p>", recipients: ["a@x"], from: "s@x" }).subject).toBe("[TEST] Report");
  });
});
