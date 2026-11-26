import { eq, desc, and, gte, lte, ne, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { getDb, getRawDb } from "../client";
import {
  executions,
  logs,
  executionRows,
  type Execution,
  type NewExecution,
  type Log,
  type NewLog,
  type NewExecutionRow,
} from "../schema";

export type ExecutionSummary = Omit<Execution, "outputHtml">;

const SUMMARY_COLUMNS = {
  id: executions.id,
  jobId: executions.jobId,
  status: executions.status,
  trigger: executions.trigger,
  deliveryStatus: executions.deliveryStatus,
  startedAt: executions.startedAt,
  endedAt: executions.endedAt,
  recordsProcessed: executions.recordsProcessed,
  graphApiLatencyMs: executions.graphApiLatencyMs,
  errorMessage: executions.errorMessage,
  emailSent: executions.emailSent,
  emailRecipients: executions.emailRecipients,
  suppressionReason: executions.suppressionReason,
  baselineSnapshot: executions.baselineSnapshot,
  metricsSnapshot: executions.metricsSnapshot,
  webhookDelivered: executions.webhookDelivered,
  webhookError: executions.webhookError,
  createdAt: executions.createdAt,
};

const nowIso = () => new Date().toISOString();

export const executionsDao = {
  create(input: Omit<NewExecution, "id" | "createdAt"> & { id?: string }): Execution {
    const row: NewExecution = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: nowIso(),
    };
    return getDb().insert(executions).values(row).returning().get();
  },

  update(id: string, patch: Partial<NewExecution>): Execution | undefined {
    return getDb().update(executions).set(patch).where(eq(executions.id, id)).returning().get();
  },

  /**
   * Atomically flush buffered logs, the result-row snapshot, and the terminal
   * patch in a single transaction — one commit instead of N (AC-DB3). Used by the
   * executor at the end of a run so per-row inserts don't each pay a WAL commit.
   */
  finalize(
    id: string,
    patch: Partial<NewExecution>,
    logRows: NewLog[],
    snapshotRows: NewExecutionRow[] = [],
  ): Execution | undefined {
    return getDb().transaction((tx) => {
      if (logRows.length) tx.insert(logs).values(logRows).run();
      if (snapshotRows.length) tx.insert(executionRows).values(snapshotRows).run();
      return tx.update(executions).set(patch).where(eq(executions.id, id)).returning().get();
    });
  },

  findById(id: string): Execution | undefined {
    return getDb().select().from(executions).where(eq(executions.id, id)).get();
  },

  forJob(jobId: string, limit = 50): Execution[] {
    return getDb()
      .select()
      .from(executions)
      .where(eq(executions.jobId, jobId))
      .orderBy(desc(executions.startedAt))
      .limit(limit)
      .all();
  },

  /** Latest execution summary (without outputHtml) per job id in 2 fast indexed queries. */
  latestByJobIds(jobIds: string[]): Map<string, ExecutionSummary> {
    const out = new Map<string, ExecutionSummary>();
    if (jobIds.length === 0) return out;
    const placeholders = jobIds.map(() => "?").join(", ");
    const latestIds = getRawDb()
      .query(
        `SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY started_at DESC) AS rn
          FROM executions
          WHERE job_id IN (${placeholders})
        ) WHERE rn = 1`,
      )
      .all(...jobIds) as Array<{ id: string }>;
    if (latestIds.length === 0) return out;
    const rows = getDb()
      .select(SUMMARY_COLUMNS)
      .from(executions)
      .where(inArray(executions.id, latestIds.map((r) => r.id)))
      .all();
    for (const row of rows) out.set(row.jobId, row);
    return out;
  },

  /** Recent execution status summaries per job id (for dashboard cards, avoids N+1 and outputHtml). */
  recentStatusesByJobIds(
    jobIds: string[],
    perJobLimit = 20,
  ): Map<string, Array<{ id: string; status: Execution["status"]; startedAt: string }>> {
    const out = new Map<string, Array<{ id: string; status: Execution["status"]; startedAt: string }>>();
    if (jobIds.length === 0) return out;
    const placeholders = jobIds.map(() => "?").join(", ");
    const rows = getRawDb()
      .query(
        `SELECT id, job_id, status, started_at FROM (
          SELECT id, job_id, status, started_at,
                 ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY started_at DESC) AS rn
          FROM executions
          WHERE job_id IN (${placeholders})
        ) WHERE rn <= ?
        ORDER BY job_id, started_at DESC`,
      )
      .all(...jobIds, perJobLimit) as Array<{
      id: string;
      job_id: string;
      status: Execution["status"];
      started_at: string;
    }>;
    for (const r of rows) {
      let arr = out.get(r.job_id);
      if (!arr) {
        arr = [];
        out.set(r.job_id, arr);
      }
      arr.push({ id: r.id, status: r.status, startedAt: r.started_at });
    }
    return out;
  },

  /** Most recent prior recordsProcessed for a job (lightweight, skips outputHtml). */
  latestCountForJob(jobId: string, excludeExecutionId: string): number | null {
    const row = getDb()
      .select({ recordsProcessed: executions.recordsProcessed })
      .from(executions)
      .where(
        and(
          eq(executions.jobId, jobId),
          ne(executions.id, excludeExecutionId),
          // Interrupted runs never finished counting; don't let them skew trends.
          ne(executions.status, "interrupted"),
        ),
      )
      .orderBy(desc(executions.startedAt))
      .limit(1)
      .get();
    return row ? row.recordsProcessed : null;
  },

  /** Most recent prior value of `metric` from metricsSnapshot (skips runs without snapshots and omits outputHtml). */
  latestMetricsForJob(jobId: string, excludeExecutionId: string, metric: string): number | null {
    const rows = getDb()
      .select({ metricsSnapshot: executions.metricsSnapshot })
      .from(executions)
      .where(
        and(
          eq(executions.jobId, jobId),
          ne(executions.id, excludeExecutionId),
          isNotNull(executions.metricsSnapshot),
        ),
      )
      .orderBy(desc(executions.startedAt))
      .limit(20)
      .all();
    for (const r of rows) {
      if (r.metricsSnapshot && metric in r.metricsSnapshot) {
        return r.metricsSnapshot[metric];
      }
    }
    return null;
  },

  /** Recent execution statuses for a job (newest-first, omits outputHtml). */
  recentStatusesForJob(jobId: string, limit = 50): Execution["status"][] {
    return getDb()
      .select({ status: executions.status })
      .from(executions)
      .where(eq(executions.jobId, jobId))
      .orderBy(desc(executions.startedAt))
      .limit(limit)
      .all()
      .map((r) => r.status);
  },

  /**
   * Plan H5: runs left unfinished by a stopped process (endedAt still null) are
   * marked interrupted at boot. Delivery may or may not have happened, so it is
   * recorded as "unknown" and never retried automatically. Only runs that
   * started before `startedBefore` (this process's boot time) are touched, so
   * runs this process is executing are never affected.
   */
  reconcileInterrupted(startedBefore: string): Execution[] {
    const open = getDb()
      .select()
      .from(executions)
      .where(and(isNull(executions.endedAt), lt(executions.startedAt, startedBefore)))
      .all();
    const out: Execution[] = [];
    const endedAt = nowIso();
    for (const e of open) {
      const updated = getDb()
        .update(executions)
        .set({
          status: "interrupted",
          endedAt,
          deliveryStatus: "unknown",
          errorMessage: "Argus stopped while this run was in progress. It was not retried; check whether the email arrived before running it again.",
        })
        .where(and(eq(executions.id, e.id), isNull(executions.endedAt)))
        .returning()
        .get();
      if (updated) out.push(updated);
    }
    return out;
  },

  /** Most recent executions across all jobs (dashboard activity feed). */
  recent(limit = 100): Execution[] {
    return getDb().select().from(executions).orderBy(desc(executions.startedAt)).limit(limit).all();
  },
};

export const logsDao = {
  append(executionId: string, level: Log["level"], message: string): Log {
    const row: NewLog = {
      id: crypto.randomUUID(),
      executionId,
      level,
      message,
      timestamp: nowIso(),
    };
    return getDb().insert(logs).values(row).returning().get();
  },

  /** Insert many log rows in one statement (batched executor flush, AC-DB3). */
  appendMany(rows: NewLog[]): void {
    if (rows.length) getDb().insert(logs).values(rows).run();
  },

  forExecution(executionId: string): Log[] {
    return getDb()
      .select()
      .from(logs)
      .where(eq(logs.executionId, executionId))
      .orderBy(logs.timestamp)
      .all();
  },

  query(filters: { executionId?: string; level?: Log["level"]; from?: string; to?: string }): Log[] {
    const conds = [
      filters.executionId ? eq(logs.executionId, filters.executionId) : undefined,
      filters.level ? eq(logs.level, filters.level) : undefined,
      filters.from ? gte(logs.timestamp, filters.from) : undefined,
      filters.to ? lte(logs.timestamp, filters.to) : undefined,
    ].filter(Boolean);
    const where = conds.length ? and(...(conds as NonNullable<(typeof conds)[number]>[])) : undefined;
    return getDb().select().from(logs).where(where).orderBy(desc(logs.timestamp)).limit(500).all();
  },
};
