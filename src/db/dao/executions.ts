import { eq, desc, and, gte, lte } from "drizzle-orm";
import { getDb } from "../client";
import {
  executions,
  logs,
  type Execution,
  type NewExecution,
  type Log,
  type NewLog,
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
