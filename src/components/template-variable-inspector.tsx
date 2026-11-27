"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type VariableGroup = "context" | "trend" | "block" | "report";

export interface VariableItem {
  name: string;
  group: VariableGroup;
  description: string;
  sample?: string;
  used: boolean;
}

interface TemplateVariableInspectorProps {
  items: VariableItem[];
  /** Display name of the report whose data feeds the preview / report-specific vars. */
  reportLabel?: string;
  /** True when editing a template shared by every report. */
  shared?: boolean;
  insertTargetLabel: string;
  onInsert: (name: string) => void;
}

const GROUPS: { id: VariableGroup; label: string; hint: string; token: string }[] = [
  {
    id: "context",
    label: "Context",
    hint: "Available in every report — subject, HTML and text.",
    token: "border-border/70 bg-surface-2 text-fg",
  },
  {
    id: "trend",
    label: "Trend",
    hint: "Baseline and run-over-run change, computed for every report.",
    token: "border-success/35 bg-success/10 text-success",
  },
  {
    id: "block",
    label: "Blocks",
    hint: "Pre-rendered sections (banners, results table). Body only — blank in the subject.",
    token: "border-info/35 bg-info/10 text-info",
  },
  {
    id: "report",
    label: "Report-specific",
    hint: "",
    token: "border-primary/35 bg-primary/10 text-primary",
  },
];

export function TemplateVariableInspector({
  items,
  reportLabel,
  shared = false,
  insertTargetLabel,
  onInsert,
}: TemplateVariableInspectorProps) {
  const [selectedTab, setSelectedTab] = useState<VariableGroup>("context");
  const [query, setQuery] = useState("");
  const [copiedName, setCopiedName] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<VariableGroup, { total: number; used: number }> = {
      context: { total: 0, used: 0 },
      trend: { total: 0, used: 0 },
      block: { total: 0, used: 0 },
      report: { total: 0, used: 0 },
    };
    for (const item of items) {
      c[item.group].total += 1;
      if (item.used) c[item.group].used += 1;
    }
    return c;
  }, [items]);

  const visibleGroups = GROUPS.filter((g) => counts[g.id].total > 0);
  const activeTab = counts[selectedTab].total > 0 ? selectedTab : "context";
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return items.filter((i) => i.group === activeTab);
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        (i.sample ?? "").toLowerCase().includes(q),
    );
  }, [items, q, activeTab]);

  const tokenClass = (group: VariableGroup) => GROUPS.find((g) => g.id === group)?.token ?? "";

  const hint =
    activeTab === "report"
      ? shared
        ? `Emitted only by ${reportLabel ?? "the previewed report"} — these render blank in other reports' emails.`
        : `Emitted by ${reportLabel ?? "this report"}.`
      : GROUPS.find((g) => g.id === activeTab)?.hint;

  function copyToken(name: string) {
    void navigator.clipboard?.writeText(`{{${name}}}`).catch(() => {});
    setCopiedName(name);
    setTimeout(() => setCopiedName((cur) => (cur === name ? null : cur)), 1200);
  }

  return (
    <div className="space-y-2.5 rounded-lg border border-border/60 bg-surface-2/25 p-3" data-testid="variable-inspector">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Variable groups">
          {visibleGroups.map((g) => {
            const active = !q && activeTab === g.id;
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setSelectedTab(g.id);
                  setQuery("");
                }}
                data-testid={`var-tab-${g.id}`}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  active
                    ? "border-primary/45 bg-primary/12 text-fg"
                    : "border-transparent bg-surface text-fg-muted hover:text-fg",
                )}
              >
                {g.label}{" "}
                <span className="font-mono text-[10px] opacity-70">
                  {counts[g.id].used > 0 ? `${counts[g.id].used}/${counts[g.id].total}` : counts[g.id].total}
                </span>
              </button>
            );
          })}
          {q && <span className="ml-1 text-[11px] text-fg-muted">All matches ({filtered.length})</span>}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden rounded border border-border/50 bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-muted xl:inline">
            → {insertTargetLabel}
          </span>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vars…"
            aria-label="Search variables"
            className="h-7 w-36 text-[11px]"
            data-testid="var-search"
          />
        </div>
      </div>

      {!q && hint && <p className="text-[11px] text-fg-muted/80">{hint}</p>}

      <div
        className="max-h-[240px] divide-y divide-border/45 overflow-y-auto rounded-lg border border-border/60 bg-surface"
        data-testid={!q && activeTab === "report" ? "report-var-chips" : undefined}
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-5 text-center text-xs text-fg-muted">No variables match &ldquo;{query}&rdquo;.</p>
        ) : (
          filtered.map((item) => (
            <div
              key={item.name}
              className="group flex items-center justify-between gap-3 px-3 py-2 text-xs transition-colors hover:bg-surface-2/40"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <code
                    className={cn("rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium", tokenClass(item.group))}
                  >
                    {`{{${item.name}}}`}
                  </code>
                  {item.used && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      in use
                    </span>
                  )}
                </div>
                <p className="truncate text-[11px] text-fg-muted" title={item.description}>
                  {item.description}
                </p>
              </div>

              <span
                className="hidden max-w-[155px] shrink-0 truncate text-right font-mono text-[11px] text-fg/85 sm:block"
                title={item.sample}
              >
                {item.sample ? item.sample : "—"}
              </span>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => copyToken(item.name)}
                  title={`Copy {{${item.name}}}`}
                  aria-label={`Copy {{${item.name}}}`}
                  className="rounded border border-border/60 bg-surface-2/60 px-2 py-1 text-[10px] font-medium text-fg-muted transition-colors hover:border-border hover:text-fg"
                >
                  {copiedName === item.name ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => onInsert(item.name)}
                  data-testid={`var-chip-${item.name}`}
                  aria-label={`Insert {{${item.name}}}`}
                  className="rounded border border-primary/35 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  Insert
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
