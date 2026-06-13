import Link from "next/link";
import { listReports } from "@/services/reports/registry";
import { CreateJobForm } from "@/components/create-job-form";

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
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
        <Link href="/dashboard" className="text-xs underline underline-offset-4">Dashboard</Link>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <div className="grid gap-3 sm:grid-cols-2">
          {reports.map((r) => (
            <article key={r.id} className="rounded-lg border border-[hsl(var(--border))] p-4">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-medium">{r.name}</h2>
                <span className="rounded bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] uppercase opacity-70">{r.category}</span>
              </div>
              <p className="mb-2 text-xs opacity-60">{r.description}</p>
              <p className="text-[11px] opacity-50">
                Perms: {r.requiredPermissions.join(", ")} · Baseline: {r.baselineSupport ? "yes" : "no"}
              </p>
            </article>
          ))}
        </div>
        <CreateJobForm catalog={reports.map((r) => ({ id: r.id, name: r.name }))} />
      </div>
    </main>
  );
}
