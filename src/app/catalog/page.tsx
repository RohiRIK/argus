import Link from "next/link";
import { listReports } from "@/services/reports/registry";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, Badge } from "@/components/ui/primitives";
import { CreateJobForm } from "@/components/create-job-form";

export const dynamic = "force-dynamic";

const CATEGORY_TONE: Record<string, string> = {
  identity: "bg-info/10 text-info",
  security: "bg-danger/10 text-danger",
  infrastructure: "bg-success/10 text-success",
  custom: "bg-accent/10 text-accent",
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
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <p className="mb-4 text-sm text-fg-muted">{reports.length} built-in report types. Click a report to edit its email template.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {reports.map((r) => (
              <Link key={r.id} href={`/templates?report=${r.id}`} data-testid={`catalog-card-${r.id}`} className="group">
                <Card className="h-full transition-shadow group-hover:shadow-elevated group-hover:border-primary/40">
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-medium group-hover:text-primary">{r.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${CATEGORY_TONE[r.category] ?? "bg-surface-2"}`}>
                        {r.category}
                      </span>
                    </div>
                    <p className="text-xs text-fg-muted">{r.description}</p>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {r.requiredPermissions.map((p) => (
                        <Badge key={p} className="font-mono text-[10px]">{p}</Badge>
                      ))}
                      {r.baselineSupport && <Badge className="text-success">baseline</Badge>}
                    </div>
                    <p className="pt-1 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                      Edit template →
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <CreateJobForm catalog={reports.map((r) => ({ id: r.id, name: r.name }))} />
        </div>
      </div>
    </AppShell>
  );
}
