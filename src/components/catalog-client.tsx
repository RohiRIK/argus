"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  BadgeCategory,
  Button,
  EmptyState,
  Input,
  LinkButton,
  Segmented,
} from "@/components/ui/primitives";
import { IconClose, WorkloadIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { PluginDataSource, PluginIconKey } from "@/services/reports/types";

export type CatalogReport = {
  id: string;
  version?: string;
  name: string;
  category: "identity" | "security" | "infrastructure" | "custom";
  description: string;
  requiredPermissions: string[];
  baselineSupport: boolean;
  tags?: string[];
  maturity?: "stable" | "preview";
  recommendedSchedule?: "hourly" | "daily" | "weekly";
  recommendedGroup?: string;
  usageConcealmentNote?: boolean;
  source?: "builtin" | "declarative";
  service?: string;
  icon?: PluginIconKey;
  dataSource?: PluginDataSource;
  metrics?: string[];
  author?: string;
};

export type CatalogJobRef = {
  id: string;
  name: string;
  status: string;
};

type CategoryFilter = "all" | "identity" | "security" | "infrastructure" | "custom";
type ViewMode = "cards" | "list";
type SortMode = "recommended" | "name" | "active-first";

const CATEGORIES: readonly CategoryFilter[] = ["all", "identity", "security", "infrastructure", "custom"];
const CATEGORY_LABEL: Record<CategoryFilter, string> = {
  all: "All",
  identity: "Identity",
  security: "Security",
  infrastructure: "Infrastructure",
  custom: "Custom",
};

const DATA_SOURCE_BADGE: Record<PluginDataSource, { short: string; long: string; tone: string }> = {
  "graph-v1": { short: "Graph v1.0", long: "Microsoft Graph v1.0", tone: "text-fg-muted" },
  "graph-beta": { short: "Graph Beta", long: "Microsoft Graph Beta", tone: "text-warning" },
  "usage-csv": { short: "Usage CSV", long: "M365 Usage Reports CSV", tone: "text-info" },
};

const CADENCE_LABEL: Record<"hourly" | "daily" | "weekly", string> = {
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
};

interface SolutionPack {
  id: string;
  name: string;
  tagline: string;
  reportIds: string[];
}

const SOLUTION_PACKS: readonly SolutionPack[] = [
  {
    id: "secops",
    name: "Security Operations Essentials",
    tagline: "Core threat, score, Conditional Access & DLP signals.",
    reportIds: ["security-alerts-digest", "secure-score", "conditional-access-failures", "dlp-alerts"],
  },
  {
    id: "identity",
    name: "Identity & Zero-Trust Hygiene",
    tagline: "Risky users, MFA gaps, stale B2B guests & app secrets.",
    reportIds: ["risky-users", "mfa-registration", "inactive-guest-users", "app-secrets-expiry"],
  },
  {
    id: "capacity",
    name: "M365 Cost & Capacity Ops",
    tagline: "Reclaim dormant licenses and monitor mailbox/OneDrive quotas.",
    reportIds: ["license-utilization", "dormant-licensed-users", "mailbox-quota", "onedrive-usage"],
  },
];

function Chip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors duration-150",
        active
          ? "border-primary/45 bg-primary/12 text-fg"
          : "border-border/60 bg-surface text-fg-muted hover:border-border hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function CatalogClient({
  reports,
  initialJobsByReport = {},
  quarantinedCount = 0,
}: {
  reports: CatalogReport[];
  initialJobsByReport?: Record<string, CatalogJobRef[]>;
  quarantinedCount?: number;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("recommended");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [unscheduledOnly, setUnscheduledOnly] = useState(false);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [gapOnly, setGapOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [jobsByReport, setJobsByReport] = useState<Record<string, CatalogJobRef[]>>(initialJobsByReport);
  const [enabling, setEnabling] = useState(false);
  const [enableMsg, setEnableMsg] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const [enablingPackId, setEnablingPackId] = useState<string | null>(null);
  const [packMsg, setPackMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [permStatus, setPermStatus] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    void fetch("/api/settings/permissions")
      .then((r) => r.json())
      .then((b) => {
        if (!b.success) {
          setPermStatus("missing");
          setMissing([]);
          return;
        }
        const status = (b.data?.status as string) ?? "missing";
        setPermStatus(status === "ok" ? "ok" : status === "error" ? "error" : "missing");
        setMissing(Array.isArray(b.data?.missing) ? b.data.missing : []);
      })
      .catch(() => {
        setPermStatus("missing");
        setMissing([]);
      });
  }, []);

  const missingSet = useMemo(() => new Set(missing), [missing]);
  const showGapToggle = permStatus !== "loading" && permStatus !== "ok" && missing.length > 0;

  const reportById = useMemo(() => {
    const map = new Map<string, CatalogReport>();
    for (const r of reports) map.set(r.id, r);
    return map;
  }, [reports]);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryFilter, number> = {
      all: reports.length,
      identity: 0,
      security: 0,
      infrastructure: 0,
      custom: 0,
    };
    for (const r of reports) counts[r.category] += 1;
    return counts;
  }, [reports]);

  const serviceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reports) {
      const svc = r.service ?? "Microsoft 365";
      counts.set(svc, (counts.get(svc) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [reports]);

  const scheduledReportCount = useMemo(
    () => reports.filter((r) => (jobsByReport[r.id]?.length ?? 0) > 0).length,
    [reports, jobsByReport],
  );

  const hasPreviewReports = useMemo(() => reports.some((r) => r.maturity === "preview"), [reports]);
  const activePack = activePackId ? SOLUTION_PACKS.find((p) => p.id === activePackId) ?? null : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const packSet = activePack ? new Set(activePack.reportIds) : null;

    const base = reports.filter((r) => {
      if (packSet && !packSet.has(r.id)) return false;
      if (category !== "all" && r.category !== category) return false;
      if (serviceFilter !== "all" && (r.service ?? "Microsoft 365") !== serviceFilter) return false;
      if (previewOnly && r.maturity !== "preview") return false;
      if (unscheduledOnly && (jobsByReport[r.id]?.length ?? 0) > 0) return false;

      if (gapOnly) {
        if (r.requiredPermissions.length === 0) return false;
        if (!r.requiredPermissions.some((p) => missingSet.has(p))) return false;
      }

      if (q) {
        const hay = [
          r.name,
          r.description,
          r.id,
          r.service ?? "",
          r.author ?? "",
          ...(r.metrics ?? []),
          ...(r.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    if (sortMode === "name") {
      return [...base].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sortMode === "active-first") {
      return [...base].sort((a, b) => {
        const ca = jobsByReport[a.id]?.length ?? 0;
        const cb = jobsByReport[b.id]?.length ?? 0;
        if (cb !== ca) return cb - ca;
        return a.name.localeCompare(b.name);
      });
    }
    return base;
  }, [
    reports,
    query,
    category,
    serviceFilter,
    activePack,
    sortMode,
    previewOnly,
    unscheduledOnly,
    gapOnly,
    missingSet,
    jobsByReport,
  ]);

  const selected = selectedId ? reports.find((r) => r.id === selectedId) ?? null : null;

  const anyFilter =
    query.trim() !== "" ||
    category !== "all" ||
    serviceFilter !== "all" ||
    activePackId !== null ||
    unscheduledOnly ||
    previewOnly ||
    gapOnly;

  function clearFilters() {
    setQuery("");
    setCategory("all");
    setServiceFilter("all");
    setActivePackId(null);
    setUnscheduledOnly(false);
    setPreviewOnly(false);
    setGapOnly(false);
  }

  function openDrawer(id: string) {
    setSelectedId(id);
    setEnableMsg(null);
  }

  async function quickEnable(report: CatalogReport): Promise<{ ok: boolean; error?: string }> {
    setEnabling(true);
    setEnableMsg(null);
    try {
      const res = await fetch("/api/catalog/quick-enable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportType: report.id }),
      });
      const body = await res.json();
      if (body.success && body.data?.id) {
        setJobsByReport((prev) => ({
          ...prev,
          [report.id]: [
            ...(prev[report.id] ?? []),
            { id: body.data.id as string, name: body.data.name as string, status: body.data.status as string },
          ],
        }));
        const blockers = (body.data.blockers ?? []) as Array<{ message: string; repairHref: string }>;
        setEnableMsg(
          blockers.length > 0
            ? { ok: false, text: `Created "${body.data.name}" paused — ${blockers[0].message}`, href: blockers[0].repairHref }
            : { ok: true, text: `Scheduled "${body.data.name}" (${report.recommendedSchedule ?? "weekly"}).` },
        );
        return { ok: true };
      }
      const message = (body.error?.message as string | undefined) ?? "Could not enable report.";
      setEnableMsg({ ok: false, text: message });
      return { ok: false, error: message };
    } finally {
      setEnabling(false);
    }
  }

  async function enablePack(pack: SolutionPack) {
    const remaining = pack.reportIds.filter((id) => (jobsByReport[id]?.length ?? 0) === 0 && reportById.has(id));
    if (remaining.length === 0) return;

    setEnablingPackId(pack.id);
    setPackMsg(null);
    let enabledCount = 0;
    let firstError = "";

    try {
      for (const reportId of remaining) {
        const res = await fetch("/api/catalog/quick-enable", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reportType: reportId }),
        });
        const body = await res.json();
        if (body.success && body.data?.id) {
          enabledCount += 1;
          setJobsByReport((prev) => ({
            ...prev,
            [reportId]: [
              ...(prev[reportId] ?? []),
              { id: body.data.id as string, name: body.data.name as string, status: body.data.status as string },
            ],
          }));
        } else if (!firstError) {
          firstError = (body.error?.message as string | undefined) ?? "Pack activation partial failure.";
        }
      }

      if (enabledCount > 0 && !firstError) {
        setPackMsg({
          ok: true,
          text: `Enabled ${enabledCount} plugin${enabledCount === 1 ? "" : "s"} from "${pack.name}".`,
        });
      } else if (enabledCount > 0) {
        setPackMsg({
          ok: false,
          text: `Enabled ${enabledCount}/${remaining.length} plugins in "${pack.name}": ${firstError}`,
        });
      } else {
        setPackMsg({ ok: false, text: firstError || "Could not enable pack plugins." });
      }
    } finally {
      setEnablingPackId(null);
    }
  }

  function readinessFor(r: CatalogReport): { label: string; hasGap: boolean; ready: boolean } {
    const concrete = r.requiredPermissions.filter((p) => !p.startsWith("("));
    if (concrete.length === 0) return { label: "Custom scope", hasGap: false, ready: true };
    const missingCount = concrete.filter((p) => missingSet.has(p)).length;
    if (missingCount > 0) {
      return {
        label: `${missingCount} missing scope${missingCount === 1 ? "" : "s"}`,
        hasGap: true,
        ready: false,
      };
    }
    const prefix = permStatus === "ok" ? "Ready" : `${concrete.length} scope${concrete.length === 1 ? "" : "s"}`;
    return {
      label: permStatus === "ok" ? `${prefix} · ${concrete.length} scope${concrete.length === 1 ? "" : "s"}` : prefix,
      hasGap: false,
      ready: permStatus === "ok",
    };
  }

  // Esc + body scroll lock while drawer open.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [selected]);

  return (
    <>
      {/* Marketplace summary + sort & layout switch */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg" data-testid="catalog-count">
            {filtered.length === reports.length
              ? `${reports.length} M365 report plugins`
              : `${filtered.length} of ${reports.length} report plugins`}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {serviceCounts.length} Microsoft 365 workloads · {scheduledReportCount} scheduled · Read-only Graph plugins
            {quarantinedCount > 0 && ` · ${quarantinedCount} quarantined`}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <select
            aria-label="Sort plugins"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            data-testid="catalog-sort"
            className="argus-select h-8 rounded-md border border-border/70 bg-surface px-2.5 pr-7 text-xs font-medium text-fg focus:border-primary focus:outline-none"
          >
            <option value="recommended">Recommended</option>
            <option value="active-first">Active first</option>
            <option value="name">Name A–Z</option>
          </select>
          <Segmented<ViewMode>
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: "cards", label: "Cards" },
              { value: "list", label: "List" },
            ]}
          />
        </div>
      </div>

      {/* Curated Solution Packs shelf */}
      {!anyFilter && (
        <section className="mb-5" data-testid="catalog-packs" aria-label="Curated solution packs">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Solution Packs</h2>
              <p className="text-[11px] text-fg-muted/80">
                Curated M365 telemetry bundles — inspect or activate all plugins with one click.
              </p>
            </div>
            {packMsg && (
              <p className={`text-xs font-medium ${packMsg.ok ? "text-success" : "text-warning"}`}>
                {packMsg.ok ? "✓ " : "! "}
                {packMsg.text}
              </p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {SOLUTION_PACKS.map((pack) => {
              const packReports = pack.reportIds
                .map((id) => reportById.get(id))
                .filter((r): r is CatalogReport => Boolean(r));
              const activeInPack = packReports.filter((r) => (jobsByReport[r.id]?.length ?? 0) > 0).length;
              const remainingCount = packReports.length - activeInPack;
              const pct = packReports.length > 0 ? Math.round((activeInPack / packReports.length) * 100) : 0;
              const isBusy = enablingPackId === pack.id;

              return (
                <div
                  key={pack.id}
                  data-testid={`catalog-pack-${pack.id}`}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-surface p-3.5 transition-colors hover:border-border"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center -space-x-1.5">
                        {packReports.slice(0, 4).map((item) => (
                          <span
                            key={item.id}
                            title={item.service ?? item.name}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface-2 shadow-sm"
                          >
                            <WorkloadIcon icon={item.icon} className="h-4 w-4" />
                          </span>
                        ))}
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
                          remainingCount === 0
                            ? "border-success/35 bg-success/10 text-success"
                            : "border-border/60 bg-surface-2/60 text-fg-muted",
                        )}
                      >
                        {remainingCount === 0 ? "✓ All active" : `${activeInPack}/${packReports.length} active`}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-[13px] font-semibold text-fg">{pack.name}</h3>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-fg-muted">{pack.tagline}</p>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={cn("h-full rounded-full transition-all", remainingCount === 0 ? "bg-success" : "bg-primary")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setActivePackId(pack.id)}
                        className="font-medium text-fg-muted transition-colors hover:text-fg"
                      >
                        View {packReports.length} plugins →
                      </button>
                      {remainingCount > 0 && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void enablePack(pack)}
                          className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                        >
                          {isBusy ? "Enabling…" : `Enable ${remainingCount}`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Marketplace search + category + workload toolbar */}
      <div className="mb-5 space-y-2.5 rounded-xl border border-border/70 bg-surface p-3" data-testid="catalog-toolbar">
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plugins by name, workload, metric, or tag…"
            data-testid="catalog-search"
            className="h-9 min-w-[220px] flex-1 sm:max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-1.5" data-testid="catalog-category-chips">
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                active={category === c}
                onClick={() => setCategory(c)}
                testId={`catalog-category-${c}`}
              >
                <span>{CATEGORY_LABEL[c]}</span>
                <span className="font-mono text-[10px] opacity-65">{categoryCounts[c]}</span>
              </Chip>
            ))}
          </div>
        </div>

        {/* M365 Workload / Service filter rail */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2" data-testid="catalog-service-chips">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">Workload</span>
          <Chip active={serviceFilter === "all"} onClick={() => setServiceFilter("all")} testId="catalog-service-all">
            All workloads
          </Chip>
          {serviceCounts.map(([svc, count]) => (
            <Chip
              key={svc}
              active={serviceFilter === svc}
              onClick={() => setServiceFilter((cur) => (cur === svc ? "all" : svc))}
            >
              <span>{svc.replace(/^Microsoft /, "")}</span>
              <span className="font-mono text-[10px] opacity-65">{count}</span>
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {activePack && (
              <Chip active onClick={() => setActivePackId(null)} testId="catalog-pack-active">
                <span>Pack: {activePack.name}</span>
                <span className="font-mono text-[10px]">×</span>
              </Chip>
            )}
            <Chip active={unscheduledOnly} onClick={() => setUnscheduledOnly((v) => !v)} testId="catalog-filter-unscheduled">
              Not scheduled ({reports.length - scheduledReportCount})
            </Chip>
            {hasPreviewReports && (
              <Chip active={previewOnly} onClick={() => setPreviewOnly((v) => !v)} testId="catalog-maturity-preview">
                Preview
              </Chip>
            )}
            {showGapToggle && (
              <Chip active={gapOnly} onClick={() => setGapOnly((v) => !v)} testId="catalog-gap-toggle">
                Missing permissions ({reports.filter((r) => r.requiredPermissions.some((p) => missingSet.has(p))).length})
              </Chip>
            )}
          </div>
          {anyFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] font-medium text-primary hover:underline"
              data-testid="toolbar-clear-filters"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No reports match"
          hint="Try clearing search or filters to see the full plugin catalog."
          action={
            anyFilter ? (
              <Button variant="outline" size="sm" onClick={clearFilters} data-testid="clear-filters">
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : viewMode === "cards" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="catalog-grid">
          {filtered.map((r) => {
            const jobCount = jobsByReport[r.id]?.length ?? 0;
            const readiness = readinessFor(r);
            const dataSource = DATA_SOURCE_BADGE[r.dataSource ?? "graph-v1"];
            const cadence = CADENCE_LABEL[r.recommendedSchedule ?? "weekly"];
            const highlights = (r.metrics && r.metrics.length > 0 ? r.metrics : r.tags ?? []).slice(0, 2);

            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                data-testid={`catalog-card-${r.id}`}
                onClick={() => openDrawer(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDrawer(r.id);
                  }
                }}
                className="group flex h-full cursor-pointer flex-col gap-3 rounded-xl border border-border/75 bg-surface p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/45 hover:bg-surface-2/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* Header: Workload Icon Squircle + Product/Version Subtitle + Badges */}
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-surface-2/80 shadow-xs transition-colors group-hover:border-primary/35">
                      {/* Single SVG inside card tile (AC-UI9) */}
                      <WorkloadIcon icon={r.icon} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold leading-snug text-fg">{r.name}</h3>
                      <p className="truncate text-[11px] text-fg-muted">
                        <span>{r.service ?? "Microsoft 365"}</span>
                        <span className="mx-1 opacity-50">·</span>
                        <span className="font-mono text-[10px]">v{r.version ?? "1.0.0"}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <BadgeCategory category={r.category} />
                    {jobCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-success/35 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
                        data-testid={`catalog-active-${r.id}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        {jobCount} active
                      </span>
                    )}
                    {r.maturity === "preview" && (
                      <Badge data-testid={`catalog-preview-${r.id}`} className="uppercase tracking-wider">
                        Preview
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Body summary */}
                <p className="line-clamp-2 flex-1 text-xs leading-relaxed text-fg-muted">{r.description}</p>

                {/* Structured Marketplace Metadata Strip */}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-border/50 bg-bg-subtle/60 px-2.5 py-1.5 font-mono text-[10px] text-fg-muted">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-fg/90">{cadence}</span>
                    <span className="opacity-45">·</span>
                    <span className={dataSource.tone}>{dataSource.short}</span>
                    <span className="opacity-45">·</span>
                    <span>{r.baselineSupport ? "Baseline Δ" : "Snapshot"}</span>
                  </div>
                  <span className="text-success/90" title="Verified read-only Graph scope contract">
                    ✓ Read-only
                  </span>
                </div>

                {/* Output signal pills */}
                {highlights.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {highlights.map((item) => (
                      <span
                        key={item}
                        className="truncate rounded border border-border/50 bg-surface-2/55 px-2 py-0.5 text-[10px] text-fg-muted"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                )}

                {/* Footer: Scope Readiness + Always-visible Deep-link CTA */}
                <div className="flex items-center justify-between gap-2 border-t border-border/45 pt-2.5 text-[11px]">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5",
                      readiness.hasGap ? "font-medium text-warning" : "text-fg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        readiness.hasGap ? "bg-warning" : readiness.ready ? "bg-success" : "bg-fg-muted/50",
                      )}
                    />
                    {readiness.hasGap ? readiness.label : readiness.label}
                  </span>

                  {/* Q1 locked: labeled Create job deep-link; must not open drawer */}
                  <Link
                    href={`/jobs/new?report=${r.id}`}
                    data-testid={`catalog-create-${r.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 font-medium text-fg-muted transition-colors hover:text-accent group-hover:text-accent"
                  >
                    <span>Create job</span>
                    <span className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/75 bg-surface" data-testid="catalog-list">
          <div className="divide-y divide-border/50">
            {filtered.map((r) => {
              const jobCount = jobsByReport[r.id]?.length ?? 0;
              const readiness = readinessFor(r);
              const dataSource = DATA_SOURCE_BADGE[r.dataSource ?? "graph-v1"];
              const cadence = CADENCE_LABEL[r.recommendedSchedule ?? "weekly"];
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDrawer(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openDrawer(r.id);
                    }
                  }}
                  className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs transition-colors hover:bg-surface-2/30"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-surface-2/70">
                      <WorkloadIcon icon={r.icon} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-fg">{r.name}</span>
                        <span className="text-[11px] text-fg-muted">{r.service ?? "Microsoft 365"}</span>
                        <BadgeCategory category={r.category} />
                        {jobCount > 0 && (
                          <span className="rounded-full border border-success/35 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                            {jobCount} active
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-fg-muted">{r.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 font-mono text-[11px]">
                    <span className="hidden text-fg-muted md:inline">{cadence}</span>
                    <span className={cn("hidden sm:inline", dataSource.tone)}>{dataSource.short}</span>
                    <span className={readiness.hasGap ? "text-warning" : "text-fg-muted"}>
                      {readiness.label}
                    </span>
                    <Link
                      href={`/jobs/new?report=${r.id}`}
                      data-testid={`catalog-create-${r.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-sans font-medium text-primary hover:underline"
                    >
                      Create job →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actionable Marketplace Inspector Drawer */}
      {selected && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={selected.name} data-testid="catalog-drawer">
          <button
            type="button"
            aria-label="Close detail"
            onClick={() => setSelectedId(null)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            data-testid="catalog-drawer-backdrop"
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-border/70 bg-bg shadow-elevated animate-fade-in">
            <div className="flex items-start justify-between gap-3 border-b border-border/50 px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-surface-2/80">
                  <WorkloadIcon icon={selected.icon} className="h-6 w-6" />
                </span>
                <div className="min-w-0 space-y-1.5">
                  <h2 className="text-base font-semibold text-fg" data-testid="catalog-drawer-name">
                    {selected.name}
                  </h2>
                  <p className="text-xs text-fg-muted">
                    {selected.service ?? "Microsoft 365"} · {selected.author ?? "Argus Official"}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <BadgeCategory category={selected.category} />
                    {selected.version && (
                      <Badge className="font-mono text-[10px]">v{selected.version}</Badge>
                    )}
                    <Badge className="border-success/30 bg-success/10 text-[10px] text-success">
                      ✓ Verified Read-Only
                    </Badge>
                    <Badge className="text-[10px]">
                      {selected.source === "declarative" ? "Custom YAML/JSON" : "Built-in plugin"}
                    </Badge>
                    {selected.maturity === "preview" && (
                      <Badge className="uppercase tracking-wider">Preview</Badge>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                data-testid="catalog-drawer-close"
                onClick={() => setSelectedId(null)}
                className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <p className="text-sm leading-relaxed text-fg-muted" data-testid="catalog-drawer-description">
                {selected.description}
              </p>

              {/* Tracked output signals */}
              {selected.metrics && selected.metrics.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">
                    Tracked Signals & Outputs
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.metrics.map((metric) => (
                      <span
                        key={metric}
                        className="rounded-md border border-border/60 bg-surface px-2.5 py-1 text-xs font-medium text-fg"
                      >
                        {metric}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Contextual Usage Report notice (shown only where relevant) */}
              {selected.usageConcealmentNote && (
                <div
                  className="rounded-lg border border-border/60 border-l-2 border-l-accent/70 bg-surface px-3.5 py-2.5 text-xs text-fg-muted"
                  data-testid="usage-reports-notice"
                >
                  <p className="font-semibold text-fg">Name concealment note</p>
                  <p className="mt-1 leading-relaxed">
                    Microsoft hashes user, group, and site names in M365 usage CSVs by default. Uncheck{" "}
                    <span className="font-medium text-fg">“Display concealed user, group, and site names”</span> in M365 Admin → Org settings → Reports to display real names.
                  </p>
                </div>
              )}

              {/* Live Graph Permissions status */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">
                    Read-Only Graph Permissions
                  </p>
                  {selected.requiredPermissions.some((p) => missingSet.has(p)) && (
                    <Link href="/settings/integrations" className="text-[11px] font-medium text-primary hover:underline">
                      Grant in Integrations →
                    </Link>
                  )}
                </div>
                {selected.requiredPermissions.length === 0 ? (
                  <p className="text-xs text-fg-muted">None required</p>
                ) : (
                  <div className="space-y-1.5" data-testid="catalog-drawer-perms">
                    {selected.requiredPermissions.map((p) => {
                      const isMissing = missingSet.has(p);
                      const isGranted = permStatus === "ok" && !p.startsWith("(");
                      return (
                        <div
                          key={p}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-surface px-2.5 py-1.5 text-xs"
                        >
                          <code className="truncate font-mono text-[11px] text-fg">{p}</code>
                          {isMissing ? (
                            <span className="shrink-0 text-[10px] font-semibold text-warning">Missing</span>
                          ) : isGranted ? (
                            <span className="shrink-0 text-[10px] font-semibold text-success">✓ Granted</span>
                          ) : (
                            <span className="shrink-0 text-[10px] text-fg-muted">Required</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Plugin Specification Grid */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/50 bg-surface p-3.5 text-xs">
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Recommended cadence</span>
                  <span className="mt-0.5 block font-medium capitalize text-fg">
                    {selected.recommendedSchedule ?? "weekly"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Data source</span>
                  <span className="mt-0.5 block font-medium text-fg">
                    {DATA_SOURCE_BADGE[selected.dataSource ?? "graph-v1"].long}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Baseline diffing</span>
                  <span className="mt-0.5 block font-medium text-fg">
                    {selected.baselineSupport ? "Enabled (delta alerts)" : "Snapshot only"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Plugin ID</span>
                  <code className="mt-0.5 block truncate font-mono text-[11px] text-fg">{selected.id}</code>
                </div>
                {selected.recommendedGroup && (
                  <div className="col-span-2 border-t border-border/40 pt-2">
                    <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Default recipient group</span>
                    <span className="mt-0.5 block font-medium text-fg">{selected.recommendedGroup}</span>
                  </div>
                )}
              </div>

              {/* Scheduled jobs using this report */}
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">
                  Scheduled jobs ({jobsByReport[selected.id]?.length ?? 0})
                </p>
                {(jobsByReport[selected.id]?.length ?? 0) === 0 ? (
                  <p className="text-xs text-fg-muted">Not scheduled yet — enable in 1 click below or customize cadence.</p>
                ) : (
                  <div className="divide-y divide-border/40 rounded-lg border border-border/50 bg-surface">
                    {jobsByReport[selected.id]!.map((j) => (
                      <div key={j.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <span className="truncate font-medium text-fg">{j.name}</span>
                        <Link href={`/jobs/${j.id}/edit`} className="shrink-0 text-[11px] font-medium text-primary hover:underline">
                          Edit →
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selected.tags && selected.tags.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">
                    Tags
                  </p>
                  <div className="flex flex-wrap gap-1.5" data-testid="catalog-drawer-tags">
                    {selected.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {enableMsg && (
                <p className={`text-xs ${enableMsg.ok ? "text-success" : "text-danger"}`}>
                  {enableMsg.ok ? "✓ " : "! "}
                  {enableMsg.text}
                  {enableMsg.href && (
                    <>
                      {" "}
                      <a href={enableMsg.href} className="font-medium underline">Fix it →</a>
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-border/50 px-5 py-4">
              {selected.id !== "manual-graph-query" && (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  disabled={enabling}
                  onClick={() => void quickEnable(selected)}
                  className="flex-1 whitespace-nowrap"
                  data-testid="catalog-drawer-quick-enable"
                >
                  {enabling ? "Enabling…" : "Quick enable"}
                </Button>
              )}
              <LinkButton
                href={`/jobs/new?report=${selected.id}`}
                variant="primary"
                size="md"
                className="flex-1 whitespace-nowrap"
                data-testid="catalog-drawer-create"
              >
                Create job
              </LinkButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
