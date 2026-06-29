"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LinkButton, Badge, Button, Input, EmptyState } from "@/components/ui/primitives";
import { StatusPill, type JobStatus } from "@/components/ui/status-pill";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatStrip, type Stat } from "@/components/ui/stat-strip";
import { RelativeTime } from "@/components/ui/relative-time";
import { useToast } from "@/components/ui/toast";
import { JobActions } from "@/components/job-actions";
import { computeHealth, HEALTH_META, type Health } from "@/lib/job-health";
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
  nextRunAt: string | null;
  lastRun: { id: string; status: string; startedAt: string } | null;
  recent: string[]; // newest-first statuses, up to 20
  snoozedUntil: string | null;
}

type HealthView = "healthy" | "failing" | "dueSoon" | "snoozed";
const SEVERITY: Record<Health, number> = { critical: 3, warning: 2, unknown: 1, healthy: 0 };
const DUE_SOON_MS = 60 * 60 * 1000; // next run within the hour

function isDueSoon(job: JobCardData, now: number): boolean {
  if (job.status !== "active" || !job.nextRunAt) return false;
  const t = new Date(job.nextRunAt).getTime();
  return t - now <= DUE_SOON_MS && t - now >= -DUE_SOON_MS;
}

function rowStatus(job: JobCardData): JobStatus {
  return job.status === "disabled" ? "disabled" : ((job.lastRun?.status as JobStatus) ?? "disabled");
}

export function DashboardClient({ jobs }: { jobs: JobCardData[] }) {
  const router = useRouter();
  const toast = useToast();
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [reportFilter, setReportFilter] = useState<string>(ALL);
  const [healthView, setHealthView] = useState<HealthView | null>(null);
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

  // Overview counts (triage signals). Computed once per job set.
  const overview = useMemo(() => {
    const now = Date.now();
    let healthy = 0, failing = 0, dueSoon = 0, snoozed = 0;
    for (const j of jobs) {
      const h = computeHealth(j.recent);
      if (h === "healthy") healthy++;
      if (h === "critical" || h === "warning") failing++;
      if (isDueSoon(j, now)) dueSoon++;
      if (isSnoozed(j.snoozedUntil)) snoozed++;
    }
    return { total: jobs.length, healthy, failing, dueSoon, snoozed };
  }, [jobs]);

  const stats: Stat[] = [
    { key: "all", label: "Total", value: overview.total },
    { key: "healthy", label: "Healthy", value: overview.healthy, dot: "bg-success" },
    { key: "failing", label: "Failing", value: overview.failing, dot: "bg-danger", emphasize: true },
    { key: "dueSoon", label: "Due soon", value: overview.dueSoon, dot: "bg-info" },
    { key: "snoozed", label: "Snoozed", value: overview.snoozed, dot: "bg-fg-muted" },
  ];

  const filtered = useMemo(() => {
    const now = Date.now();
    let list = filterJobs(jobs, { query, status: statusFilter, reportType: reportFilter, tags: [...activeTags] });
    if (healthView) {
      list = list.filter((j) => {
        const h = computeHealth(j.recent);
        if (healthView === "healthy") return h === "healthy";
        if (healthView === "failing") return h === "critical" || h === "warning";
        if (healthView === "dueSoon") return isDueSoon(j, now);
        if (healthView === "snoozed") return isSnoozed(j.snoozedUntil);
        return true;
      });
    }
    return list;
  }, [jobs, query, statusFilter, reportFilter, activeTags, healthView]);

  const anyFilterActive = query !== "" || statusFilter !== ALL || reportFilter !== ALL || activeTags.size > 0 || healthView !== null;

  function clearFilters() {
    setQuery("");
    setStatusFilter(ALL);
    setReportFilter(ALL);
    setActiveTags(new Set());
    setHealthView(null);
  }

  function selectStat(key: string) {
    setHealthView((prev) => (prev === key || key === "all" ? null : (key as HealthView)));
  }

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
    toast.push(`${ids.length} job${ids.length === 1 ? "" : "s"} ${action}d`, action === "delete" ? "danger" : "success");
    router.refresh();
  }

  // ── Table columns ────────────────────────────────────────────────────────
  const columns: Column<JobCardData>[] = [];
  if (selectMode) {
    columns.push({
      key: "select",
      header: "",
      headerClassName: "w-10",
      cell: (job) => (
        <input
          type="checkbox"
          checked={selected.has(job.id)}
          readOnly
          data-testid={`select-${job.id}`}
          className="h-4 w-4 accent-primary"
        />
      ),
    });
  }
  columns.push(
    {
      key: "name",
      header: "Job",
      sortValue: (j) => j.name.toLowerCase(),
      cell: (job) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{job.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge>{job.reportType}</Badge>
            {job.tags.slice(0, 2).map((t) => (
              <Badge key={t}>{t}</Badge>
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
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (j) => SEVERITY[computeHealth(j.recent)],
      cell: (job) => {
        const health = computeHealth(job.recent);
        const hm = HEALTH_META[health];
        return (
          <div className="flex items-center gap-2">
            <StatusPill status={rowStatus(job)} />
            {health !== "healthy" && health !== "unknown" && (
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
          </div>
        );
      },
    },
    {
      key: "lastRun",
      header: "Last run",
      sortValue: (j) => j.lastRun?.startedAt ?? "",
      cell: (job) =>
        job.lastRun ? (
          <RelativeTime iso={job.lastRun.startedAt} className="text-fg-muted" />
        ) : (
          <span className="text-fg-muted/60">never</span>
        ),
    },
    {
      key: "nextRun",
      header: "Next run",
      sortValue: (j) => j.nextRunAt ?? "~", // nulls (disabled) sort last
      cell: (job) =>
        job.nextRunAt ? (
          <RelativeTime iso={job.nextRunAt} className="text-fg-muted" />
        ) : (
          <span className="text-fg-muted/60">{job.nextRun}</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (job) =>
        selectMode ? null : (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <JobActions jobId={job.id} status={job.status} snoozedUntil={job.snoozedUntil} />
            {job.lastRun && (
              <LinkButton href={`/executions/${job.lastRun.id}`} variant="ghost" size="sm">
                Logs →
              </LinkButton>
            )}
          </div>
        ),
    },
  );

  return (
    <div className="space-y-6">
      {/* Overview — triage at a glance, each cell a filter shortcut */}
      <StatStrip stats={stats} activeKey={healthView ?? (anyFilterActive ? null : "all")} onSelect={selectStat} />

      {/* Search + filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs by name…"
            data-testid="job-search"
            className="h-9 max-w-xs flex-1"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            data-testid="status-filter"
            className="h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg focus:border-primary focus:outline-none"
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
            className="h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg focus:border-primary focus:outline-none"
          >
            <option value={ALL}>All report types</option>
            {reportTypes.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs tabular-nums text-fg-muted" data-testid="result-count">
              {filtered.length} / {jobs.length}
            </span>
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

        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="tag-filter">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                data-testid={`tag-${tag}`}
                className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
                  activeTags.has(tag) ? "border-primary bg-primary/10 text-primary" : "border-border text-fg-muted hover:text-fg"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Job table */}
      <DataTable
        columns={columns}
        rows={filtered}
        getRowKey={(j) => j.id}
        initialSort={{ key: "status", dir: "desc" }}
        onRowActivate={(job) => {
          if (selectMode) toggleSelect(job.id);
          else if (job.lastRun) router.push(`/executions/${job.lastRun.id}`);
        }}
        emptyState={
          <EmptyState
            title={anyFilterActive ? "No jobs match these filters" : "No jobs yet"}
            hint={anyFilterActive ? "Try widening or clearing the filters." : "Create one from the catalog."}
            action={
              anyFilterActive ? (
                <Button variant="outline" size="sm" onClick={clearFilters} data-testid="clear-filters">
                  Clear filters
                </Button>
              ) : (
                <LinkButton href="/catalog" variant="primary" size="sm">Browse catalog</LinkButton>
              )
            }
          />
        }
      />

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-surface-elevated px-4 py-2.5 shadow-elevated"
          data-testid="bulk-bar"
        >
          <span className="text-xs font-medium text-fg">{selected.size} selected</span>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => bulk("enable")}>Enable</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => bulk("disable")}>Disable</Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => bulk("delete")}>Delete</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>Deselect all</Button>
        </div>
      )}
    </div>
  );
}
