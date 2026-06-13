import cron, { type ScheduledTask } from "node-cron";
import { SCHEDULE_PRESETS, isValidCron } from "@/lib/cron";
import { jobsDao } from "@/db/dao/jobs";
import { runJob } from "@/services/executor";
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

/** Start cron tasks for all active jobs. Idempotent (safe under HMR). */
export function startScheduler(): { scheduled: number; skipped: number } {
  if (state.started) return { scheduled: state.tasks.size, skipped: 0 };
  state.started = true;

  let scheduled = 0;
  let skipped = 0;
  for (const job of jobsDao.active()) {
    const expr = resolveCron(job);
    if (!expr) {
      skipped++;
      continue;
    }
    const task = cron.schedule(expr, () => {
      void runJob(job).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[argus] scheduled run failed for ${job.id}:`, err);
      });
    });
    state.tasks.set(job.id, task);
    scheduled++;
  }
  return { scheduled, skipped };
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
