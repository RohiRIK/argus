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
} from "@/components/ui/primitives";
import { IconCatalog, IconClose, IconCloud, IconKey, IconShield } from "@/components/icons";
import { cn } from "@/lib/utils";

export type CatalogReport = {
  id: string;
  name: string;
  category: "identity" | "security" | "infrastructure" | "custom";
  description: string;
  requiredPermissions: string[];
  baselineSupport: boolean;
  tags?: string[];
  maturity?: "stable" | "preview";
};

type IconCmp = (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;

const CATEGORY: Record<string, { Icon: IconCmp; wash: string }> = {
  identity: { Icon: IconKey, wash: "bg-info/10 text-info" },
  security: { Icon: IconShield, wash: "bg-danger/10 text-danger" },
  infrastructure: { Icon: IconCloud, wash: "bg-success/10 text-success" },
  custom: { Icon: IconCatalog, wash: "bg-accent/10 text-accent" },
};

const CATEGORIES = ["all", "identity", "security", "infrastructure", "custom"] as const;
const MATURITIES = ["all", "stable", "preview"] as const;

type CategoryFilter = (typeof CATEGORIES)[number];
type MaturityFilter = (typeof MATURITIES)[number];

function isStable(r: CatalogReport): boolean {
  return r.maturity !== "preview";
}

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
        "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors duration-200",
        active
          ? "border-border bg-surface-2 text-fg"
          : "border-border/60 bg-surface text-fg-muted hover:border-border hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function CatalogClient({ reports }: { reports: CatalogReport[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [maturity, setMaturity] = useState<MaturityFilter>("all");
  const [gapOnly, setGapOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const showGapToggle = permStatus !== "loading" && permStatus !== "ok";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const missingSet = new Set(missing);
    return reports.filter((r) => {
      if (category !== "all" && r.category !== category) return false;

      if (maturity === "stable" && !isStable(r)) return false;
      if (maturity === "preview" && r.maturity !== "preview") return false;

      if (gapOnly) {
        if (r.requiredPermissions.length === 0) return false;
        if (!r.requiredPermissions.some((p) => missingSet.has(p))) return false;
      }

      if (q) {
        const hay = [
          r.name,
          r.description,
          r.id,
          ...(r.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [reports, query, category, maturity, gapOnly, missing]);

  const selected = selectedId ? reports.find((r) => r.id === selectedId) ?? null : null;

  const anyFilter =
    query.trim() !== "" || category !== "all" || maturity !== "all" || gapOnly;

  function clearFilters() {
    setQuery("");
    setCategory("all");
    setMaturity("all");
    setGapOnly(false);
  }

  // Esc + body scroll lock while drawer open (AppShell mobile-nav pattern).
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
      <div className="mb-6">
        <p className="text-sm font-medium text-fg" data-testid="catalog-count">
          {filtered.length === reports.length
            ? `${reports.length} built-in report types`
            : `${filtered.length} of ${reports.length} report types`}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">Pick a report to create a scheduled job.</p>
      </div>

      {/* Toolbar under count line */}
      <div className="mb-6 space-y-3" data-testid="catalog-toolbar">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, description, id, or tags…"
          data-testid="catalog-search"
          className="h-9 max-w-md"
        />

        <div className="flex flex-wrap items-center gap-1.5" data-testid="catalog-category-chips">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">
            Category
          </span>
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              active={category === c}
              onClick={() => setCategory(c)}
              testId={`catalog-category-${c}`}
            >
              {c === "all" ? "All" : c}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5" data-testid="catalog-maturity-chips">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">
            Maturity
          </span>
          {MATURITIES.map((m) => (
            <Chip
              key={m}
              active={maturity === m}
              onClick={() => setMaturity(m)}
              testId={`catalog-maturity-${m}`}
            >
              {m === "all" ? "All" : m === "stable" ? "Stable" : "Preview"}
            </Chip>
          ))}
        </div>

        {showGapToggle && (
          <label
            className="inline-flex cursor-pointer items-center gap-2 text-xs text-fg-muted"
            data-testid="catalog-gap-toggle"
          >
            <input
              type="checkbox"
              checked={gapOnly}
              onChange={(e) => setGapOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span>Permission gap only</span>
          </label>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No reports match"
          hint="Try clearing search or filters to see the full catalog."
          action={
            anyFilter ? (
              <Button variant="outline" size="sm" onClick={clearFilters} data-testid="clear-filters">
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2" data-testid="catalog-grid">
          {filtered.map((r) => {
            const { Icon, wash } = CATEGORY[r.category] ?? CATEGORY.custom;
            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                data-testid={`catalog-card-${r.id}`}
                onClick={() => setSelectedId(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(r.id);
                  }
                }}
                className="group flex h-full cursor-pointer flex-col gap-4 rounded-lg border border-border/70 bg-surface p-5 shadow-sm transition-all duration-200 hover:border-border hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center ${wash}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {r.maturity === "preview" && (
                      <Badge data-testid={`catalog-preview-${r.id}`} className="uppercase tracking-wider">
                        Preview
                      </Badge>
                    )}
                    {r.baselineSupport && (
                      <Badge data-testid={`catalog-baseline-${r.id}`} className="uppercase tracking-wider">
                        Baseline
                      </Badge>
                    )}
                    <BadgeCategory category={r.category} />
                  </div>
                </div>

                <div className="flex-1 space-y-1.5">
                  <h3 className="text-sm font-semibold text-fg">{r.name}</h3>
                  <p className="text-xs leading-relaxed text-fg-muted">{r.description}</p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {r.requiredPermissions.slice(0, 3).map((p) => (
                    <Badge key={p} className="font-mono text-[9px] tracking-tight">
                      {p}
                    </Badge>
                  ))}
                  {r.requiredPermissions.length > 3 && (
                    <Badge className="text-[9px]">+{r.requiredPermissions.length - 3}</Badge>
                  )}
                </div>

                {/* Q1 locked: labeled Create job deep-link; must not open drawer */}
                <Link
                  href={`/jobs/new?report=${r.id}`}
                  data-testid={`catalog-create-${r.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-[11px] font-medium text-fg-muted transition-colors duration-200 hover:text-accent group-hover:text-accent"
                >
                  <span>Create job</span>
                  <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail drawer — AppShell mobile-nav style (right panel + backdrop) */}
      {selected && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={selected.name} data-testid="catalog-drawer">
          <button
            type="button"
            aria-label="Close detail"
            onClick={() => setSelectedId(null)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            data-testid="catalog-drawer-backdrop"
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border/70 bg-bg shadow-elevated-lg animate-fade-in">
            <div className="flex items-start justify-between gap-3 border-b border-border/50 px-5 py-4">
              <div className="min-w-0 space-y-2">
                <h2 className="text-base font-semibold text-fg" data-testid="catalog-drawer-name">
                  {selected.name}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <BadgeCategory category={selected.category} />
                  {selected.maturity === "preview" && (
                    <Badge className="uppercase tracking-wider">Preview</Badge>
                  )}
                  {selected.baselineSupport && (
                    <Badge className="uppercase tracking-wider">Baseline</Badge>
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

              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted/70">
                  Permissions
                </p>
                {selected.requiredPermissions.length === 0 ? (
                  <p className="text-xs text-fg-muted">None required</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5" data-testid="catalog-drawer-perms">
                    {selected.requiredPermissions.map((p) => (
                      <Badge key={p} className="font-mono text-[9px] tracking-tight">
                        {p}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-4 text-xs text-fg-muted">
                <div>
                  <span className="font-semibold text-fg">Baseline:</span>{" "}
                  {selected.baselineSupport ? "supported" : "not supported"}
                </div>
                <div>
                  <span className="font-semibold text-fg">Maturity:</span>{" "}
                  {isStable(selected) ? "stable" : "preview"}
                </div>
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
            </div>

            <div className="border-t border-border/50 px-5 py-4">
              <LinkButton
                href={`/jobs/new?report=${selected.id}`}
                variant="primary"
                size="md"
                className="w-full"
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
