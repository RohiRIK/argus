"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LinkButton, Badge, Button, Input } from "@/components/ui/primitives";
import { StatusPill, type JobStatus } from "@/components/ui/status-pill";
import { JobActions } from "@/components/job-actions";
import { computeHealth, HEALTH_META, sparkColor } from "@/lib/job-health";
import { filterJobs, displayStatus, ALL } from "@/lib/job-filter";
import { isSnoozed } from "@/lib/snooze";

export interface JobCardData {
  id: string;
  name: string;
  description: string;
  reportType: string;
  status: "active" | "disabled";
  tags: string[];
  scheduleSummary: string;
  nextRun: string;
  lastRun: { id: string; status: string; startedAt: string } | null;
  recent: string[]; // newest-first statuses, up to 20
  snoozedUntil: string | null;
}

function Sparkline({ recent }: { recent: string[] }) {
  if (recent.length === 0) return null;
  const dots = [...recent].slice(0, 12).reverse(); // oldest → newest (latest on the right)
  return (
    <div className="flex items-center gap-0.5" data-testid="sparkline" title="Recent runs">
      {dots.map((s, i) => (
        <span key={i} className={`h-3 w-1 rounded-sm ${sparkColor(s)}`} />
      ))}
    </div>
  );
}

export function DashboardClient({ jobs }: { jobs: JobCardData[] }) {
  const router = useRouter();
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [reportFilter, setReportFilter] = useState<string>(ALL);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const allTags = useMemo(() => {
    const t = new Set<string>();
    for (const j of jobs) for (const tag of j.tags) t.add(tag);
    return [...t].sort();
  }, [jobs]);

  const reportTypes = useMemo(() => [...new Set(jobs.map((j) => j.reportType))].sort(), [jobs]);
  const statuses = useMemo(() => [...new Set(jobs.map((j) => displayStatus(j)))].sort(), [jobs]);

  const filtered = useMemo(
    () => filterJobs(jobs, { query, status: statusFilter, reportType: reportFilter, tags: [...activeTags] }),
    [jobs, query, statusFilter, reportFilter, activeTags],
  );

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function bulk(action: "enable" | "disable" | "delete") {
    if (action === "delete" && !confirm(`Delete ${selected.size} job${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBusy(true);
    const ids = [...selected];
    await Promise.all(
      ids.map((id) =>
        action === "delete"
          ? fetch(`/api/jobs/${id}`, { method: "DELETE" })
          : fetch(`/api/jobs/${id}`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ status: action === "enable" ? "active" : "disabled" }),
            }),
      ),
    );
    setSelected(new Set());
    setSelectMode(false);
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      {/* Search + filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search jobs by name…"
          data-testid="job-search"
          className="h-9 max-w-xs flex-1 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="status-filter"
          className="h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg focus:border-accent focus:outline-none"
        >
          <option value={ALL}>All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={reportFilter}
          onChange={(e) => setReportFilter(e.target.value)}
          data-testid="report-filter"
          className="h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg focus:border-accent focus:outline-none"
        >
          <option value={ALL}>All report types</option>
          {reportTypes.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs tabular-nums text-fg-muted" data-testid="result-count">{filtered.length} / {jobs.length}</span>
          <Button
            variant={selectMode ? "primary" : "ghost"}
            size="sm"
            onClick={() => {
              setSelectMode((s) => !s);
              setSelected(new Set());
            }}
            data-testid="select-toggle"
          >
            {selectMode ? "Done" : "Select"}
          </Button>
        </div>
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="tag-filter">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              data-testid={`tag-${tag}`}
              className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
                activeTags.has(tag) ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted hover:text-fg"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Job list */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface" data-testid="job-list">
        {/* Column header (desktop) */}
        <div className="hidden border-b border-border bg-surface-2/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted lg:grid lg:grid-cols-[1.7fr_0.8fr_1fr_1fr_auto] lg:gap-4">
          <span>Job</span>
          <span>Status</span>
          <span>Last run</span>
          <span>Next run</span>
          <span className="text-right">Actions</span>
        </div>

        <div className="divide-y divide-border">
          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-fg-muted">No jobs match these filters.</p>
          ) : (
            filtered.map((job) => {
              const health = computeHealth(job.recent);
              const hm = HEALTH_META[health];
              const status: JobStatus =
                job.status === "disabled" ? "disabled" : ((job.lastRun?.status as JobStatus) ?? "disabled");
              const isSel = selected.has(job.id);
              return (
                <div
                  key={job.id}
                  data-testid="job-card"
                  onClick={selectMode ? () => toggleSelect(job.id) : undefined}
                  className={`grid grid-cols-1 gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/30 lg:grid-cols-[1.7fr_0.8fr_1fr_1fr_auto] lg:items-center lg:gap-4 ${
                    selectMode ? "cursor-pointer" : ""
                  } ${isSel ? "bg-accent/5" : ""}`}
                >
                  {/* Job identity */}
                  <div className="flex min-w-0 items-start gap-2.5">
                    {selectMode && (
                      <input
                        type="checkbox"
                        checked={isSel}
                        readOnly
                        data-testid={`select-${job.id}`}
                        className="mt-1 h-4 w-4 shrink-0 accent-accent"
                      />
                    )}
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-fg">{job.name}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge>{job.reportType}</Badge>
                        {job.tags.slice(0, 2).map((t) => (
                          <Badge key={t} className="border-accent/30 text-accent/90">{t}</Badge>
                        ))}
                        {job.tags.length > 2 && <Badge>+{job.tags.length - 2}</Badge>}
                        {isSnoozed(job.snoozedUntil) && (
                          <span
                            data-testid="snooze-pill"
                            title={`Snoozed until ${new Date(job.snoozedUntil!).toLocaleString()}`}
                            className="rounded-md border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-info"
                          >
                            Snoozed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status + health + sparkline */}
                  <div className="flex items-center gap-2 lg:flex-col lg:items-start lg:gap-1.5">
                    <StatusPill status={status} />
                    {health !== "healthy" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (job.lastRun) router.push(`/executions/${job.lastRun.id}`);
                        }}
                        data-testid="health-pill"
                        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${hm.tone}`}
                      >
                        {hm.label}
                      </button>
                    )}
                    {job.recent.length > 0 && <Sparkline recent={job.recent} />}
                  </div>

                  {/* Last run */}
                  <div className="text-xs text-fg-muted lg:text-fg">
                    <span className="lg:hidden text-fg-muted/70">Last run · </span>
                    {job.lastRun ? new Date(job.lastRun.startedAt).toLocaleString() : "never"}
                  </div>

                  {/* Next run */}
                  <div className="text-xs text-fg-muted lg:text-fg">
                    <span className="lg:hidden text-fg-muted/70">Next run · </span>
                    {job.nextRun}
                  </div>

                  {/* Actions */}
                  {!selectMode && (
                    <div className="flex items-center justify-end gap-1">
                      <JobActions jobId={job.id} status={job.status} snoozedUntil={job.snoozedUntil} />
                      {job.lastRun && (
                        <LinkButton href={`/executions/${job.lastRun.id}`} variant="ghost" size="sm">
                          Logs →
                        </LinkButton>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-elevated-lg"
          data-testid="bulk-bar"
        >
          <span className="text-xs font-medium text-fg">{selected.size} selected</span>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => bulk("enable")}>Enable</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => bulk("disable")}>Disable</Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => bulk("delete")}>Delete</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>Deselect all</Button>
        </div>
      )}
    </>
  );
}
