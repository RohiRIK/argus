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
import { IconCatalog, IconClose, IconCloud, IconKey, IconShield } from "@/components/icons";
import { cn } from "@/lib/utils";

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
};

export type CatalogJobRef = {
  id: string;
  name: string;
  status: string;
};

type IconCmp = (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;

const CATEGORY: Record<string, { Icon: IconCmp; wash: string }> = {
  identity: { Icon: IconKey, wash: "bg-info/10 text-info" },
  security: { Icon: IconShield, wash: "bg-danger/10 text-danger" },
  infrastructure: { Icon: IconCloud, wash: "bg-success/10 text-success" },
  custom: { Icon: IconCatalog, wash: "bg-accent/10 text-accent" },
};

const CATEGORIES = ["all", "identity", "security", "infrastructure", "custom"] as const;
const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
  all: "All",
  identity: "Identity",
  security: "Security",
  infrastructure: "Infrastructure",
  custom: "Custom",
};

type CategoryFilter = (typeof CATEGORIES)[number];
type ViewMode = "cards" | "list";

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
          ? "border-primary/40 bg-primary/10 text-fg"
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
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [unscheduledOnly, setUnscheduledOnly] = useState(false);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [gapOnly, setGapOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [jobsByReport, setJobsByReport] = useState<Record<string, CatalogJobRef[]>>(initialJobsByReport);
  const [enabling, setEnabling] = useState(false);
  const [enableMsg, setEnableMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

  const scheduledReportCount = useMemo(
    () => reports.filter((r) => (jobsByReport[r.id]?.length ?? 0) > 0).length,
    [reports, jobsByReport],
  );

  const hasPreviewReports = useMemo(() => reports.some((r) => r.maturity === "preview"), [reports]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      if (category !== "all" && r.category !== category) return false;
      if (previewOnly && r.maturity !== "preview") return false;
      if (unscheduledOnly && (jobsByReport[r.id]?.length ?? 0) > 0) return false;

      if (gapOnly) {
        if (r.requiredPermissions.length === 0) return false;
        if (!r.requiredPermissions.some((p) => missingSet.has(p))) return false;
      }

      if (q) {
        const hay = [r.name, r.description, r.id, ...(r.tags ?? [])].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [reports, query, category, previewOnly, unscheduledOnly, gapOnly, missingSet, jobsByReport]);

  const selected = selectedId ? reports.find((r) => r.id === selectedId) ?? null : null;

  const anyFilter =
    query.trim() !== "" || category !== "all" || unscheduledOnly || previewOnly || gapOnly;

  function clearFilters() {
    setQuery("");
    setCategory("all");
    setUnscheduledOnly(false);
    setPreviewOnly(false);
    setGapOnly(false);
  }

  function openDrawer(id: string) {
    setSelectedId(id);
    setEnableMsg(null);
  }

  async function quickEnable(report: CatalogReport) {
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
        setEnableMsg({
          ok: true,
          text: `Scheduled "${body.data.name}" (${report.recommendedSchedule ?? "weekly"}).`,
        });
      } else {
        setEnableMsg({ ok: false, text: body.error?.message ?? "Could not enable report." });
      }
    } finally {
      setEnabling(false);
    }
  }

  function readinessFor(r: CatalogReport): { label: string; hasGap: boolean } {
    const concrete = r.requiredPermissions.filter((p) => !p.startsWith("("));
    if (concrete.length === 0) return { label: "Custom scope", hasGap: false };
    const missingCount = concrete.filter((p) => missingSet.has(p)).length;
    if (missingCount > 0) {
      return {
        label: `${missingCount} missing scope${missingCount === 1 ? "" : "s"}`,
        hasGap: true,
      };
    }
    const prefix = permStatus === "ok" ? "Ready" : `${concrete.length} scope${concrete.length === 1 ? "" : "s"}`;
    return {
      label: permStatus === "ok" ? `${prefix} · ${concrete.length} scope${concrete.length === 1 ? "" : "s"}` : prefix,
      hasGap: false,
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
      {/* Compact top summary + view switch */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg" data-testid="catalog-count">
            {filtered.length === reports.length
              ? `${reports.length} report plugins`
              : `${filtered.length} of ${reports.length} report plugins`}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {scheduledReportCount} active in schedule · Click any report to inspect scopes or 1-click enable.
            {quarantinedCount > 0 && ` · ${quarantinedCount} quarantined`}
          </p>
        </div>
        <Segmented<ViewMode>
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: "cards", label: "Cards" },
            { value: "list", label: "List" },
          ]}
        />
      </div>

      {/* Single-band Operator toolbar */}
      <div className="mb-5 space-y-2.5 rounded-lg border border-border/60 bg-surface p-3" data-testid="catalog-toolbar">
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plugins by name, id, or tag…"
            data-testid="catalog-search"
            className="h-9 min-w-[220px] flex-1 sm:max-w-xs"
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

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
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
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3" data-testid="catalog-grid">
          {filtered.map((r) => {
            const { Icon, wash } = CATEGORY[r.category] ?? CATEGORY.custom;
            const jobCount = jobsByReport[r.id]?.length ?? 0;
            const readiness = readinessFor(r);

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
                className="group flex h-full cursor-pointer flex-col gap-3 rounded-lg border border-border/70 bg-surface p-4 shadow-sm transition-all duration-150 hover:border-primary/40 hover:bg-surface-2/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${wash}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {jobCount > 0 && (
                      <span
                        className="inline-flex items-center rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
                        data-testid={`catalog-active-${r.id}`}
                      >
                        {jobCount} active
                      </span>
                    )}
                    {r.maturity === "preview" && (
                      <Badge data-testid={`catalog-preview-${r.id}`} className="uppercase tracking-wider">
                        Preview
                      </Badge>
                    )}
                    <BadgeCategory category={r.category} />
                  </div>
                </div>

                <div className="flex-1 space-y-1">
                  <h3 className="text-sm font-semibold leading-snug text-fg">{r.name}</h3>
                  <p className="line-clamp-2 text-xs leading-relaxed text-fg-muted">{r.description}</p>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2.5 text-[11px]">
                  <span className={readiness.hasGap ? "font-medium text-warning" : "text-fg-muted"}>
                    {readiness.hasGap ? `! ${readiness.label}` : readiness.label}
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
        <div className="overflow-hidden rounded-lg border border-border/70 bg-surface" data-testid="catalog-list">
          <div className="divide-y divide-border/50">
            {filtered.map((r) => {
              const jobCount = jobsByReport[r.id]?.length ?? 0;
              const readiness = readinessFor(r);
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
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-fg">{r.name}</span>
                      <BadgeCategory category={r.category} />
                      {jobCount > 0 && (
                        <span className="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                          {jobCount} active
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-fg-muted">{r.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className={`font-mono text-[11px] ${readiness.hasGap ? "text-warning" : "text-fg-muted"}`}>
                      {readiness.label}
                    </span>
                    <Link
                      href={`/jobs/new?report=${r.id}`}
                      data-testid={`catalog-create-${r.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-primary hover:underline"
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

      {/* Actionable plugin detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={selected.name} data-testid="catalog-drawer">
          <button
            type="button"
            aria-label="Close detail"
            onClick={() => setSelectedId(null)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            data-testid="catalog-drawer-backdrop"
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border/70 bg-bg shadow-elevated animate-fade-in">
            <div className="flex items-start justify-between gap-3 border-b border-border/50 px-5 py-4">
              <div className="min-w-0 space-y-2">
                <h2 className="text-base font-semibold text-fg" data-testid="catalog-drawer-name">
                  {selected.name}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <BadgeCategory category={selected.category} />
                  {selected.version && (
                    <Badge className="font-mono text-[10px]">v{selected.version}</Badge>
                  )}
                  <Badge className="text-[10px]">
                    {selected.source === "declarative" ? "Custom YAML/JSON" : "Built-in plugin"}
                  </Badge>
                  {selected.maturity === "preview" && (
                    <Badge className="uppercase tracking-wider">Preview</Badge>
                  )}
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

              {/* Plugin defaults */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/50 bg-surface p-3 text-xs">
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Recommended cadence</span>
                  <span className="mt-0.5 block font-medium capitalize text-fg">
                    {selected.recommendedSchedule ?? "weekly"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Baseline support</span>
                  <span className="mt-0.5 block font-medium text-fg">
                    {selected.baselineSupport ? "Enabled" : "Not applicable"}
                  </span>
                </div>
                {selected.recommendedGroup && (
                  <div className="col-span-2">
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
                  {enableMsg.ok ? "✓ " : "✕ "}
                  {enableMsg.text}
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
