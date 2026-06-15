import cron, { type ScheduledTask } from "node-cron";
import { SCHEDULE_PRESETS, isValidCron } from "@/lib/cron";
import { jobsDao } from "@/db/dao/jobs";
import { settingsDao } from "@/db/dao/settings";
import { enqueueRun } from "@/services/run-queue";
import { isSnoozed } from "@/lib/snooze";
import type { Job } from "@/db/schema";

/** Resolve a job's effective cron expression, or null if invalid/missing. */
export function resolveCron(job: Job): string | null {
  if (job.scheduleType === "preset") {
    return job.schedulePreset ? (SCHEDULE_PRESETS[job.schedulePreset] ?? null) : null;
  }
  return job.cronExpression && isValidCron(job.cronExpression) ? job.cronExpression : null;
}

// Process-global guard so HMR / repeated imports don't start duplicate loops.
const globalKey = "__argusScheduler" as const;
interface SchedulerState {
  started: boolean;
  tasks: Map<string, ScheduledTask>;
}
const g = globalThis as unknown as { [globalKey]?: SchedulerState };
const state: SchedulerState = (g[globalKey] ??= { started: false, tasks: new Map() });

/**
 * Schedule a cron task for one job. The fired callback re-fetches the job by id
 * so edits made after scheduling take effect WITHOUT a restart (AC-S1), and runs
 * it through the bounded queue (AC-S3). A job that has been deleted or disabled
 * removes its own task on the next fire.
 */
function scheduleTask(job: Job): boolean {
  const expr = resolveCron(job);
  if (!expr) return false;
  const id = job.id;
  const timezone = settingsDao.get().timezone || "UTC";
  const task = cron.schedule(expr, () => {
    const fresh = jobsDao.findById(id);
    if (!fresh || fresh.status !== "active") {
      removeJob(id);
      return;
    }
    // Snoozed jobs stay scheduled but skip fires until the wake instant passes (auto-resume).
    if (isSnoozed(fresh.snoozedUntil)) {
      // eslint-disable-next-line no-console
      console.warn(`[argus] scheduled run skipped for ${id}: snoozed until ${fresh.snoozedUntil}`);
      return;
    }
    void enqueueRun(fresh)
      .then((r) => {
        if (!r.ran) {
          // eslint-disable-next-line no-console
          console.warn(`[argus] scheduled run skipped for ${id}: ${r.reason}`);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[argus] scheduled run failed for ${id}:`, err);
      });
  }, { timezone });
  state.tasks.set(id, task);
  return true;
}

/**
 * Add or replace the scheduled task for a job (call after create/update via the
 * API, AC-S2). Removes any existing task first, then schedules the current row
 * if it is active and has a valid schedule.
 */
export function addOrReplaceJob(id: string): boolean {
  removeJob(id);
  const job = jobsDao.findById(id);
  if (!job || job.status !== "active") return false;
  return scheduleTask(job);
}

/** Stop and forget a job's task (call after delete/disable, AC-S2). */
export function removeJob(id: string): void {
  const task = state.tasks.get(id);
  if (task) {
    task.stop();
    state.tasks.delete(id);
  }
}

/** Start cron tasks for all active jobs. Idempotent (safe under HMR). */
export function startScheduler(): { scheduled: number; skipped: number } {
  if (state.started) return { scheduled: state.tasks.size, skipped: 0 };
  state.started = true;

  let scheduled = 0;
  let skipped = 0;
  for (const job of jobsDao.active()) {
    if (scheduleTask(job)) scheduled++;
    else skipped++;
  }
  return { scheduled, skipped };
}

/** Re-register every active job's task — call after a timezone change (ST-4). */
export function rescheduleAll(): { scheduled: number } {
  for (const task of state.tasks.values()) task.stop();
  state.tasks.clear();
  let scheduled = 0;
  for (const job of jobsDao.active()) if (scheduleTask(job)) scheduled++;
  state.started = true;
  return { scheduled };
}

/** Stop all scheduled tasks and reset the guard (shutdown / tests). */
export function stopScheduler(): void {
  for (const task of state.tasks.values()) task.stop();
  state.tasks.clear();
  state.started = false;
}

export function isSchedulerStarted(): boolean {
  return state.started;
}

/** Ids of jobs with a live scheduled task (observability / tests). */
export function scheduledJobIds(): string[] {
  return [...state.tasks.keys()];
}

/**
 * Start the scheduler once, on demand. Called from nodejs-only route handlers
 * (e.g. /api/health) so it boots shortly after the server starts traffic —
 * without an instrumentation hook, which Next compiles for the Edge runtime
 * too (where node-cron's node: builtins can't resolve).
 */
export function ensureSchedulerStarted(): void {
  if (state.started) return;
  try {
    startScheduler();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[argus] scheduler failed to start:", err);
  }
}
