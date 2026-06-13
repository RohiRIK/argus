import { describe, test, expect } from "bun:test";
import { render, escapeHtml, extractVariables } from "../src/services/report-engine/template";
import { mean, stddev, detectAnomaly, computeTrend } from "../src/services/report-engine/baseline";
import { evaluateCondition } from "../src/services/report-engine/conditions";
import { parseCron, isValidCron, nextRuns } from "../src/lib/cron";

describe("template", () => {
  test("renders tokens and escapes values", () => {
    const out = render("Hi {{name}}, count={{n}}", { name: "<b>x</b>", n: 5 });
    expect(out).toBe("Hi &lt;b&gt;x&lt;/b&gt;, count=5");
  });
  test("unknown tokens render empty", () => {
    expect(render("a{{missing}}b", {})).toBe("ab");
  });
  test("escapeHtml handles all entities", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
  test("extractVariables lists referenced tokens", () => {
    expect(extractVariables("{{a}}{{ b }}{{a}}").sort()).toEqual(["a", "b"]);
  });
});

describe("baseline math", () => {
  test("mean and stddev", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stddev([2, 4, 6])).toBeCloseTo(1.633, 2);
  });
  test("anomaly when >2 stddev from mean", () => {
    const r = detectAnomaly(100, [10, 11, 9, 10, 12]);
    expect(r.isAnomaly).toBe(true);
    expect(r.zScore).toBeGreaterThan(2);
  });
  test("no anomaly with insufficient history", () => {
    expect(detectAnomaly(100, [10]).isAnomaly).toBe(false);
    expect(detectAnomaly(100, []).isAnomaly).toBe(false);
  });
  test("trend percent and direction", () => {
    expect(computeTrend(150, 100)).toMatchObject({ percent: 50, direction: "up" });
    expect(computeTrend(50, 100)).toMatchObject({ percent: -50, direction: "down" });
    expect(computeTrend(100, 100)).toMatchObject({ percent: 0, direction: "flat" });
  });
});

describe("conditions", () => {
  const base = { count: 3, previousCount: 5, isAnomaly: false, newItemCount: 0 };
  test("always sends", () => {
    expect(evaluateCondition({ mode: "always" }, base).send).toBe(true);
  });
  test("count_gt threshold", () => {
    expect(evaluateCondition({ mode: "count_gt", threshold: 5 }, { ...base, count: 6 }).send).toBe(true);
    expect(evaluateCondition({ mode: "count_gt", threshold: 5 }, { ...base, count: 2 }).send).toBe(false);
  });
  test("count_changed", () => {
    expect(evaluateCondition({ mode: "count_changed" }, base).send).toBe(true);
    expect(evaluateCondition({ mode: "count_changed" }, { ...base, previousCount: 3 }).send).toBe(false);
    expect(evaluateCondition({ mode: "count_changed" }, { ...base, previousCount: null }).send).toBe(true);
  });
  test("anomaly", () => {
    expect(evaluateCondition({ mode: "anomaly" }, { ...base, isAnomaly: true }).send).toBe(true);
    expect(evaluateCondition({ mode: "anomaly" }, base).send).toBe(false);
  });
  test("new_items", () => {
    expect(evaluateCondition({ mode: "new_items" }, { ...base, newItemCount: 2 }).send).toBe(true);
    expect(evaluateCondition({ mode: "new_items" }, base).send).toBe(false);
  });
});

describe("cron", () => {
  test("validates expressions", () => {
    expect(isValidCron("0 8 * * 1-5")).toBe(true);
    expect(isValidCron("0 8 * *")).toBe(false); // 4 fields
    expect(isValidCron("99 8 * * *")).toBe(false); // bad minute
  });
  test("daily 08:00 next run", () => {
    const from = new Date("2026-06-13T09:00:00");
    const [next] = nextRuns("0 8 * * *", 1, from);
    expect(next.getHours()).toBe(8);
    expect(next.getDate()).toBe(14); // already past 08:00, so tomorrow
  });
  test("business days skip weekend", () => {
    // 2026-06-13 is a Saturday; next business-day 08:00 is Monday the 15th.
    const runs = nextRuns("0 8 * * 1-5", 1, new Date("2026-06-13T10:00:00"));
    expect(runs[0].getDay()).toBe(1); // Monday
  });
  test("parseCron expands step and range", () => {
    expect(parseCron("*/15 * * * *").minute).toEqual(new Set([0, 15, 30, 45]));
  });
});
