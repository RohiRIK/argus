import type { Execution, Job } from "@/db/schema";
import { alertIncidentsDao } from "@/db/dao/alert-incidents";
import { executionsDao } from "@/db/dao/executions";
import { settingsDao } from "@/db/dao/settings";
import { auditDao } from "@/db/dao/audit";
import { effectiveSender } from "@/services/graph/capabilities";
import { deliveryPreflight } from "@/services/job-readiness";
import { buildFailureAlertEmail, consecutiveFailures } from "./alerts";
import type { EmailTransport } from "./email";

/**
 * Failure-alert incidents (plan H7).
 *
 * - One incident per failure streak: opened when the streak reaches the
 *   threshold, closed on the next non-failed run. A long streak never
 *   re-alerts on every failure.
 * - Delivery attempts are recorded on the incident. A failed send is retried on
 *   later failures of the same streak with exponential backoff (5 min → 6 h).
 *   Only a send Graph accepted counts as "accepted".
 * - Cooldown: a new streak that starts within ALERT_COOLDOWN_MS of the last
 *   accepted alert for the same job is recorded but not emailed (flapping jobs).
 */
export const ALERT_COOLDOWN_MS = 60 * 60_000;
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export interface IncidentDeps {
  email: EmailTransport;
  now?: () => Date;
  canSendEmail?: boolean;
}

export type IncidentOutcome =
  | { action: "none" }
  | { action: "opened" | "retried"; notify: "accepted" | "failed" | "suppressed" | "pending" };

/** Call after a run finalizes as failed. */
export async function onRunFailed(job: Job, failed: Execution, deps: IncidentDeps): Promise<IncidentOutcome> {
  const settings = settingsDao.get();
  const threshold = settings.alertThreshold;
  if (threshold <= 0 || settings.adminContacts.length === 0) return { action: "none" };

  const now = (deps.now ?? (() => new Date()))();
  const streak = consecutiveFailures(executionsDao.recentStatusesForJob(job.id, 50));
  let incident = alertIncidentsDao.openForJob(job.id);

  if (!incident) {
    if (streak < threshold) return { action: "none" };
    incident = alertIncidentsDao.open({
      jobId: job.id,
      failureCount: streak,
      lastExecutionId: failed.id,
      openedAt: now.toISOString(),
    });
    const last = alertIncidentsDao.lastNotified(job.id);
    if (last?.lastAttemptAt && now.getTime() - new Date(last.lastAttemptAt).getTime() < ALERT_COOLDOWN_MS) {
      alertIncidentsDao.update(incident.id, { notifyStatus: "suppressed", suppressionReason: "cooldown: alerted for this job within the last hour" });
      return { action: "opened", notify: "suppressed" };
    }
    return { action: "opened", notify: await attempt(job, incident.id, streak, failed, deps, now, 0) };
  }

  alertIncidentsDao.update(incident.id, { failureCount: streak, lastExecutionId: failed.id });
  const due = incident.nextAttemptAt ? now.getTime() >= new Date(incident.nextAttemptAt).getTime() : true;
  if ((incident.notifyStatus === "failed" || incident.notifyStatus === "pending") && due) {
    return { action: "retried", notify: await attempt(job, incident.id, streak, failed, deps, now, incident.notifyAttempts) };
  }
  return { action: "none" };
}

/** Call after a run finalizes with any non-failed status: the streak is over. */
export function onRunRecovered(jobId: string, now: Date = new Date()): boolean {
  const closed = alertIncidentsDao.close(jobId, now.toISOString());
  if (closed) {
    try {
      auditDao.record({ action: "alert.incident_closed", outcome: "success", detail: { jobId, incidentId: closed.id } });
    } catch {
      /* best effort */
    }
  }
  return Boolean(closed);
}

async function attempt(
  job: Job,
  incidentId: string,
  streak: number,
  failed: Execution,
  deps: IncidentDeps,
  now: Date,
  priorAttempts: number,
): Promise<"accepted" | "failed" | "pending"> {
  const settings = settingsDao.get();
  const canSend = deps.canSendEmail ?? deliveryPreflight(settings).canDeliver;
  if (!canSend) {
    alertIncidentsDao.update(incidentId, {
      notifyStatus: "pending",
      lastError: "delivery not ready (Mail.Send or sender missing)",
    });
    return "pending";
  }
  const attempts = priorAttempts + 1;
  try {
    await deps.email.send(
      buildFailureAlertEmail({
        jobName: job.name,
        consecutiveFailures: streak,
        errorMessage: failed.errorMessage,
        recipients: settings.adminContacts,
        from: effectiveSender(settings).address ?? "",
        replyTo: settings.replyTo ?? undefined,
      }),
    );
    alertIncidentsDao.update(incidentId, {
      notifyStatus: "accepted",
      notifyAttempts: attempts,
      lastAttemptAt: now.toISOString(),
      nextAttemptAt: null,
      lastError: null,
    });
    return "accepted";
  } catch (err) {
    alertIncidentsDao.update(incidentId, {
      notifyStatus: "failed",
      notifyAttempts: attempts,
      lastAttemptAt: now.toISOString(),
      nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)).toISOString(),
      lastError: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}
