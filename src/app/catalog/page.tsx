import Link from "next/link";
import { listReports } from "@/services/reports/registry";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, Badge, BadgeCategory } from "@/components/ui/primitives";
import { CatalogPermissionsBanner } from "@/components/catalog-permissions-banner";

export const dynamic = "force-dynamic";

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => (
            <Link
              key={r.id}
              href={`/jobs/new?report=${r.id}`}
              data-testid={`catalog-card-${r.id}`}
              className="group block"
            >
              <Card className="relative h-full transition-all duration-200 group-hover:shadow-elevated group-hover:border-primary/30 group-hover:-translate-y-0.5">
                <CardContent className="flex h-full flex-col gap-3">
                  {/* Category strip */}
                  <div className="flex items-center justify-between">
                    <BadgeCategory category={r.category} />
                    {r.baselineSupport && (
                      <span className="text-[10px] font-medium text-success">baseline ✓</span>
                    )}
                  </div>

                  {/* Title & description */}
                  <div className="flex-1 space-y-1.5">
                    <h3 className="text-sm font-semibold text-fg transition-colors group-hover:text-primary">
                      {r.name}
                    </h3>
                    <p className="text-xs text-fg-muted/80 leading-relaxed">
                      {r.description}
                    </p>
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

                  {/* CTA */}
                  <div className="flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 transition-all duration-200 group-hover:opacity-100">
                    <span>Create job</span>
                    <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
        ))}
      </div>
    </AppShell>
  );
}
