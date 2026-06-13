import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../client";
import { baselines, type Baseline } from "../schema";

export const baselinesDao = {
  record(jobId: string, metricName: string, metricValue: number, windowDays = 7): Baseline {
    return getDb()
      .insert(baselines)
      .values({
        id: crypto.randomUUID(),
        jobId,
        metricName,
        metricValue,
        windowDays,
        calculatedAt: new Date().toISOString(),
      })
      .returning()
      .get();
  },

  /** Recent values for a metric (newest first), for baseline math. */
  history(jobId: string, metricName: string, limit = 30): number[] {
    return getDb()
      .select({ v: baselines.metricValue })
      .from(baselines)
      .where(and(eq(baselines.jobId, jobId), eq(baselines.metricName, metricName)))
      .orderBy(desc(baselines.calculatedAt))
      .limit(limit)
      .all()
      .map((r) => r.v);
  },
};
