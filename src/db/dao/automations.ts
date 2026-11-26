import { eq, desc, inArray } from "drizzle-orm";
import { getDb, getRawDb } from "../client";
import {
  automationPolicies,
  automationRuns,
  automationActions,
  automationLogs,
  type AutomationPolicy,
  type NewAutomationPolicy,
  type AutomationRun,
  type NewAutomationRun,
  type AutomationAction,
  type NewAutomationAction,
  type AutomationLog,
  type NewAutomationLog,
} from "../schema";

export type AutomationRunSummary = Omit<AutomationRun, "outputHtml">;

const RUN_SUMMARY_COLUMNS = {
  id: automationRuns.id,
  policyId: automationRuns.policyId,
  mode: automationRuns.mode,
  trigger: automationRuns.trigger,
  status: automationRuns.status,
  startedAt: automationRuns.startedAt,
  endedAt: automationRuns.endedAt,
  evaluatedCount: automationRuns.evaluatedCount,
  plannedCount: automationRuns.plannedCount,
  appliedCount: automationRuns.appliedCount,
  failedCount: automationRuns.failedCount,
  graphApiLatencyMs: automationRuns.graphApiLatencyMs,
  errorMessage: automationRuns.errorMessage,
  summaryText: automationRuns.summaryText,
  emailSent: automationRuns.emailSent,
  emailRecipients: automationRuns.emailRecipients,
  webhookDelivered: automationRuns.webhookDelivered,
  webhookError: automationRuns.webhookError,
  createdAt: automationRuns.createdAt,
};

const nowIso = () => new Date().toISOString();

export const automationPoliciesDao = {
  findAll(): AutomationPolicy[] {
    return getDb().select().from(automationPolicies).orderBy(desc(automationPolicies.createdAt)).all();
  },

  findById(id: string): AutomationPolicy | undefined {
    return getDb().select().from(automationPolicies).where(eq(automationPolicies.id, id)).get();
  },

  findByType(automationType: string): AutomationPolicy[] {
    return getDb()
      .select()
      .from(automationPolicies)
      .where(eq(automationPolicies.automationType, automationType))
      .orderBy(desc(automationPolicies.createdAt))
      .all();
  },

  create(
    input: Omit<NewAutomationPolicy, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): AutomationPolicy {
    const row: NewAutomationPolicy = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return getDb().insert(automationPolicies).values(row).returning().get();
  },

  update(
    id: string,
    patch: Partial<Omit<NewAutomationPolicy, "id" | "createdAt">>,
  ): AutomationPolicy | undefined {
    return getDb()
      .update(automationPolicies)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(automationPolicies.id, id))
      .returning()
      .get();
  },

  delete(id: string): void {
    getDb().delete(automationPolicies).where(eq(automationPolicies.id, id)).run();
  },

  active(): AutomationPolicy[] {
    return getDb().select().from(automationPolicies).where(eq(automationPolicies.status, "active")).all();
  },

  snooze(id: string, untilIso: string): AutomationPolicy | undefined {
    return this.update(id, { snoozedUntil: untilIso });
  },

  unsnooze(id: string): AutomationPolicy | undefined {
    return this.update(id, { snoozedUntil: null });
  },
};

export const automationRunsDao = {
  create(input: Omit<NewAutomationRun, "id" | "createdAt"> & { id?: string }): AutomationRun {
    const row: NewAutomationRun = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: nowIso(),
    };
    return getDb().insert(automationRuns).values(row).returning().get();
  },

  update(id: string, patch: Partial<NewAutomationRun>): AutomationRun | undefined {
    return getDb().update(automationRuns).set(patch).where(eq(automationRuns.id, id)).returning().get();
  },

  /**
   * Atomically persist run logs, per-target pre/post JSON snapshots, and terminal
   * run state in a single SQLite WAL transaction.
   */
  finalize(
    id: string,
    patch: Partial<NewAutomationRun>,
    logRows: NewAutomationLog[],
    actionRows: NewAutomationAction[] = [],
  ): AutomationRun | undefined {
    return getDb().transaction((tx) => {
      if (logRows.length) tx.insert(automationLogs).values(logRows).run();
      if (actionRows.length) tx.insert(automationActions).values(actionRows).run();
      return tx.update(automationRuns).set(patch).where(eq(automationRuns.id, id)).returning().get();
    });
  },

  findById(id: string): AutomationRun | undefined {
    return getDb().select().from(automationRuns).where(eq(automationRuns.id, id)).get();
  },

  forPolicy(policyId: string, limit = 50): AutomationRunSummary[] {
    return getDb()
      .select(RUN_SUMMARY_COLUMNS)
      .from(automationRuns)
      .where(eq(automationRuns.policyId, policyId))
      .orderBy(desc(automationRuns.startedAt))
      .limit(limit)
      .all();
  },

  latestByPolicyIds(policyIds: string[]): Map<string, AutomationRunSummary> {
    const out = new Map<string, AutomationRunSummary>();
    if (policyIds.length === 0) return out;
    const placeholders = policyIds.map(() => "?").join(", ");
    const latestIds = getRawDb()
      .query(
        `SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY policy_id ORDER BY started_at DESC) AS rn
          FROM automation_runs
          WHERE policy_id IN (${placeholders})
        ) WHERE rn = 1`,
      )
      .all(...policyIds) as Array<{ id: string }>;
    if (latestIds.length === 0) return out;
    const rows = getDb()
      .select(RUN_SUMMARY_COLUMNS)
      .from(automationRuns)
      .where(inArray(automationRuns.id, latestIds.map((r) => r.id)))
      .all();
    for (const row of rows) out.set(row.policyId, row);
    return out;
  },

  /** Recent run status summaries per policy id, newest first (dashboard rows; avoids N+1). */
  recentStatusesByPolicyIds(
    policyIds: string[],
    perPolicyLimit = 20,
  ): Map<string, Array<{ id: string; status: AutomationRun["status"]; startedAt: string }>> {
    const out = new Map<string, Array<{ id: string; status: AutomationRun["status"]; startedAt: string }>>();
    if (policyIds.length === 0) return out;
    const placeholders = policyIds.map(() => "?").join(", ");
    const rows = getRawDb()
      .query(
        `SELECT id, policy_id, status, started_at FROM (
          SELECT id, policy_id, status, started_at,
                 ROW_NUMBER() OVER (PARTITION BY policy_id ORDER BY started_at DESC, id DESC) AS rn
          FROM automation_runs
          WHERE policy_id IN (${placeholders})
        ) WHERE rn <= ?
        ORDER BY policy_id, started_at DESC, id DESC`,
      )
      .all(...policyIds, perPolicyLimit) as Array<{
      id: string;
      policy_id: string;
      status: AutomationRun["status"];
      started_at: string;
    }>;
    for (const r of rows) {
      let arr = out.get(r.policy_id);
      if (!arr) {
        arr = [];
        out.set(r.policy_id, arr);
      }
      arr.push({ id: r.id, status: r.status, startedAt: r.started_at });
    }
    return out;
  },

  recent(limit = 50): AutomationRunSummary[] {
    return getDb()
      .select(RUN_SUMMARY_COLUMNS)
      .from(automationRuns)
      .orderBy(desc(automationRuns.startedAt))
      .limit(limit)
      .all();
  },
};

export const automationActionsDao = {
  forRun(runId: string): AutomationAction[] {
    return getDb()
      .select()
      .from(automationActions)
      .where(eq(automationActions.runId, runId))
      .orderBy(automationActions.createdAt)
      .all();
  },

  findById(id: string): AutomationAction | undefined {
    return getDb().select().from(automationActions).where(eq(automationActions.id, id)).get();
  },

  updateStatus(
    id: string,
    status: AutomationAction["status"],
    patch: Partial<Pick<AutomationAction, "afterState" | "errorMessage">> = {},
  ): AutomationAction | undefined {
    return getDb()
      .update(automationActions)
      .set({ status, ...patch })
      .where(eq(automationActions.id, id))
      .returning()
      .get();
  },
};

export const automationLogsDao = {
  append(runId: string, level: AutomationLog["level"], message: string): AutomationLog {
    const row: NewAutomationLog = {
      id: crypto.randomUUID(),
      runId,
      level,
      message,
      timestamp: nowIso(),
    };
    return getDb().insert(automationLogs).values(row).returning().get();
  },

  forRun(runId: string): AutomationLog[] {
    return getDb()
      .select()
      .from(automationLogs)
      .where(eq(automationLogs.runId, runId))
      .orderBy(automationLogs.timestamp)
      .all();
  },
};
