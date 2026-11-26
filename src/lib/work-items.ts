/**
 * Unified "work item" model: report jobs and automation policies rendered as one
 * list on the dashboard (same columns, filters and counters). Pure and DOM-free so
 * the mapping can be unit-tested directly; the dashboard page builds these on the
 * server and the client only filters and renders them.
 */

import { filterJobs, ALL, type JobFilter, type LastOutcome } from "./job-filter";

export type WorkItemKind = "report" | "automation";
export type AutomationMode = "audit" | "enforce";
export type AutomationRunStatus = "success" | "drift_detected" | "warning" | "failed" | "halted" | "interrupted";

/** One dashboard row: a report job or an automation policy. */
export interface WorkItem {
  id: string;
  kind: WorkItemKind;
  /** Automation policies only: the mode the policy runs in. */
  mode: AutomationMode | null;
  name: string;
  description: string;
  /** Report type id for jobs, catalog automation name for policies. */
  reportType: string;
  status: "active" | "disabled";
  tags: string[];
  scheduleSummary: string;
  nextRun: string;
  nextRunAt: string | null;
  /** `status` uses the shared outcome vocabulary (see `automationRunOutcome`). */
  lastRun: { id: string; status: string; startedAt: string } | null;
  /** Newest-first outcome statuses (same vocabulary), up to 20. */
  recent: string[];
  snoozedUntil: string | null;
  /** Where the latest run's details live, or null when it has never run. */
  lastRunHref: string | null;
  /** Where the item itself is edited/managed. */
  manageHref: string;
}

/** Map an automation run status onto the dashboard's outcome vocabulary. */
export function automationRunOutcome(status: string): LastOutcome {
  switch (status) {
    case "success":
      return "success";
    case "drift_detected":
      return "drift";
    case "warning":
      return "warning";
    case "failed":
      return "failed";
    case "halted":
      return "halted";
    case "interrupted":
      return "interrupted";
    default:
      return "never";
  }
}

export function executionHref(executionId: string): string {
  return `/executions/${encodeURIComponent(executionId)}`;
}

export function automationRunHref(runId: string): string {
  return `/automations/runs/${encodeURIComponent(runId)}`;
}

export const KIND_LABEL: Record<WorkItemKind, string> = { report: "Report", automation: "Automation" };
export const MODE_LABEL: Record<AutomationMode, string> = { audit: "Audit", enforce: "Enforce" };

interface ScheduleInfo {
  scheduleSummary: string;
  nextRun: string;
  nextRunAt: string | null;
}

export interface ReportJobInput {
  id: string;
  name: string;
  description: string;
  reportType: string;
  status: "active" | "disabled";
  tags: string[] | null;
  snoozedUntil: string | null;
}

/** Build the row for a report job from its recent executions (newest first). */
export function reportWorkItem(
  job: ReportJobInput,
  history: Array<{ id: string; status: string; startedAt: string }>,
  schedule: ScheduleInfo,
): WorkItem {
  const last = history[0];
  return {
    id: job.id,
    kind: "report",
    mode: null,
    name: job.name,
    description: job.description,
    reportType: job.reportType,
    status: job.status,
    tags: job.tags ?? [],
    ...schedule,
    lastRun: last ? { id: last.id, status: last.status, startedAt: last.startedAt } : null,
    recent: history.map((e) => e.status),
    snoozedUntil: job.snoozedUntil ?? null,
    lastRunHref: last ? executionHref(last.id) : null,
    manageHref: `/jobs/${encodeURIComponent(job.id)}/edit`,
  };
}

export interface AutomationPolicyInput {
  id: string;
  name: string;
  description: string;
  automationType: string;
  mode: AutomationMode;
  status: "active" | "disabled";
  tags: string[] | null;
  snoozedUntil: string | null;
}

/**
 * Build the row for an automation policy from its recent runs (newest first).
 * `typeLabel` is the catalog automation's display name (falls back to its id).
 */
export function automationWorkItem(
  policy: AutomationPolicyInput,
  runs: Array<{ id: string; status: string; startedAt: string }>,
  schedule: ScheduleInfo,
  typeLabel?: string,
): WorkItem {
  const last = runs[0];
  return {
    id: policy.id,
    kind: "automation",
    mode: policy.mode,
    name: policy.name,
    description: policy.description,
    reportType: typeLabel ?? policy.automationType,
    status: policy.status,
    tags: policy.tags ?? [],
    ...schedule,
    lastRun: last ? { id: last.id, status: automationRunOutcome(last.status), startedAt: last.startedAt } : null,
    recent: runs.map((r) => automationRunOutcome(r.status)),
    snoozedUntil: policy.snoozedUntil ?? null,
    lastRunHref: last ? automationRunHref(last.id) : null,
    manageHref: "/automations",
  };
}

export interface WorkItemFilter extends JobFilter {
  /** "all" | WorkItemKind. */
  kind?: string;
}

/** Dashboard filter: the job filters (search, state, outcome, type, tags) plus the item kind. */
export function filterWorkItems<T extends WorkItem>(items: T[], f: WorkItemFilter, now: Date = new Date()): T[] {
  const byKind = f.kind && f.kind !== ALL ? items.filter((i) => i.kind === f.kind) : items;
  return filterJobs(byKind, f, now);
}

/** Count of rows per kind, for the overview strip's split. */
export function countByKind(items: Array<Pick<WorkItem, "kind">>): Record<WorkItemKind, number> {
  const out: Record<WorkItemKind, number> = { report: 0, automation: 0 };
  for (const i of items) out[i.kind]++;
  return out;
}

/** "3 reports · 2 automations" — the split shown under an overview counter. */
export function kindSplitLabel(counts: Record<WorkItemKind, number>): string {
  const r = `${counts.report} report${counts.report === 1 ? "" : "s"}`;
  const a = `${counts.automation} automation${counts.automation === 1 ? "" : "s"}`;
  return `${r} · ${a}`;
}

export type LogSource = "report" | "automation";

/** Link target for a log line: the execution for report logs, the run for automation logs. */
export function logEntryHref(entry: { source: LogSource; executionId: string | null; runId: string | null }): string | null {
  if (entry.source === "report") return entry.executionId ? executionHref(entry.executionId) : null;
  return entry.runId ? automationRunHref(entry.runId) : null;
}
