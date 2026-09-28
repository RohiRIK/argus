import { describe, test, expect } from "bun:test";
import { evaluateCondition } from "../src/services/report-engine/conditions";

const base = { count: 0, previousCount: null, isAnomaly: false, newItemCount: 0 };

describe("metric_delta condition", () => {
  const rule = { mode: "metric_delta" as const, metric: "secureScore", direction: "drop" as const, delta: 5 };

  test("metric absent → no send, says not found (FM1/AC7)", () => {
    const r = evaluateCondition(rule, { ...base, metricValue: undefined, previousMetricValue: 70 });
    expect(r.send).toBe(false);
    expect(r.reason).toContain("not found");
  });

  test("first run (no prior) → baseline recorded, no alert (F5)", () => {
    const r = evaluateCondition(rule, { ...base, metricValue: 72, previousMetricValue: null });
    expect(r.send).toBe(false);
    expect(r.reason).toContain("baseline");
  });

  test("drop ≥ delta in 'drop' direction → send", () => {
    const r = evaluateCondition(rule, { ...base, metricValue: 64, previousMetricValue: 72 });
    expect(r.send).toBe(true); // -8 ≤ -5
    expect(r.reason).toContain("72→64");
  });

  test("drop under threshold → no send", () => {
    const r = evaluateCondition(rule, { ...base, metricValue: 70, previousMetricValue: 72 });
    expect(r.send).toBe(false); // -2, under 5
  });

  test("a rise does not trip a 'drop' rule", () => {
    const r = evaluateCondition(rule, { ...base, metricValue: 80, previousMetricValue: 72 });
    expect(r.send).toBe(false);
  });

  test("'rise' direction fires on increase", () => {
    const riseRule = { ...rule, direction: "rise" as const };
    expect(evaluateCondition(riseRule, { ...base, metricValue: 80, previousMetricValue: 72 }).send).toBe(true);
    expect(evaluateCondition(riseRule, { ...base, metricValue: 64, previousMetricValue: 72 }).send).toBe(false);
  });

  test("'either' direction fires on a move in either direction", () => {
    const eitherRule = { ...rule, direction: "either" as const };
    expect(evaluateCondition(eitherRule, { ...base, metricValue: 64, previousMetricValue: 72 }).send).toBe(true);
    expect(evaluateCondition(eitherRule, { ...base, metricValue: 80, previousMetricValue: 72 }).send).toBe(true);
    expect(evaluateCondition(eitherRule, { ...base, metricValue: 73, previousMetricValue: 72 }).send).toBe(false);
  });

  test("null prior does not read as a huge drop (FM2)", () => {
    const r = evaluateCondition(rule, { ...base, metricValue: 0, previousMetricValue: null });
    expect(r.send).toBe(false);
  });
});
