import { listReports, getQuarantinedPlugins } from "@/services/reports/registry";
import { jobsDao } from "@/db/dao/jobs";
import { AppShell } from "@/components/app-shell";
import { CatalogPermissionsBanner } from "@/components/catalog-permissions-banner";
import { CatalogClient, type CatalogJobRef, type CatalogReport } from "@/components/catalog-client";

export const dynamic = "force-dynamic";

export default function CatalogPage() {
  const reports: CatalogReport[] = listReports().map((r) => ({
    id: r.id,
    version: r.version ?? "1.0.0",
    name: r.name,
    category: r.category,
    description: r.description,
    requiredPermissions: r.requiredPermissions,
    baselineSupport: r.baselineSupport,
    tags: r.tags,
    maturity: r.maturity,
    recommendedSchedule: r.recommendedSchedule,
    recommendedGroup: r.recommendedGroup,
    usageConcealmentNote: r.usageConcealmentNote,
    source: r.source,
  }));

  const jobsByReport: Record<string, CatalogJobRef[]> = {};
  for (const j of jobsDao.findAll()) {
    if (!jobsByReport[j.reportType]) jobsByReport[j.reportType] = [];
    jobsByReport[j.reportType].push({ id: j.id, name: j.name, status: j.status });
  }

  const quarantinedCount = getQuarantinedPlugins().length;

  return (
    <AppShell title="Catalog">
      <CatalogPermissionsBanner />
      <CatalogClient
        reports={reports}
        initialJobsByReport={jobsByReport}
        quarantinedCount={quarantinedCount}
      />
    </AppShell>
  );
}
