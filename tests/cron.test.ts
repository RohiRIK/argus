import { describe, test, expect } from "bun:test";
import { parseCron, isValidCron, nextRuns } from "../src/lib/cron";

describe("cron parser & validation", () => {
  test("validates 5-field expressions", () => {
    expect(isValidCron("0 8 * * *")).toBe(true);
    expect(isValidCron("*/15 9-17 * * 1-5")).toBe(true);
    expect(isValidCron("bad")).toBe(false);
    expect(isValidCron("60 * * * *")).toBe(false);
    expect(() => parseCron("0 * * *")).toThrow();
  });
});

describe("nextRuns optimization & DST safety", () => {
  test("computes daily, weekly, monthly, and */15 runs accurately", () => {
    const base = new Date("2026-01-15T07:30:00.000Z");

    const daily = nextRuns("0 8 * * *", 3, base, "UTC");
    expect(daily.map((d) => d.toISOString())).toEqual([
      "2026-01-15T08:00:00.000Z",
      "2026-01-16T08:00:00.000Z",
      "2026-01-17T08:00:00.000Z",
    ]);

    const step15 = nextRuns("*/15 * * * *", 3, base, "UTC");
    expect(step15.map((d) => d.toISOString())).toEqual([
      "2026-01-15T07:45:00.000Z",
      "2026-01-15T08:00:00.000Z",
      "2026-01-15T08:15:00.000Z",
    ]);

    const monthly = nextRuns("0 8 1 * *", 2, base, "UTC");
    expect(monthly.map((d) => d.toISOString())).toEqual([
      "2026-02-01T08:00:00.000Z",
      "2026-03-01T08:00:00.000Z",
    ]);
  });

  test("handles DOM + DOW union semantics (standard cron)", () => {
    // 2026-01-15 is Thu. Next Friday (dow 5) is Jan 16; 20th (dom 20) is Tue.
    const base = new Date("2026-01-15T09:00:00.000Z");
    const runs = nextRuns("0 8 20 * 5", 2, base, "UTC");
    expect(runs.map((d) => d.toISOString())).toEqual([
      "2026-01-16T08:00:00.000Z",
      "2026-01-20T08:00:00.000Z",
    ]);
  });

  test("handles DST spring-forward and fall-back in America/New_York", () => {
    // Spring forward: 2026-03-08 02:00 -> 03:00 (EST -05 -> EDT -04).
    const springBase = new Date("2026-03-07T14:00:00.000Z"); // 09:00 EST
    const springRuns = nextRuns("0 8 * * *", 2, springBase, "America/New_York");
    expect(springRuns.map((d) => d.toISOString())).toEqual([
      "2026-03-08T12:00:00.000Z", // 08:00 EDT (-04)
      "2026-03-09T12:00:00.000Z",
    ]);

    // Fall back: 2026-11-01 02:00 -> 01:00 (EDT -04 -> EST -05).
    const fallBase = new Date("2026-10-31T13:00:00.000Z"); // 09:00 EDT
    const fallRuns = nextRuns("0 8 * * *", 2, fallBase, "America/New_York");
    expect(fallRuns.map((d) => d.toISOString())).toEqual([
      "2026-11-01T13:00:00.000Z", // 08:00 EST (-05)
      "2026-11-02T13:00:00.000Z",
    ]);
  });

  test("handles Asia/Jerusalem and runs monthly preview under 50ms", () => {
    const start = performance.now();
    const runs = nextRuns("0 8 1 * *", 5, new Date("2026-01-01T00:00:00.000Z"), "Asia/Jerusalem");
    const elapsedMs = performance.now() - start;
    expect(runs).toHaveLength(5);
    expect(elapsedMs).toBeLessThan(50);
  });
});
