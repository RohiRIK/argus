import { eq, desc, and, gte, lte } from "drizzle-orm";
import { getDb } from "../client";
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
