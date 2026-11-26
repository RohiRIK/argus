import { getRawDb } from "../client";
import type { Log } from "../schema";
import { LOG_PAGE_MAX, type LogCursor } from "./executions";

/**
 * One line in the unified activity log: a report-job log (`logs`), an automation-run
 * log (`automation_logs`), or a platform event from the `audit` table (sign-ins,
 * alert incidents, permission grants, deploys). Report lines carry `executionId`,
 * automation lines `runId`, events neither.
 */
export interface ActivityLog {
  id: string;
  source: "report" | "automation" | "event";
  executionId: string | null;
  runId: string | null;
  level: Log["level"];
  message: string;
  timestamp: string;
}

export type LogSourceFilter = "all" | ActivityLog["source"];

export interface ActivityLogFilters {
  source?: LogSourceFilter;
  /** Report logs of this execution only (excludes other sources unless `runId` is also set). */
  executionId?: string;
  /** Automation logs of this run only (excludes other sources unless `executionId` is also set). */
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

/** Audit outcome ↔ log level, so the level filter and badge work for events too. */
const OUTCOME_FOR_LEVEL: Record<Log["level"], string> = { info: "success", warning: "partial", error: "error" };

/** Per-table SELECT with its own WHERE, so each side can use its indexes. */
function branches(f: ActivityLogFilters, after: LogCursor | null): Branch[] {
  const source = f.source ?? "all";
  const narrowedToRun = f.runId !== undefined && f.executionId === undefined;
  const narrowedToExecution = f.executionId !== undefined && f.runId === undefined;
  const narrowed = f.runId !== undefined || f.executionId !== undefined;
  const wantReport = (source === "all" || source === "report") && !narrowedToRun;
  const wantAutomation = (source === "all" || source === "automation") && !narrowedToExecution;
  const wantEvent = (source === "all" || source === "event") && !narrowed;

  const where = (tsCol: string, levelCond: [string, Param] | null, parent: [string, string] | null) => {
    const conds: string[] = [];
    const params: Param[] = [];
    if (parent) {
      conds.push(`${parent[0]} = ?`);
      params.push(parent[1]);
    }
    if (levelCond) {
      conds.push(levelCond[0]);
      params.push(levelCond[1]);
    }
    if (f.from) {
      conds.push(`${tsCol} >= ?`);
      params.push(f.from);
    }
    if (f.to) {
      conds.push(`${tsCol} <= ?`);
      params.push(f.to);
    }
    if (after) {
      conds.push(`(${tsCol} < ? OR (${tsCol} = ? AND id < ?))`);
      params.push(after.timestamp, after.timestamp, after.id);
    }
    return { clause: conds.length ? ` WHERE ${conds.join(" AND ")}` : "", params };
  };

  const logBranch = (table: string, parentCol: string, parentId: string | undefined, kind: "report" | "automation"): Branch => {
    const w = where("timestamp", f.level ? ["level = ?", f.level] : null, parentId !== undefined ? [parentCol, parentId] : null);
    const execCol = kind === "report" ? "execution_id" : "NULL";
    const runCol = kind === "automation" ? "run_id" : "NULL";
    return {
      sql: `SELECT id, '${kind}' AS source, ${execCol} AS execution_id, ${runCol} AS run_id, level, message,
                   NULL AS provider, NULL AS detail, timestamp
            FROM ${table}${w.clause}`,
      params: w.params,
    };
  };

  const eventBranch = (): Branch => {
    const w = where("created_at", f.level ? ["outcome = ?", OUTCOME_FOR_LEVEL[f.level]] : null, null);
    return {
      sql: `SELECT id, 'event' AS source, NULL AS execution_id, NULL AS run_id,
                   CASE outcome WHEN 'error' THEN 'error' WHEN 'partial' THEN 'warning' ELSE 'info' END AS level,
                   action AS message, provider, detail, created_at AS timestamp
            FROM audit${w.clause}`,
      params: w.params,
    };
  };

  const out: Branch[] = [];
  if (wantReport) out.push(logBranch("logs", "execution_id", f.executionId, "report"));
  if (wantAutomation) out.push(logBranch("automation_logs", "run_id", f.runId, "automation"));
  if (wantEvent) out.push(eventBranch());
  return out;
}

interface RawRow {
  id: string;
  source: ActivityLog["source"];
  execution_id: string | null;
  run_id: string | null;
  level: Log["level"];
  message: string;
  provider: string | null;
  detail: string | null;
  timestamp: string;
}

const EVENT_LABEL: Record<string, string> = {
  "auth.login": "Sign-in",
  bootstrap: "Admin account created",
  permission_grant: "Permissions granted",
  automation_permission_grant: "Automation permissions granted",
  admin_authorize: "Admin consent",
  automation_enforce_run: "Automation enforce run",
  automation_action_rollback: "Automation change rolled back",
  mailbox_select: "Sender mailbox selected",
  mailbox_verify: "Sender mailbox verified",
  mailbox_test_send: "Test email sent",
  "alert.incident_closed": "Failure alert resolved",
  "user.create": "User added",
  "user.invite": "User invited",
  "user.invite_resent": "Invitation resent",
  "user.invite_accepted": "Invitation accepted",
  "user.delete": "User removed",
  "user.disable": "User disabled",
  "user.enable": "User enabled",
  "user.role_change": "Role changed",
  "user.password_reset": "Password reset",
};

/** "permission_grant" → "Permission grant" for actions without a label. */
function humanize(action: string): string {
  const s = action.replace(/[._]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : action;
}

/**
 * Readable one-liner for an audit event. Only whitelisted, non-secret detail keys are
 * shown (username, acting user, role change, sign-in method); the rest of `detail`
 * never leaves the DB.
 */
export function formatEvent(action: string, level: Log["level"], provider: string | null, detail: string | null): string {
  let label = EVENT_LABEL[action] ?? humanize(action);
  if (action === "auth.login") label = level === "error" ? "Sign-in failed" : "Signed in";
  else if (level === "error") label += " failed";
  else if (level === "warning") label += " (partial)";
  let d: Record<string, unknown> = {};
  try {
    d = detail ? (JSON.parse(detail) as Record<string, unknown>) : {};
  } catch {
    /* malformed detail: show the label only */
  }
  const str = (k: string) => (typeof d[k] === "string" && d[k] ? (d[k] as string) : "");
  const who = str("username");
  const actor = str("actor");
  const change = str("from") && str("to") ? ` (${str("from")} → ${str("to")})` : str("role") ? ` as ${str("role")}` : "";
  const via = str("method") === "microsoft" ? " with Microsoft" : "";
  return [
    label,
    via,
    who && `: ${who}`,
    change,
    actor && actor !== who && ` by ${actor}`,
    provider && ` · ${provider}`,
  ]
    .filter(Boolean)
    .join("");
}

/**
 * Report logs, automation logs and audit events merged into one newest-first stream.
 * Ordered by (timestamp DESC, id DESC) across all tables, with the same keyset
 * cursor as `logsDao.page()`, so pages never overlap or skip rows even when lines
 * from several sources share a timestamp. Ids are app-generated UUIDs, unique across
 * the tables, so (timestamp, id) is a total order.
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
        message: r.source === "event" ? formatEvent(r.message, r.level, r.provider, r.detail) : r.message,
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
