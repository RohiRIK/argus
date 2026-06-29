import { eq, and, ne, desc, lt } from "drizzle-orm";
import { getDb } from "../client";
import { executionRows, type NewExecutionRow } from "../schema";

export const executionRowsDao = {
  /** Insert a run's keyed snapshot in one statement (batched, AC-DB3 discipline). */
  insertMany(rows: NewExecutionRow[]): void {
    if (rows.length) getDb().insert(executionRows).values(rows).run();
  },

  /**
   * Row keys from the most recent PRIOR execution that produced a snapshot for
   * this job, excluding the current run. Empty set on first run. Used by the
   * diff to compute added/removed identities.
   */
  keysForLatestPriorSnapshot(jobId: string, excludeExecutionId: string): Set<string> {
    const db = getDb();
    const latest = db
      .select({ executionId: executionRows.executionId })
      .from(executionRows)
      .where(and(eq(executionRows.jobId, jobId), ne(executionRows.executionId, excludeExecutionId)))
      .orderBy(desc(executionRows.createdAt))
      .limit(1)
      .get();
    if (!latest) return new Set();
    const keys = db
      .select({ k: executionRows.rowKey })
      .from(executionRows)
      .where(eq(executionRows.executionId, latest.executionId))
      .all();
    return new Set(keys.map((r) => r.k));
  },

  /**
   * Delete snapshot rows older than `olderThanDays` (default 90) to bound DB
   * growth. Mirrors baselinesDao.prune. Returns rows removed.
   */
  prune(olderThanDays = 90): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const db = getDb();
    const stale = db.select({ id: executionRows.id }).from(executionRows).where(lt(executionRows.createdAt, cutoff)).all();
    if (stale.length) db.delete(executionRows).where(lt(executionRows.createdAt, cutoff)).run();
    return stale.length;
  },
};
