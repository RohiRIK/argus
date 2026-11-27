import { getRawDb } from "../client";
import type { LogCursor } from "./executions";

export const RUN_PAGE_MAX = 200;

/**
 * One run in the unified activity list: a report execution or an automation run.
 * `records` is rows processed (reports) or targets evaluated (automations);
 * `changes` is applied (enforce/rollback) or planned (audit) changes — null for reports.
 */
export interface ActivityRun {
  id: string;
  source: "report" | "automation";
  parentId: string;
  name: string;
  status: string;
  trigger: string | null;
  mode: "audit" | "enforce" | "rollback" | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  records: number;
  changes: number | null;
  errorMessage: string | null;
}

export type RunSourceFilter = "all" | ActivityRun["source"];

/** Status buckets shared by both sources, so one filter works across them. */
export type RunOutcomeFilter = "all" | "ok" | "attention" | "failed";

export interface ActivityRunFilters {
  source?: RunSourceFilter;
  outcome?: RunOutcomeFilter;
  from?: string;
  to?: string;
}

const OUTCOME_STATUSES: Record<Exclude<RunOutcomeFilter, "all">, string[]> = {
  ok: ["success"],
  attention: ["warning", "drift_detected", "suppressed", "halted"],
  failed: ["failed", "interrupted"],
};

type Param = string | number;

interface Branch {
  sql: string;
  params: Param[];
}

function branches(f: ActivityRunFilters, after: LogCursor | null): Branch[] {
  const source = f.source ?? "all";
  const statuses = f.outcome && f.outcome !== "all" ? OUTCOME_STATUSES[f.outcome] : null;

  const where = (alias: string) => {
    const conds: string[] = [];
    const params: Param[] = [];
    if (statuses) {
      conds.push(`${alias}.status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    if (f.from) {
      conds.push(`${alias}.started_at >= ?`);
      params.push(f.from);
    }
    if (f.to) {
      conds.push(`${alias}.started_at <= ?`);
      params.push(f.to);
    }
    if (after) {
      conds.push(`(${alias}.started_at < ? OR (${alias}.started_at = ? AND ${alias}.id < ?))`);
      params.push(after.timestamp, after.timestamp, after.id);
    }
    return { clause: conds.length ? ` WHERE ${conds.join(" AND ")}` : "", params };
  };

  const out: Branch[] = [];
  if (source === "all" || source === "report") {
    const w = where("e");
    out.push({
      sql: `SELECT e.id, 'report' AS source, e.job_id AS parent_id, COALESCE(j.name, 'Deleted job') AS name,
                   e.status, e.trigger, NULL AS mode, e.started_at, e.ended_at,
                   e.records_processed AS records, NULL AS changes, e.error_message
            FROM executions e LEFT JOIN jobs j ON j.id = e.job_id${w.clause}`,
      params: w.params,
    });
  }
  if (source === "all" || source === "automation") {
    const w = where("r");
    out.push({
      sql: `SELECT r.id, 'automation' AS source, r.policy_id AS parent_id, COALESCE(p.name, 'Deleted policy') AS name,
                   r.status, r.trigger, r.mode, r.started_at, r.ended_at,
                   r.evaluated_count AS records,
                   CASE WHEN r.mode = 'audit' THEN r.planned_count ELSE r.applied_count END AS changes,
                   r.error_message
            FROM automation_runs r LEFT JOIN automation_policies p ON p.id = r.policy_id${w.clause}`,
      params: w.params,
    });
  }
  return out;
}

interface RawRun {
  id: string;
  source: ActivityRun["source"];
  parent_id: string;
  name: string;
  status: string;
  trigger: string | null;
  mode: ActivityRun["mode"];
  started_at: string;
  ended_at: string | null;
  records: number | null;
  changes: number | null;
  error_message: string | null;
}

function toRun(r: RawRun): ActivityRun {
  const start = Date.parse(r.started_at);
  const end = r.ended_at ? Date.parse(r.ended_at) : NaN;
  return {
    id: r.id,
    source: r.source,
    parentId: r.parent_id,
    name: r.name,
    status: r.status,
    trigger: r.trigger,
    mode: r.mode,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null,
    records: Number(r.records ?? 0),
    changes: r.changes === null ? null : Number(r.changes),
    errorMessage: r.error_message,
  };
}

/**
 * Report executions and automation runs merged into one newest-first list,
 * keyset-paginated on (started_at DESC, id DESC) like the activity log.
 */
export const activityRunsDao = {
  page(
    filters: ActivityRunFilters,
    opts: { limit?: number; after?: LogCursor | null } = {},
  ): { rows: ActivityRun[]; hasMore: boolean; nextCursor: LogCursor | null } {
    const limit = Math.min(RUN_PAGE_MAX, Math.max(1, Math.floor(opts.limit ?? 50)));
    const parts = branches(filters, opts.after ?? null);
    if (parts.length === 0) return { rows: [], hasMore: false, nextCursor: null };
    const sql = `SELECT * FROM (${parts.map((p) => p.sql).join(" UNION ALL ")})
                 ORDER BY started_at DESC, id DESC LIMIT ?`;
    const fetched = getRawDb()
      .query(sql)
      .all(...parts.flatMap((p) => p.params), limit + 1) as RawRun[];
    const hasMore = fetched.length > limit;
    const rows = (hasMore ? fetched.slice(0, limit) : fetched).map(toRun);
    const last = rows[rows.length - 1];
    return { rows, hasMore, nextCursor: hasMore && last ? { timestamp: last.startedAt, id: last.id } : null };
  },

  count(filters: ActivityRunFilters): number {
    let total = 0;
    for (const p of branches(filters, null)) {
      const row = getRawDb().query(`SELECT count(*) AS n FROM (${p.sql})`).get(...p.params) as { n: number } | null;
      total += Number(row?.n ?? 0);
    }
    return total;
  },
};
