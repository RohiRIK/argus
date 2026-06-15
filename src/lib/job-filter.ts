/**
 * Pure dashboard filtering: free-text search by job name plus status,
 * report-type, and tag filters. DOM-free so it can be unit-tested directly.
 */

export interface FilterableJob {
  name: string;
  reportType: string;
  status: "active" | "disabled";
  tags: string[];
  lastRun: { status: string } | null;
}

export interface JobFilter {
  query: string;
  status: string; // "all" | displayStatus value
  reportType: string; // "all" | a reportType
  tags: string[];
}

export const ALL = "all";

/**
 * The status shown on a job card: disabled jobs read "disabled", otherwise the
 * last run's status (or "disabled" when a job has never run). Mirrors the card.
 */
export function displayStatus(job: FilterableJob): string {
  if (job.status === "disabled") return "disabled";
  return job.lastRun?.status ?? "disabled";
}

export function filterJobs<T extends FilterableJob>(jobs: T[], f: JobFilter): T[] {
  const q = f.query.trim().toLowerCase();
  return jobs.filter((j) => {
    if (q && !j.name.toLowerCase().includes(q)) return false;
    if (f.status !== ALL && displayStatus(j) !== f.status) return false;
    if (f.reportType !== ALL && j.reportType !== f.reportType) return false;
    if (f.tags.length > 0 && !f.tags.every((t) => j.tags.includes(t))) return false;
    return true;
  });
}
