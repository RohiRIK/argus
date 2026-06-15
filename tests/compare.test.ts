import { expect, test, describe } from "bun:test";
import { executionMetrics, diffMetrics, diffExecutions, type ComparableExecution } from "../src/lib/compare";

const exec = (over: Partial<ComparableExecution>): ComparableExecution => ({
  recordsProcessed: 10,
  graphApiLatencyMs: 100,
  baselineSnapshot: null,
  ...over,
});

describe("executionMetrics", () => {
  test("flattens records + latency + baseline snapshot", () => {
    expect(executionMetrics(exec({ recordsProcessed: 5, graphApiLatencyMs: 42, baselineSnapshot: { anomalies: 2 } }))).toEqual({
      records: 5,
      graphLatencyMs: 42,
      anomalies: 2,
    });
  });
  test("handles missing snapshot", () => {
    expect(executionMetrics(exec({ baselineSnapshot: null }))).toEqual({ records: 10, graphLatencyMs: 100 });
  });
});

describe("diffMetrics", () => {
  test("computes delta when both sides present", () => {
    const d = diffMetrics({ x: 3 }, { x: 7 });
    expect(d).toEqual([{ key: "x", a: 3, b: 7, delta: 4 }]);
  });
  test("negative delta", () => {
    expect(diffMetrics({ x: 9 }, { x: 4 })[0].delta).toBe(-5);
  });
  test("absent on one side yields null delta", () => {
    const d = diffMetrics({ only_a: 1 }, { only_b: 2 });
    const a = d.find((m) => m.key === "only_a")!;
    const b = d.find((m) => m.key === "only_b")!;
    expect(a).toEqual({ key: "only_a", a: 1, b: null, delta: null });
    expect(b).toEqual({ key: "only_b", a: null, b: 2, delta: null });
  });
  test("keys are unioned and sorted", () => {
    expect(diffMetrics({ b: 1, a: 1 }, { c: 1 }).map((m) => m.key)).toEqual(["a", "b", "c"]);
  });
});

describe("diffExecutions", () => {
  test("diffs two executions end-to-end", () => {
    const d = diffExecutions(
      exec({ recordsProcessed: 10, graphApiLatencyMs: 100, baselineSnapshot: { anomalies: 1 } }),
      exec({ recordsProcessed: 15, graphApiLatencyMs: 80, baselineSnapshot: { anomalies: 4 } }),
    );
    const map = new Map(d.map((m) => [m.key, m.delta]));
    expect(map.get("records")).toBe(5);
    expect(map.get("graphLatencyMs")).toBe(-20);
    expect(map.get("anomalies")).toBe(3);
  });
});
