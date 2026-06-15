/**
 * Pure helpers for the side-by-side execution comparison (read-only). Build a
 * flat metric map from an execution and diff two maps key-by-key.
 */

export interface ComparableExecution {
  recordsProcessed: number;
  graphApiLatencyMs: number;
  baselineSnapshot?: Record<string, number> | null;
}

export interface MetricDiff {
  key: string;
  a: number | null; // null = metric absent on that side
  b: number | null;
  delta: number | null; // b - a when both present
}

/** Flatten an execution's numeric signals into one metric map. */
export function executionMetrics(e: ComparableExecution): Record<string, number> {
  return {
    records: e.recordsProcessed,
    graphLatencyMs: e.graphApiLatencyMs,
    ...(e.baselineSnapshot ?? {}),
  };
}

/** Union of both metric maps, sorted by key, with deltas where both sides have a value. */
export function diffMetrics(a: Record<string, number>, b: Record<string, number>): MetricDiff[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.map((key) => {
    const av = key in a ? a[key] : null;
    const bv = key in b ? b[key] : null;
    return { key, a: av, b: bv, delta: av != null && bv != null ? bv - av : null };
  });
}

/** Convenience: diff two executions directly. */
export function diffExecutions(a: ComparableExecution, b: ComparableExecution): MetricDiff[] {
  return diffMetrics(executionMetrics(a), executionMetrics(b));
}
