import { expect, test, describe } from "bun:test";
import { computeSnoozeUntil, isSnoozed } from "../src/lib/snooze";

const now = new Date("2026-06-15T12:00:00.000Z");

describe("computeSnoozeUntil", () => {
  test("adds hours", () => {
    expect(computeSnoozeUntil(now, 3, "hours")).toBe("2026-06-15T15:00:00.000Z");
  });
  test("adds days", () => {
    expect(computeSnoozeUntil(now, 2, "days")).toBe("2026-06-17T12:00:00.000Z");
  });
  test("rejects non-positive amounts", () => {
    expect(() => computeSnoozeUntil(now, 0, "hours")).toThrow();
    expect(() => computeSnoozeUntil(now, -1, "days")).toThrow();
    expect(() => computeSnoozeUntil(now, Number.NaN, "hours")).toThrow();
  });
});

describe("isSnoozed", () => {
  test("true while the wake instant is in the future", () => {
    expect(isSnoozed("2026-06-15T13:00:00.000Z", now)).toBe(true);
  });
  test("false once the wake instant has passed (auto-resume)", () => {
    expect(isSnoozed("2026-06-15T11:00:00.000Z", now)).toBe(false);
  });
  test("false at exactly the wake instant", () => {
    expect(isSnoozed("2026-06-15T12:00:00.000Z", now)).toBe(false);
  });
  test("null/undefined/invalid are not snoozed", () => {
    expect(isSnoozed(null, now)).toBe(false);
    expect(isSnoozed(undefined, now)).toBe(false);
    expect(isSnoozed("not-a-date", now)).toBe(false);
  });
});
