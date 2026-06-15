"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, LinkButton, Badge, Button, Input } from "@/components/ui/primitives";
import { StatusPill, type JobStatus } from "@/components/ui/status-pill";
import { JobActions } from "@/components/job-actions";
import { computeHealth, HEALTH_META, sparkColor } from "@/lib/job-health";
import { filterJobs, displayStatus, ALL } from "@/lib/job-filter";

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
}

function Sparkline({ recent }: { recent: string[] }) {
  if (recent.length === 0) return null;
  const dots = [...recent].slice(0, 20).reverse(); // oldest → newest (latest on the right)
  return (
    <div className="flex items-center gap-0.5" data-testid="sparkline" title="Last 20 runs">
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
          className="h-8 max-w-xs flex-1 text-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="status-filter"
          className="h-8 rounded-lg border border-border/50 bg-surface-2/30 px-2 text-xs text-fg focus:border-accent focus:outline-none"
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
          className="h-8 rounded-lg border border-border/50 bg-surface-2/30 px-2 text-xs text-fg focus:border-accent focus:outline-none"
        >
          <option value={ALL}>All report types</option>
          {reportTypes.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <span className="text-[10px] uppercase tracking-wider text-fg-muted/50" data-testid="result-count">
          {filtered.length} / {jobs.length}
        </span>
      </div>

      {/* Tag filter + selection bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="tag-filter">
          {allTags.length === 0 ? (
            <span className="text-[10px] uppercase tracking-wider text-fg-muted/50">No tags yet</span>
          ) : (
            allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                data-testid={`tag-${tag}`}
                className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  activeTags.has(tag) ? "border-accent bg-accent/10 text-accent" : "border-border/50 text-fg-muted hover:text-fg"
                }`}
              >
                {tag}
              </button>
            ))
          )}
        </div>
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((job) => {
          const health = computeHealth(job.recent);
          const hm = HEALTH_META[health];
          const status: JobStatus =
            job.status === "disabled" ? "disabled" : ((job.lastRun?.status as JobStatus) ?? "disabled");
          const isSel = selected.has(job.id);
          return (
            <Card
              key={job.id}
              data-testid="job-card"
              onClick={selectMode ? () => toggleSelect(job.id) : undefined}
              className={`group relative transition-all duration-200 hover:shadow-elevated hover:border-border/80 ${
                selectMode ? "cursor-pointer" : ""
              } ${isSel ? "border-accent ring-1 ring-accent/40" : ""}`}
            >
              <CardContent className="space-y-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    {selectMode && (
                      <input
                        type="checkbox"
                        checked={isSel}
                        readOnly
                        data-testid={`select-${job.id}`}
                        className="mt-1 h-3.5 w-3.5 accent-accent"
                      />
                    )}
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-fg">{job.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-fg-muted/70">{job.description || job.scheduleSummary}</p>
                    </div>
                  </div>
                  <StatusPill status={status} />
                </div>

                {/* Health + tags */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {health !== "healthy" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (job.lastRun) router.push(`/executions/${job.lastRun.id}`);
                      }}
                      data-testid="health-pill"
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${hm.tone}`}
                    >
                      {hm.label}
                    </button>
                  )}
                  <Badge>{job.reportType}</Badge>
                  {job.tags.slice(0, 3).map((t) => (
                    <Badge key={t} className="border-accent/30 text-accent/90">{t}</Badge>
                  ))}
                  {job.tags.length > 3 && <Badge>+{job.tags.length - 3}</Badge>}
                </div>

                {/* Sparkline */}
                {job.recent.length > 0 && <Sparkline recent={job.recent} />}

                {/* Timings */}
                <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
                  <dt className="text-fg-muted/60">Schedule</dt>
                  <dd className="truncate text-right font-medium text-fg">{job.scheduleSummary}</dd>
                  <dt className="text-fg-muted/60">Last run</dt>
                  <dd className="text-right font-medium tabular-nums text-fg">
                    {job.lastRun ? new Date(job.lastRun.startedAt).toLocaleString() : "never"}
                  </dd>
                  <dt className="text-fg-muted/60">Next run</dt>
                  <dd className="text-right font-medium tabular-nums text-fg">{job.nextRun}</dd>
                </dl>

                {/* Actions */}
                {!selectMode && (
                  <div className="flex items-center justify-between border-t border-border/50 pt-3">
                    <JobActions jobId={job.id} status={job.status} />
                    {job.lastRun && (
                      <LinkButton href={`/executions/${job.lastRun.id}`} variant="ghost" size="sm">
                        View logs →
                      </LinkButton>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border/60 bg-surface px-4 py-2.5 shadow-elevated-lg"
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
