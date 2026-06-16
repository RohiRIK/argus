import Link from "next/link";
import { listReports } from "@/services/reports/registry";
import { AppShell } from "@/components/app-shell";
import { Badge, BadgeCategory } from "@/components/ui/primitives";
import { CatalogPermissionsBanner } from "@/components/catalog-permissions-banner";
import { IconKey, IconShield, IconCloud, IconCatalog } from "@/components/icons";

export const dynamic = "force-dynamic";

type IconCmp = (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;

// Per-category in-house icon + wash. Washes derive from theme tokens, so the
// tiles re-tint with the active palette (no hardcoded colors).
const CATEGORY: Record<string, { Icon: IconCmp; wash: string }> = {
  identity: { Icon: IconKey, wash: "bg-info/10 text-info" },
  security: { Icon: IconShield, wash: "bg-danger/10 text-danger" },
  infrastructure: { Icon: IconCloud, wash: "bg-success/10 text-success" },
  custom: { Icon: IconCatalog, wash: "bg-accent/10 text-accent" },
};

export default function CatalogPage() {
  const reports = listReports().map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description,
    requiredPermissions: r.requiredPermissions,
    baselineSupport: r.baselineSupport,
  }));

  return (
    <AppShell title="Catalog">
      <CatalogPermissionsBanner />
      <div className="mb-6">
        <p className="text-sm font-medium text-fg">{reports.length} built-in report types</p>
        <p className="mt-0.5 text-xs text-fg-muted">Pick a report to create a scheduled job.</p>
      </div>

      {/* Airy discovery grid — tiles, not a bento board. Catalog is the one
          surface allowed a soft bg-surface lift (still 0px, no shadow). */}
      <div className="grid gap-5 lg:grid-cols-2">
        {reports.map((r) => {
          const { Icon, wash } = CATEGORY[r.category] ?? CATEGORY.custom;
          return (
            <Link
              key={r.id}
              href={`/jobs/new?report=${r.id}`}
              data-testid={`catalog-card-${r.id}`}
              className="group flex h-full flex-col gap-4 border border-border/60 bg-surface p-5 transition-colors duration-200 hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Icon tile on category wash + baseline marker */}
              <div className="flex items-start justify-between">
                <span className={`flex h-11 w-11 items-center justify-center ${wash}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="flex items-center gap-2">
                  <BadgeCategory category={r.category} />
                  {r.baselineSupport && (
                    <span className="text-[10px] font-medium text-success">baseline ✓</span>
                  )}
                </div>
              </div>

              {/* Title & description */}
              <div className="flex-1 space-y-1.5">
                <h3 className="text-sm font-semibold text-fg">{r.name}</h3>
                <p className="text-xs leading-relaxed text-fg-muted">{r.description}</p>
              </div>

              {/* Permissions */}
              <div className="flex flex-wrap gap-1.5">
                {r.requiredPermissions.slice(0, 3).map((p) => (
                  <Badge key={p} className="font-mono text-[9px] tracking-tight">{p}</Badge>
                ))}
                {r.requiredPermissions.length > 3 && (
                  <Badge className="text-[9px]">+{r.requiredPermissions.length - 3}</Badge>
                )}
              </div>

              {/* Always-visible CTA pinned to the bottom */}
              <div className="flex items-center gap-1 text-[11px] font-medium text-fg-muted transition-colors duration-200 group-hover:text-accent">
                <span>Create job</span>
                <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
              </div>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
