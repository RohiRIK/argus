import { getRawDb } from "../client";
import type { Log } from "../schema";
import { LOG_PAGE_MAX, type LogCursor } from "./executions";

/**
 * One console line from either source: report-job logs (`logs`) or automation-run
 * logs (`automation_logs`). Report lines carry `executionId`, automation lines `runId`.
 */
export interface ActivityLog {
  id: string;
  source: "report" | "automation";
  executionId: string | null;
  runId: string | null;
  level: Log["level"];
  message: string;
  timestamp: string;
}

export type LogSourceFilter = "all" | "report" | "automation";

export interface ActivityLogFilters {
  source?: LogSourceFilter;
  /** Report logs of this execution only (excludes automation logs unless `runId` is also set). */
  executionId?: string;
  /** Automation logs of this run only (excludes report logs unless `executionId` is also set). */
  runId?: string;
  level?: Log["level"];
  from?: string;
  to?: string;
}

type Param = string | number;

interface Branch {
  sql: string;
  params: Param[];
}

/** Per-table SELECT with its own WHERE, so each side can use its indexes. */
function branches(f: ActivityLogFilters, after: LogCursor | null): Branch[] {
  const source = f.source ?? "all";
  const narrowedToRun = f.runId !== undefined && f.executionId === undefined;
  const narrowedToExecution = f.executionId !== undefined && f.runId === undefined;
  const wantReport = (source === "all" || source === "report") && !narrowedToRun;
  const wantAutomation = (source === "all" || source === "automation") && !narrowedToExecution;

  const build = (table: string, parentCol: string, parentId: string | undefined, kind: ActivityLog["source"]): Branch => {
    const conds: string[] = [];
    const params: Param[] = [];
    if (parentId !== undefined) {
      conds.push(`${parentCol} = ?`);
      params.push(parentId);
    }
    if (f.level) {
      conds.push("level = ?");
      params.push(f.level);
    }
    if (f.from) {
      conds.push("timestamp >= ?");
      params.push(f.from);
    }
    if (f.to) {
      conds.push("timestamp <= ?");
      params.push(f.to);
    }
    if (after) {
      conds.push("(timestamp < ? OR (timestamp = ? AND id < ?))");
      params.push(after.timestamp, after.timestamp, after.id);
    }
    const execCol = kind === "report" ? "execution_id" : "NULL";
    const runCol = kind === "automation" ? "run_id" : "NULL";
    return {
      sql: `SELECT id, '${kind}' AS source, ${execCol} AS execution_id, ${runCol} AS run_id, level, message, timestamp
            FROM ${table}${conds.length ? ` WHERE ${conds.join(" AND ")}` : ""}`,
      params,
    };
  };

  const out: Branch[] = [];
  if (wantReport) out.push(build("logs", "execution_id", f.executionId, "report"));
  if (wantAutomation) out.push(build("automation_logs", "run_id", f.runId, "automation"));
  return out;
}

interface RawRow {
  id: string;
  source: ActivityLog["source"];
  execution_id: string | null;
  run_id: string | null;
  level: Log["level"];
  message: string;
  timestamp: string;
}

/**
 * Report and automation logs merged into one newest-first stream (Plan: one app).
 * Ordered by (timestamp DESC, id DESC) across both tables, with the same keyset
 * cursor as `logsDao.page()`, so pages never overlap or skip rows even when lines
 * from both sources share a timestamp. Ids are app-generated UUIDs, unique across
 * both tables, so (timestamp, id) is a total order.
 */
export const activityLogsDao = {
  page(
    filters: ActivityLogFilters,
    opts: { limit?: number; after?: LogCursor | null } = {},
  ): { rows: ActivityLog[]; hasMore: boolean; nextCursor: LogCursor | null } {
    const limit = Math.min(LOG_PAGE_MAX, Math.max(1, Math.floor(opts.limit ?? LOG_PAGE_MAX)));
    const parts = branches(filters, opts.after ?? null);
    if (parts.length === 0) return { rows: [], hasMore: false, nextCursor: null };
    const sql = `SELECT * FROM (${parts.map((p) => p.sql).join(" UNION ALL ")})
                 ORDER BY timestamp DESC, id DESC LIMIT ?`;
    // One extra row tells us whether another page exists without a second query.
    const fetched = getRawDb()
      .query(sql)
      .all(...parts.flatMap((p) => p.params), limit + 1) as RawRow[];
    const hasMore = fetched.length > limit;
    const rows = (hasMore ? fetched.slice(0, limit) : fetched).map(
      (r): ActivityLog => ({
        id: r.id,
        source: r.source,
        executionId: r.execution_id,
        runId: r.run_id,
        level: r.level,
        message: r.message,
        timestamp: r.timestamp,
      }),
    );
    const last = rows[rows.length - 1];
    return { rows, hasMore, nextCursor: hasMore && last ? { timestamp: last.timestamp, id: last.id } : null };
  },

  /** Real number of lines matching the filters across the selected sources. */
  count(filters: ActivityLogFilters): number {
    const parts = branches(filters, null);
    let total = 0;
    for (const p of parts) {
      const row = getRawDb()
        .query(`SELECT count(*) AS n FROM (${p.sql})`)
        .get(...p.params) as { n: number } | null;
      total += Number(row?.n ?? 0);
    }
    return total;
  },
};
