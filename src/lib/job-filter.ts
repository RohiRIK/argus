/**
 * Pure dashboard filtering: free-text search by job name plus lifecycle,
 * last-outcome, report-type, and tag filters. DOM-free so it can be unit-tested directly.
 */

import { isSnoozed } from "./snooze";

export interface FilterableJob {
  name: string;
  reportType: string;
  status: "active" | "disabled";
  tags: string[];
  lastRun: { status: string } | null;
  snoozedUntil?: string | null;
}

export interface JobFilter {
  query: string;
  /** Legacy combined filter: "all" | displayStatus value. */
  status: string;
  reportType: string; // "all" | a reportType
  tags: string[];
  /** "all" | JobLifecycle. */
  lifecycle?: string;
  /** "all" | LastOutcome. */
  outcome?: string;
}

export const ALL = "all";

/** What the job will do next — independent of how its last run went (H8). */
export type JobLifecycle = "active" | "paused" | "snoozed";

/**
 * How the most recent run ended, or "never" when it has not run yet. `drift` and
 * `halted` come from automation runs (drift_detected / circuit breaker halted);
 * `interrupted` means Argus stopped mid-run (report executions and automation runs).
 */
export type LastOutcome =
  | "success"
  | "warning"
  | "failed"
  | "suppressed"
  | "drift"
  | "halted"
  | "interrupted"
  | "never";

const OUTCOMES: ReadonlySet<string> = new Set(["success", "warning", "failed", "suppressed", "drift", "halted", "interrupted"]);

export function jobLifecycle(job: Pick<FilterableJob, "status" | "snoozedUntil">, now: Date = new Date()): JobLifecycle {
  if (job.status === "disabled") return "paused";
  return isSnoozed(job.snoozedUntil, now) ? "snoozed" : "active";
}

export function lastOutcome(job: Pick<FilterableJob, "lastRun">): LastOutcome {
  const s = job.lastRun?.status;
  return s !== undefined && OUTCOMES.has(s) ? (s as LastOutcome) : "never";
}

/**
 * Legacy single-value status: disabled jobs read "disabled", otherwise the last
 * run's status (or "disabled" when a job has never run). Prefer `jobLifecycle` +
 * `lastOutcome`, which keep the two concerns apart.
 */
export function displayStatus(job: FilterableJob): string {
  if (job.status === "disabled") return "disabled";
  return job.lastRun?.status ?? "disabled";
}

export function filterJobs<T extends FilterableJob>(jobs: T[], f: JobFilter, now: Date = new Date()): T[] {
  const q = f.query.trim().toLowerCase();
  return jobs.filter((j) => {
    if (q && !j.name.toLowerCase().includes(q)) return false;
    if (f.status !== ALL && displayStatus(j) !== f.status) return false;
    if (f.lifecycle && f.lifecycle !== ALL && jobLifecycle(j, now) !== f.lifecycle) return false;
    if (f.outcome && f.outcome !== ALL && lastOutcome(j) !== f.outcome) return false;
    if (f.reportType !== ALL && j.reportType !== f.reportType) return false;
    if (f.tags.length > 0 && !f.tags.every((t) => j.tags.includes(t))) return false;
    return true;
  });
}
