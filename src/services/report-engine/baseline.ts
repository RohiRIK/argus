export interface BaselineResult {
  mean: number;
  stddev: number;
  zScore: number;
  isAnomaly: boolean;
  /** Sample size the baseline was computed from. */
  sampleSize: number;
}

export interface TrendResult {
  delta: number;
  percent: number; // signed; +25 means up 25%
  direction: "up" | "down" | "flat";
}

const ANOMALY_THRESHOLD = 2; // standard deviations (PRD §4.4)

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compare a current value against historical samples. Flags an anomaly when it
 * is more than ANOMALY_THRESHOLD standard deviations from the mean (PRD §4.4).
 * With too little history (<2 samples) or zero variance, never an anomaly.
 */
export function detectAnomaly(current: number, history: number[]): BaselineResult {
  const m = mean(history);
  const sd = stddev(history);
  const zScore = sd > 0 ? (current - m) / sd : 0;
  return {
    mean: m,
    stddev: sd,
    zScore,
    isAnomaly: sd > 0 && Math.abs(zScore) > ANOMALY_THRESHOLD,
    sampleSize: history.length,
  };
}

/** Percentage trend of current vs. previous. */
export function computeTrend(current: number, previous: number): TrendResult {
  const delta = current - previous;
  const percent = previous === 0 ? (current === 0 ? 0 : 100) : (delta / previous) * 100;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { delta, percent: Math.round(percent * 10) / 10, direction };
}
