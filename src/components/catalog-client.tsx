"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { useToast } from "@/components/ui/toast";
import {
  CreatePolicyDialog,
  RISK_CLS,
  automationApi,
  type AutomationIntegrationInfo,
  type CatalogAutomationItem,
} from "@/components/automations-client";
import { cn } from "@/lib/utils";
import {
  CATALOG_CATEGORIES,
  automatedStateLabel,
  automationsByPairedReport,
  catalogItemKey,
  catalogState,
  countCatalogItems,
  filterCatalogItems,
  mergeCatalogItems,
  sortCatalogItems,
  type CatalogCategory,
  type CatalogItem,
  type CatalogItemType,
  type CatalogReportInput,
  type CatalogRunnerRef,
  type CatalogSortMode,
  type CatalogState,
  type CatalogStateFilter,
  type CatalogTypeFilter,
} from "@/lib/catalog-items";
import type { PluginDataSource } from "@/services/reports/types";

export type CatalogReport = CatalogReportInput;
/** A job that runs a report (or a policy that runs an automation). */
export type CatalogJobRef = CatalogRunnerRef;

type ViewMode = "cards" | "list";
type CategoryFilter = "all" | CatalogCategory;

const STATE_META: Record<CatalogState, { label: string; cls: string; dot: string }> = {
  automated: { label: "Automated", cls: "border-success/35 bg-success/10 text-success", dot: "bg-success" },
  paused: { label: "Paused", cls: "border-warning/35 bg-warning/10 text-warning", dot: "bg-warning" },
  available: { label: "Not set up", cls: "border-border/70 bg-surface-2/60 text-fg-muted", dot: "bg-fg-muted/60" },
};

const TYPE_META: Record<CatalogItemType, { label: string; plural: string; cls: string; title: string }> = {
  report: {
    label: "Report",
    plural: "Reports",
    cls: "border-info/30 bg-info/10 text-info",
    title: "Read-only report — never changes your tenant",
  },
  automation: {
    label: "Automation",
    plural: "Automations",
    cls: "border-primary/35 bg-primary/10 text-primary",
    title: "Automation — can change your tenant (starts in Audit mode)",
  },
};

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

/** Report solution packs (quick-enable each report as a scheduled job). */
const REPORT_SOLUTION_PACKS: readonly { id: string; name: string; tagline: string; reportIds: string[] }[] = [
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

export type CatalogAutomationPack = { id: string; name: string; tagline: string; automationIds: string[] };

/** A report pack or an automation pack, keyed so both live in one strip. */
type CatalogPack = {
  key: string;
  id: string;
  type: CatalogItemType;
  name: string;
  tagline: string;
  /** Catalog item keys (`report:<id>` / `automation:<id>`). */
  itemKeys: string[];
};

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


/** Collapsible filter group: native <details>, so it opens/closes without state. */
function FacetSection({
  title,
  open = false,
  testId,
  children,
}: {
  title: string;
  open?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="group/facet border-b border-border/40 py-1" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-1 py-1.5 text-xs font-semibold text-fg hover:text-fg [&::-webkit-details-marker]:hidden">
        {title}
        <span aria-hidden className="text-[10px] text-fg-muted transition-transform group-open/facet:rotate-90">
          ›
        </span>
      </summary>
      <div className="space-y-0.5 pb-1.5">{children}</div>
    </details>
  );
}

/** One selectable filter value; clicking the active one clears it (except "Everything"). */
function FacetRow({
  active,
  onClick,
  label,
  count,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
        active ? "bg-primary/12 font-medium text-fg" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "h-3 w-3 shrink-0 rounded-[3px] border",
            active ? "border-primary bg-primary" : "border-border",
          )}
        />
        <span className="truncate">{label}</span>
      </span>
      {count !== undefined && <span className="font-mono text-[10px] opacity-70">{count}</span>}
    </button>
  );
}

function TypeTag({ item }: { item: CatalogItem }) {
  const meta = TYPE_META[item.type];
  return (
    <span
      data-testid={`catalog-type-tag-${item.id}`}
      data-type={item.type}
      title={meta.title}
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.cls)}
    >
      {meta.label}
    </span>
  );
}

function RiskBadge({ item }: { item: CatalogItem }) {
  if (!item.riskLevel) return null;
  return (
    <Badge className={cn("capitalize", RISK_CLS[item.riskLevel])} data-testid={`catalog-risk-${item.id}`}>
      {item.riskLevel} risk
    </Badge>
  );
}

/** Inline text link that switches the drawer to another catalog item (does not bubble to the card). */
function ItemLink({
  label,
  onOpen,
  testId,
}: {
  label: string;
  onOpen: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="font-medium text-primary hover:underline"
    >
      {label}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">{children}</p>;
}

function formatParamDefault(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  if (typeof value === "boolean") return value ? "On" : "Off";
  return String(value);
}

export function CatalogClient({
  reports,
  initialJobsByReport = {},
  automations = [],
  policiesByAutomation = {},
  automationPacks = [],
  automationIntegration = null,
  recipientGroups = [],
  initialType = "all",
  quarantinedCount = 0,
}: {
  reports: CatalogReport[];
  initialJobsByReport?: Record<string, CatalogJobRef[]>;
  automations?: CatalogAutomationItem[];
  /** Automation policies grouped by automation id (from the server; refreshed via router.refresh()). */
  policiesByAutomation?: Record<string, CatalogRunnerRef[]>;
  automationPacks?: CatalogAutomationPack[];
  automationIntegration?: AutomationIntegrationInfo | null;
  recipientGroups?: { id: string; name: string }[];
  initialType?: CatalogTypeFilter;
  quarantinedCount?: number;
}) {
  const router = useRouter();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilterState] = useState<CatalogTypeFilter>(initialType);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [activePackKey, setActivePackKey] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<CatalogSortMode>("recommended");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [stateFilter, setStateFilter] = useState<CatalogStateFilter>("all");
  const [previewOnly, setPreviewOnly] = useState(false);
  const [gapOnly, setGapOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState<CatalogAutomationItem | null>(null);

  const [jobsByReport, setJobsByReport] = useState<Record<string, CatalogJobRef[]>>(initialJobsByReport);
  const [enabling, setEnabling] = useState(false);
  const [enableMsg, setEnableMsg] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const [enablingPackKey, setEnablingPackKey] = useState<string | null>(null);
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

  /** Change the type filter and mirror it in the URL (`/catalog?type=…`) without a navigation. */
  function setTypeFilter(next: CatalogTypeFilter) {
    setTypeFilterState(next);
    setActivePackKey(null);
    try {
      const url = new URL(window.location.href);
      if (next === "all") url.searchParams.delete("type");
      else url.searchParams.set("type", next);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    } catch {
      /* URL sync is a convenience only */
    }
  }

  const reportMissingSet = useMemo(() => new Set(missing), [missing]);
  const automationMissingSet = useMemo(
    () => new Set(automationIntegration?.missingScopes ?? []),
    [automationIntegration],
  );
  const automationGrantedSet = useMemo(
    () => new Set(automationIntegration?.grantedScopes ?? []),
    [automationIntegration],
  );

  const items = useMemo(() => mergeCatalogItems(reports, automations), [reports, automations]);
  const itemByKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const reportById = useMemo(() => new Map(reports.map((r) => [r.id, r])), [reports]);
  const automationById = useMemo(() => new Map(automations.map((a) => [a.id, a])), [automations]);
  const pairedAutomations = useMemo(() => automationsByPairedReport(automations), [automations]);

  const runnersOf = useMemo(
    () => (item: CatalogItem): CatalogRunnerRef[] =>
      (item.type === "report" ? jobsByReport[item.id] : policiesByAutomation[item.id]) ?? [],
    [jobsByReport, policiesByAutomation],
  );
  const stateOf = useMemo(() => (item: CatalogItem) => catalogState(runnersOf(item)), [runnersOf]);
  const missingFor = (item: CatalogItem) => (item.type === "report" ? reportMissingSet : automationMissingSet);
  const hasGap = (item: CatalogItem) => item.requiredPermissions.some((p) => missingFor(item).has(p));

  const counts = useMemo(() => countCatalogItems(items, stateOf), [items, stateOf]);
  /** Category / state / service chip counts follow the type filter so the numbers match the grid. */
  const typedItems = useMemo(
    () => (typeFilter === "all" ? items : items.filter((i) => i.type === typeFilter)),
    [items, typeFilter],
  );
  const typedCounts = useMemo(() => countCatalogItems(typedItems, stateOf), [typedItems, stateOf]);

  const serviceCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of typedItems) c.set(i.service, (c.get(i.service) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [typedItems]);

  const packs = useMemo<CatalogPack[]>(
    () => [
      ...REPORT_SOLUTION_PACKS.map((p) => ({
        key: `report-pack:${p.id}`,
        id: p.id,
        type: "report" as const,
        name: p.name,
        tagline: p.tagline,
        itemKeys: p.reportIds.map((id) => catalogItemKey("report", id)),
      })),
      ...automationPacks.map((p) => ({
        key: `automation-pack:${p.id}`,
        id: p.id,
        type: "automation" as const,
        name: p.name,
        tagline: p.tagline,
        itemKeys: p.automationIds.map((id) => catalogItemKey("automation", id)),
      })),
    ],
    [automationPacks],
  );
  const visiblePacks = typeFilter === "all" ? packs : packs.filter((p) => p.type === typeFilter);
  const activePack = activePackKey ? packs.find((p) => p.key === activePackKey) ?? null : null;

  const hasPreviewItems = useMemo(() => items.some((i) => i.maturity === "preview"), [items]);
  const reportGapVisible = permStatus !== "loading" && permStatus !== "ok" && missing.length > 0;
  const showGapToggle = reportGapVisible || automationMissingSet.size > 0;

  const filtered = useMemo(() => {
    const base = filterCatalogItems(
      items,
      {
        query,
        type: typeFilter,
        category,
        service: serviceFilter,
        state: stateFilter,
        keys: activePack ? new Set(activePack.itemKeys) : null,
        previewOnly,
      },
      stateOf,
    ).filter((i) => !gapOnly || hasGap(i));
    return sortCatalogItems(base, sortMode, (i) => runnersOf(i).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    items,
    query,
    typeFilter,
    category,
    serviceFilter,
    stateFilter,
    activePack,
    previewOnly,
    gapOnly,
    sortMode,
    stateOf,
    runnersOf,
    reportMissingSet,
    automationMissingSet,
  ]);

  const selected = selectedKey ? itemByKey.get(selectedKey) ?? null : null;

  // The type filter is the page's mode (deep-linked), so it does not count as a "filter" that hides the packs.
  const anyFilter =
    query.trim() !== "" ||
    category !== "all" ||
    serviceFilter !== "all" ||
    activePackKey !== null ||
    stateFilter !== "all" ||
    previewOnly ||
    gapOnly;

  function clearFilters() {
    setQuery("");
    setCategory("all");
    setServiceFilter("all");
    setActivePackKey(null);
    setStateFilter("all");
    setPreviewOnly(false);
    setGapOnly(false);
  }

  function openDrawer(key: string) {
    setSelectedKey(key);
    setEnableMsg(null);
  }

  async function quickEnable(report: CatalogItem): Promise<{ ok: boolean; error?: string }> {
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
            : { ok: true, text: `Scheduled "${body.data.name}" (${report.recommendedSchedule}).` },
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

  async function enableReportPack(pack: CatalogPack) {
    const remaining = pack.itemKeys
      .map((k) => itemByKey.get(k))
      .filter((i): i is CatalogItem => Boolean(i) && (jobsByReport[i!.id]?.length ?? 0) === 0)
      .map((i) => i.id);
    if (remaining.length === 0) return;

    setEnablingPackKey(pack.key);
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
        setPackMsg({ ok: true, text: `Enabled ${enabledCount} report${enabledCount === 1 ? "" : "s"} from "${pack.name}".` });
      } else if (enabledCount > 0) {
        setPackMsg({ ok: false, text: `Enabled ${enabledCount}/${remaining.length} reports in "${pack.name}": ${firstError}` });
      } else {
        setPackMsg({ ok: false, text: firstError || "Could not enable pack reports." });
      }
    } finally {
      setEnablingPackKey(null);
    }
  }

  /** Automation packs keep using POST /api/automations { packId, mode: "audit" } (skips automations already set up). */
  async function deployAutomationPack(pack: CatalogPack) {
    setEnablingPackKey(pack.key);
    setPackMsg(null);
    try {
      await automationApi("/api/automations", {
        method: "POST",
        body: JSON.stringify({ packId: pack.id, mode: "audit" }),
      });
      setPackMsg({ ok: true, text: `Deployed "${pack.name}" in Audit mode — nothing changes until you enforce.` });
      router.refresh();
    } catch (err) {
      setPackMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setEnablingPackKey(null);
    }
  }

  async function createPolicy(body: Record<string, unknown>) {
    try {
      await automationApi("/api/automations", { method: "POST", body: JSON.stringify(body) });
      toast.push("Automation set up in Audit mode — it reports what it would change and changes nothing.", "success");
      setCreating(null);
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "danger");
    }
  }

  function startSetup(item: CatalogItem) {
    const def = automationById.get(item.id);
    if (def) setCreating(def);
  }

  function readinessFor(item: CatalogItem): { label: string; hasGap: boolean; ready: boolean } {
    if (item.type === "automation") {
      const n = item.requiredPermissions.length;
      const scopes = `${n} write scope${n === 1 ? "" : "s"}`;
      if (automationIntegration && !automationIntegration.configured) {
        return { label: "Automation app not connected", hasGap: true, ready: false };
      }
      const missingCount = item.requiredPermissions.filter((p) => automationMissingSet.has(p)).length;
      if (missingCount > 0) {
        return { label: `${missingCount} missing scope${missingCount === 1 ? "" : "s"}`, hasGap: true, ready: false };
      }
      const ready = automationIntegration?.status === "connected";
      return { label: ready ? `Ready · ${scopes}` : scopes, hasGap: false, ready };
    }
    const concrete = item.requiredPermissions.filter((p) => !p.startsWith("("));
    if (concrete.length === 0) return { label: "Custom scope", hasGap: false, ready: true };
    const missingCount = concrete.filter((p) => reportMissingSet.has(p)).length;
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

  // Esc + body scroll lock while drawer open (Esc is left to the setup dialog while it is open).
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creating) setSelectedKey(null);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [selected, creating]);

  function renderStateTag(item: CatalogItem, compact = false) {
    const runners = runnersOf(item);
    const state = catalogState(runners);
    const noun = item.type === "automation" ? "polic" : "job";
    const label = compact || state !== "automated" ? STATE_META[state].label : automatedStateLabel(runners);
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATE_META[state].cls}`}
        data-testid={compact ? undefined : `catalog-kind-tag-${item.id}`}
        data-kind={state}
        title={
          state === "automated"
            ? runners
                .filter((r) => r.status === "active")
                .map((r) => `${r.name}${r.mode ? ` — ${r.mode === "enforce" ? "Enforce" : "Audit"}` : ""}${r.schedule ? ` — ${r.schedule}` : ""}`)
                .join("\n")
            : state === "paused"
              ? `${runners.length} paused ${noun}${noun === "polic" ? (runners.length === 1 ? "y" : "ies") : runners.length === 1 ? "" : "s"}`
              : item.type === "automation"
                ? "Not set up yet — set it up to run in Audit mode first"
                : "Not automated yet — set up a job to run it on a schedule"
        }
      >
        {!compact && <span className={`h-1.5 w-1.5 rounded-full ${STATE_META[state].dot}`} />}
        {label}
      </span>
    );
  }

  function renderPairingLine(item: CatalogItem) {
    if (item.type === "report") {
      const autos = pairedAutomations.get(item.id) ?? [];
      if (autos.length === 0) return null;
      return (
        <p className="truncate text-[11px] text-fg-muted" data-testid={`catalog-pairing-${item.id}`}>
          Can be automated:{" "}
          <ItemLink
            label={autos[0].name}
            onOpen={() => openDrawer(catalogItemKey("automation", autos[0].id))}
            testId={`catalog-automate-link-${item.id}`}
          />
          {autos.length > 1 && <span> +{autos.length - 1} more</span>}
        </p>
      );
    }
    const report = item.pairedReportId ? reportById.get(item.pairedReportId) : undefined;
    if (!report) return null;
    return (
      <p className="truncate text-[11px] text-fg-muted" data-testid={`catalog-pairing-${item.id}`}>
        Based on report:{" "}
        <ItemLink
          label={report.name}
          onOpen={() => openDrawer(catalogItemKey("report", report.id))}
          testId={`catalog-report-link-${item.id}`}
        />
      </p>
    );
  }

  function renderPrimaryCta(item: CatalogItem, list = false) {
    if (item.type === "automation") {
      return (
        <button
          type="button"
          data-testid={`catalog-setup-${item.id}`}
          onClick={(e) => {
            e.stopPropagation();
            startSetup(item);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={
            list
              ? "font-sans font-medium text-primary hover:underline"
              : "inline-flex items-center gap-1 font-medium text-fg-muted transition-colors hover:text-accent group-hover:text-accent"
          }
        >
          <span>Set up</span>
          <span className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
        </button>
      );
    }
    return (
      <Link
        href={`/jobs/new?report=${item.id}`}
        data-testid={`catalog-create-${item.id}`}
        onClick={(e) => e.stopPropagation()}
        className={
          list
            ? "font-sans font-medium text-primary hover:underline"
            : "inline-flex items-center gap-1 font-medium text-fg-muted transition-colors hover:text-accent group-hover:text-accent"
        }
      >
        <span>Create job</span>
        <span className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
      </Link>
    );
  }

  const selectedRunners = selected ? runnersOf(selected) : [];
  const selectedAutomation = selected?.type === "automation" ? automationById.get(selected.id) ?? null : null;
  const selectedReport = selected?.type === "report" ? reportById.get(selected.id) ?? null : null;

  return (
    <>
      {/* Marketplace summary + sort & layout switch */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg" data-testid="catalog-count">
            {filtered.length === items.length
              ? `${items.length} catalog items`
              : `${filtered.length} of ${items.length} catalog items`}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {counts.types.report} read-only reports · {counts.types.automation} automations · {counts.states.automated}{" "}
            automated
            {quarantinedCount > 0 && ` · ${quarantinedCount} quarantined`}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <select
            aria-label="Sort catalog"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as CatalogSortMode)}
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

      {/* Curated Solution Packs shelf (report packs + automation packs) */}
      {!anyFilter && visiblePacks.length > 0 && (
        <section className="mb-5" data-testid="catalog-packs" aria-label="Curated solution packs">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Solution Packs</h2>
              <p className="text-[11px] text-fg-muted/80">
                Report packs schedule read-only reports; automation packs add policies in Audit mode (no changes until you
                enforce).
              </p>
            </div>
            {packMsg && (
              <p className={`text-xs font-medium ${packMsg.ok ? "text-success" : "text-warning"}`} data-testid="catalog-pack-msg">
                {packMsg.ok ? "✓ " : "! "}
                {packMsg.text}
              </p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {visiblePacks.map((pack) => {
              const packItems = pack.itemKeys
                .map((k) => itemByKey.get(k))
                .filter((i): i is CatalogItem => Boolean(i));
              const activeInPack = packItems.filter((i) => runnersOf(i).length > 0).length;
              const remainingCount = packItems.length - activeInPack;
              const pct = packItems.length > 0 ? Math.round((activeInPack / packItems.length) * 100) : 0;
              const isBusy = enablingPackKey === pack.key;
              const isAutomation = pack.type === "automation";

              return (
                <div
                  key={pack.key}
                  data-testid={`catalog-pack-${pack.id}`}
                  data-pack-type={pack.type}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-surface p-3.5 transition-colors hover:border-border"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center -space-x-1.5">
                        {packItems.slice(0, 4).map((item) => (
                          <span
                            key={item.key}
                            title={item.service || item.name}
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
                        {remainingCount === 0 ? "✓ All set up" : `${activeInPack}/${packItems.length} set up`}
                      </span>
                    </div>

                    <div>
                      <span
                        className={cn(
                          "mb-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          TYPE_META[pack.type].cls,
                        )}
                        data-testid={`catalog-pack-type-${pack.id}`}
                      >
                        {isAutomation ? "Automation pack" : "Report pack"}
                      </span>
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
                        onClick={() => setActivePackKey(pack.key)}
                        className="font-medium text-fg-muted transition-colors hover:text-fg"
                      >
                        View {packItems.length} {isAutomation ? "automations" : "reports"} →
                      </button>
                      {remainingCount > 0 && (
                        <button
                          type="button"
                          disabled={enablingPackKey !== null}
                          data-testid={`catalog-pack-enable-${pack.id}`}
                          onClick={() => void (isAutomation ? deployAutomationPack(pack) : enableReportPack(pack))}
                          className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                        >
                          {isBusy
                            ? isAutomation
                              ? "Deploying…"
                              : "Enabling…"
                            : isAutomation
                              ? `Deploy ${remainingCount} (Audit)`
                              : `Enable ${remainingCount}`}
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

      {/* Filter rail (collapsible sections) + results */}
      <div className="lg:grid lg:grid-cols-[208px_minmax(0,1fr)] lg:items-start lg:gap-6">
        <aside className="mb-5 space-y-1 lg:sticky lg:top-4 lg:mb-0" data-testid="catalog-toolbar" aria-label="Filters">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Filters</span>
            {anyFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] font-medium text-primary hover:underline"
                data-testid="toolbar-clear-filters"
              >
                Reset
              </button>
            )}
          </div>

          <FacetSection title="Type" open testId="catalog-type-chips">
            {(["all", "report", "automation"] as const).map((t) => (
              <FacetRow
                key={t}
                active={typeFilter === t}
                onClick={() => setTypeFilter(t)}
                label={t === "all" ? "Everything" : TYPE_META[t].plural}
                count={counts.types[t]}
                testId={`catalog-type-${t}`}
              />
            ))}
          </FacetSection>

          <FacetSection title="Category" open testId="catalog-category-chips">
            {CATALOG_CATEGORIES.filter((c) => typedCounts.categories[c] > 0).map((c) => (
              <FacetRow
                key={c}
                active={category === c}
                onClick={() => setCategory((cur) => (cur === c ? "all" : c))}
                label={CATEGORY_LABEL[c]}
                count={typedCounts.categories[c]}
                testId={`catalog-category-${c}`}
              />
            ))}
          </FacetSection>

          <FacetSection title="Workload" open={serviceFilter !== "all"} testId="catalog-service-chips">
            {serviceCounts.map(([svc, count]) => (
              <FacetRow
                key={svc}
                active={serviceFilter === svc}
                onClick={() => setServiceFilter((cur) => (cur === svc ? "all" : svc))}
                label={svc.replace(/^Microsoft /, "")}
                count={count}
              />
            ))}
          </FacetSection>

          <FacetSection title="Status" open={stateFilter !== "all"} testId="catalog-kind-chips">
            {(["automated", "paused", "available"] as const).map((k) =>
              typedCounts.states[k] > 0 || k !== "paused" ? (
                <FacetRow
                  key={k}
                  active={stateFilter === k}
                  onClick={() => setStateFilter((cur) => (cur === k ? "all" : k))}
                  label={STATE_META[k].label}
                  count={typedCounts.states[k]}
                  testId={`catalog-kind-${k}`}
                />
              ) : null,
            )}
          </FacetSection>

          {(hasPreviewItems || showGapToggle) && (
            <FacetSection title="More" open={previewOnly || gapOnly}>
              {hasPreviewItems && (
                <FacetRow
                  active={previewOnly}
                  onClick={() => setPreviewOnly((v) => !v)}
                  label="Preview only"
                  testId="catalog-maturity-preview"
                />
              )}
              {showGapToggle && (
                <FacetRow
                  active={gapOnly}
                  onClick={() => setGapOnly((v) => !v)}
                  label="Missing permissions"
                  count={typedItems.filter(hasGap).length}
                  testId="catalog-gap-toggle"
                />
              )}
            </FacetSection>
          )}
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reports and automations…"
              data-testid="catalog-search"
              className="h-9 min-w-[200px] flex-1"
            />
            {activePack && (
              <Chip active onClick={() => setActivePackKey(null)} testId="catalog-pack-active">
                <span>Pack: {activePack.name}</span>
                <span className="font-mono text-[10px]">×</span>
              </Chip>
            )}
          </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing in the catalog matches"
          hint="Try clearing search or filters to see every report and automation."
          action={
            anyFilter ? (
              <Button variant="outline" size="sm" onClick={clearFilters} data-testid="clear-filters">
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : viewMode === "cards" ? (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" data-testid="catalog-grid">
          {filtered.map((item) => {
            const readiness = readinessFor(item);
            const cadence = CADENCE_LABEL[item.recommendedSchedule];
            const report = item.type === "report" ? reportById.get(item.id) : undefined;

            return (
              <div
                key={item.key}
                role="button"
                tabIndex={0}
                data-testid={`catalog-card-${item.id}`}
                data-item-type={item.type}
                data-category={item.category}
                onClick={() => openDrawer(item.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDrawer(item.key);
                  }
                }}
                className="group flex h-full cursor-pointer flex-col gap-2.5 rounded-xl border border-border/60 bg-surface p-4 transition-colors duration-150 hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* Title row: icon + name, with only the signals that matter at a glance on the right */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-surface-2/70 transition-colors group-hover:border-primary/35">
                      {/* Single SVG inside card tile (AC-UI9) */}
                      <WorkloadIcon icon={item.icon} className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold leading-snug text-fg">{item.name}</h3>
                      <p className="truncate text-[11px] text-fg-muted">
                        {TYPE_META[item.type].label} · {CATEGORY_LABEL[item.category]} · {item.service.replace(/^Microsoft /, "")}
                        {item.maturity === "preview" && (
                          <span data-testid={`catalog-preview-${item.id}`} className="ml-1.5 font-medium text-warning">
                            Preview
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <RiskBadge item={item} />
                    {catalogState(runnersOf(item)) !== "available" && renderStateTag(item)}
                  </div>
                </div>

                <p className="line-clamp-2 flex-1 text-xs leading-relaxed text-fg-muted">{item.description}</p>

                {renderPairingLine(item)}

                {/* One quiet meta line + CTA (CTA must not open the drawer) */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-fg-muted">
                  <span className="min-w-0 truncate">
                    {readiness.hasGap ? (
                      <span className="font-medium text-warning" title="Grant the missing permissions in Settings → Integrations">
                        {readiness.label}
                      </span>
                    ) : item.type === "automation" ? (
                      "Starts in Audit · makes changes"
                    ) : (
                      `${cadence} · ${report?.baselineSupport ? "tracks changes" : "snapshot"} · read-only`
                    )}
                  </span>
                  {renderPrimaryCta(item)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/75 bg-surface" data-testid="catalog-list">
          <div className="divide-y divide-border/50">
            {filtered.map((item) => {
              const readiness = readinessFor(item);
              const dataSource = DATA_SOURCE_BADGE[item.dataSource];
              const cadence = CADENCE_LABEL[item.recommendedSchedule];
              return (
                <div
                  key={item.key}
                  role="button"
                  tabIndex={0}
                  data-testid={`catalog-row-${item.id}`}
                  data-item-type={item.type}
                  onClick={() => openDrawer(item.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openDrawer(item.key);
                    }
                  }}
                  className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs transition-colors hover:bg-surface-2/30"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-surface-2/70">
                      <WorkloadIcon icon={item.icon} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-fg">{item.name}</span>
                        <span className="text-[11px] text-fg-muted">
                          {CATEGORY_LABEL[item.category]} · {item.service}
                        </span>
                        <RiskBadge item={item} />
                        {catalogState(runnersOf(item)) !== "available" && renderStateTag(item, true)}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-fg-muted">{item.description}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 font-mono text-[11px]">
                    <span className="hidden text-fg-muted md:inline">{cadence}</span>
                    <span className={cn("hidden sm:inline", dataSource.tone)}>{dataSource.short}</span>
                    <span className={readiness.hasGap ? "text-warning" : "text-fg-muted"}>{readiness.label}</span>
                    {renderPrimaryCta(item, true)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
        </div>
      </div>

      {/* Detail drawer (reports and automations) */}
      {selected && (
        <div
          className="fixed inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-label={selected.name}
          data-testid="catalog-drawer"
          data-item-type={selected.type}
        >
          <button
            type="button"
            aria-label="Close detail"
            onClick={() => setSelectedKey(null)}
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
                    {selected.service} · {selected.author}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <TypeTag item={selected} />
                    <RiskBadge item={selected} />
                    <BadgeCategory category={selected.category} />
                    {renderStateTag(selected)}
                    <Badge className="font-mono text-[10px]">v{selected.version}</Badge>
                    {selected.type === "report" ? (
                      <>
                        <Badge className="border-success/30 bg-success/10 text-[10px] text-success">✓ Verified Read-Only</Badge>
                        <Badge className="text-[10px]">
                          {selectedReport?.source === "declarative" ? "Custom YAML/JSON" : "Built-in plugin"}
                        </Badge>
                      </>
                    ) : (
                      <Badge className="border-warning/30 bg-warning/10 text-[10px] text-warning">Makes changes</Badge>
                    )}
                    {selected.maturity === "preview" && <Badge className="uppercase tracking-wider">Preview</Badge>}
                  </div>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                data-testid="catalog-drawer-close"
                onClick={() => setSelectedKey(null)}
                className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <p className="text-sm leading-relaxed text-fg-muted" data-testid="catalog-drawer-description">
                {selected.description}
              </p>

              {/* Report ↔ automation link */}
              {selected.type === "report" && (pairedAutomations.get(selected.id)?.length ?? 0) > 0 && (
                <div
                  className="rounded-lg border border-border/60 border-l-2 border-l-primary/70 bg-surface px-3.5 py-2.5 text-xs"
                  data-testid="catalog-drawer-automations"
                >
                  <p className="font-semibold text-fg">Can be automated</p>
                  <p className="mt-0.5 text-fg-muted">
                    This report finds the issues; an automation can fix them (Audit mode first).
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {pairedAutomations.get(selected.id)!.map((a) => (
                      <li key={a.id}>
                        <ItemLink
                          label={`${a.name} →`}
                          onOpen={() => openDrawer(catalogItemKey("automation", a.id))}
                          testId={`catalog-drawer-automation-link-${a.id}`}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {selected.type === "automation" && selected.pairedReportId && reportById.has(selected.pairedReportId) && (
                <div
                  className="rounded-lg border border-border/60 border-l-2 border-l-info/70 bg-surface px-3.5 py-2.5 text-xs"
                  data-testid="catalog-drawer-paired-report"
                >
                  <p className="text-fg-muted">
                    Based on report:{" "}
                    <ItemLink
                      label={reportById.get(selected.pairedReportId)!.name}
                      onOpen={() => openDrawer(catalogItemKey("report", selected.pairedReportId!))}
                      testId="catalog-drawer-report-link"
                    />
                  </p>
                </div>
              )}

              {selected.type === "automation" && automationIntegration && !automationIntegration.configured && (
                <div
                  className="rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-2.5 text-xs"
                  data-testid="catalog-drawer-automation-app"
                >
                  <p className="font-semibold text-fg">Automation app not connected</p>
                  <p className="mt-0.5 text-fg-muted">
                    Automations run through a separate write-capable Entra app, so your reporting app stays read-only.
                    You can set the policy up now; audit runs need the app.
                  </p>
                  <Link href="/settings/integrations" className="mt-1 inline-block font-medium text-primary hover:underline">
                    Connect in Integrations →
                  </Link>
                </div>
              )}

              {selected.metrics.length > 0 && (
                <div>
                  <SectionLabel>Tracked Signals &amp; Outputs</SectionLabel>
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

              {selectedReport?.usageConcealmentNote && (
                <div
                  className="rounded-lg border border-border/60 border-l-2 border-l-accent/70 bg-surface px-3.5 py-2.5 text-xs text-fg-muted"
                  data-testid="usage-reports-notice"
                >
                  <p className="font-semibold text-fg">Name concealment note</p>
                  <p className="mt-1 leading-relaxed">
                    Microsoft hashes user, group, and site names in M365 usage CSVs by default. Uncheck{" "}
                    <span className="font-medium text-fg">“Display concealed user, group, and site names”</span> in M365
                    Admin → Org settings → Reports to display real names.
                  </p>
                </div>
              )}

              {/* Graph permissions (read-only for reports; write for automations, on the automation app) */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">
                    {selected.type === "automation" ? "Graph Permissions (write · automation app)" : "Read-Only Graph Permissions"}
                  </p>
                  {hasGap(selected) && (
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
                      const isMissing = missingFor(selected).has(p);
                      const isGranted =
                        selected.type === "automation"
                          ? automationGrantedSet.has(p)
                          : permStatus === "ok" && !p.startsWith("(");
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

              {/* Automation parameters */}
              {selectedAutomation && selectedAutomation.paramSchema.length > 0 && (
                <div data-testid="catalog-drawer-params">
                  <SectionLabel>Parameters ({selectedAutomation.paramSchema.length})</SectionLabel>
                  <div className="divide-y divide-border/40 rounded-lg border border-border/50 bg-surface">
                    {selectedAutomation.paramSchema.map((f) => (
                      <div key={f.key} className="px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-fg">
                            {f.label}
                            {f.required && <span className="text-danger"> *</span>}
                          </span>
                          <code className="truncate font-mono text-[10px] text-fg-muted">
                            {formatParamDefault(selectedAutomation.defaultParams[f.key])}
                          </code>
                        </div>
                        <p className="mt-0.5 text-[11px] text-fg-muted">{f.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Specification grid */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/50 bg-surface p-3.5 text-xs">
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Recommended cadence</span>
                  <span className="mt-0.5 block font-medium capitalize text-fg">{selected.recommendedSchedule}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Data source</span>
                  <span className="mt-0.5 block font-medium text-fg">{DATA_SOURCE_BADGE[selected.dataSource].long}</span>
                </div>
                {selected.type === "automation" ? (
                  <>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Recommended mode</span>
                      <span className="mt-0.5 block font-medium text-fg" data-testid="catalog-drawer-mode">
                        {selected.recommendedMode === "enforce" ? "Enforce (after an audit)" : "Audit"}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Area</span>
                      <span className="mt-0.5 block font-medium capitalize text-fg">
                        {selected.subcategory.replace("-", " ")}
                      </span>
                    </div>
                  </>
                ) : (
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Baseline diffing</span>
                    <span className="mt-0.5 block font-medium text-fg">
                      {selectedReport?.baselineSupport ? "Enabled (delta alerts)" : "Snapshot only"}
                    </span>
                  </div>
                )}
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">
                    {selected.type === "automation" ? "Automation ID" : "Plugin ID"}
                  </span>
                  <code className="mt-0.5 block truncate font-mono text-[11px] text-fg">{selected.id}</code>
                </div>
                {selectedReport?.recommendedGroup && (
                  <div className="col-span-2 border-t border-border/40 pt-2">
                    <span className="block text-[10px] uppercase tracking-wider text-fg-muted/70">Default recipient group</span>
                    <span className="mt-0.5 block font-medium text-fg">{selectedReport.recommendedGroup}</span>
                  </div>
                )}
              </div>

              {/* Jobs (reports) / policies (automations) that run this item */}
              <div>
                <SectionLabel>
                  {selected.type === "automation" ? "Policies" : "Scheduled jobs"} ({selectedRunners.length})
                </SectionLabel>
                {selectedRunners.length === 0 ? (
                  <p className="text-xs text-fg-muted">
                    {selected.type === "automation"
                      ? "Not set up yet — new policies start in Audit mode and change nothing."
                      : "Not scheduled yet — enable in 1 click below or customize cadence."}
                  </p>
                ) : (
                  <div className="divide-y divide-border/40 rounded-lg border border-border/50 bg-surface">
                    {selectedRunners.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <span className="min-w-0 truncate font-medium text-fg">
                          {r.name}
                          <span className="ml-1.5 font-normal text-fg-muted">
                            {[
                              r.mode ? (r.mode === "enforce" ? "Enforce" : "Audit") : null,
                              r.schedule,
                              r.status !== "active" ? r.status : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <Link
                          href={selected.type === "automation" ? "/automations" : `/jobs/${r.id}/edit`}
                          className="shrink-0 text-[11px] font-medium text-primary hover:underline"
                        >
                          {selected.type === "automation" ? "Manage →" : "Edit →"}
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selected.tags.length > 0 && (
                <div>
                  <SectionLabel>Tags</SectionLabel>
                  <div className="flex flex-wrap gap-1.5" data-testid="catalog-drawer-tags">
                    {selected.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {enableMsg && selected.type === "report" && (
                <p className={`text-xs ${enableMsg.ok ? "text-success" : "text-danger"}`}>
                  {enableMsg.ok ? "✓ " : "! "}
                  {enableMsg.text}
                  {enableMsg.href && (
                    <>
                      {" "}
                      <a href={enableMsg.href} className="font-medium underline">
                        Fix it →
                      </a>
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-border/50 px-5 py-4">
              {selected.type === "automation" ? (
                <>
                  {selectedRunners.length > 0 && (
                    <LinkButton href="/automations" variant="secondary" size="md" className="flex-1 whitespace-nowrap">
                      View policies
                    </LinkButton>
                  )}
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    className="flex-1 whitespace-nowrap"
                    data-testid="catalog-drawer-setup"
                    onClick={() => startSetup(selected)}
                  >
                    Set up automation
                  </Button>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {creating && (
        <CreatePolicyDialog
          item={creating}
          recipientGroups={recipientGroups}
          onClose={() => setCreating(null)}
          onCreate={(body) => void createPolicy(body)}
        />
      )}
    </>
  );
}
