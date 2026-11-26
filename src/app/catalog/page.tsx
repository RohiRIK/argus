import { listReports, getQuarantinedPlugins } from "@/services/reports/registry";
import {
  AUTOMATION_SOLUTION_PACKS,
  defaultParamsForAutomation,
  listAutomations,
} from "@/services/automations/registry";
import { jobsDao } from "@/db/dao/jobs";
import { automationPoliciesDao } from "@/db/dao/automations";
import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import { describeSchedule } from "@/lib/schedule";
import { AppShell } from "@/components/app-shell";
import { CatalogPermissionsBanner } from "@/components/catalog-permissions-banner";
import { CatalogClient, type CatalogJobRef, type CatalogReport } from "@/components/catalog-client";
import type { CatalogAutomationItem } from "@/components/automations-client";
import { automationIntegrationInfo } from "@/app/automations/view";
import { parseCatalogTypeParam, type CatalogRunnerRef } from "@/lib/catalog-items";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** One catalog: read-only report plugins and tenant-changing automations (`?type=report|automation`). */
export default async function CatalogPage({ searchParams }: PageProps) {
  const initialType = parseCatalogTypeParam((await searchParams).type);

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
    service: r.service ?? "Microsoft 365",
    icon: r.icon ?? "graph",
    dataSource: r.dataSource ?? "graph-v1",
    metrics: r.metrics ?? [],
    author: r.author ?? "Argus Official",
  }));

  const jobsByReport: Record<string, CatalogJobRef[]> = {};
  for (const j of jobsDao.findAll()) {
    if (!jobsByReport[j.reportType]) jobsByReport[j.reportType] = [];
    jobsByReport[j.reportType].push({
      id: j.id,
      name: j.name,
      status: j.status,
      schedule: describeSchedule(j.scheduleType, j.schedulePreset, j.cronExpression),
    });
  }

  const automations: CatalogAutomationItem[] = listAutomations().map((a) => ({
    id: a.id,
    version: a.version,
    name: a.name,
    category: a.category,
    riskLevel: a.riskLevel,
    description: a.description,
    requiredPermissions: a.requiredPermissions,
    recommendedSchedule: a.recommendedSchedule,
    recommendedMode: a.recommendedMode,
    service: a.service,
    icon: a.icon,
    dataSource: a.dataSource,
    tags: a.tags,
    pairedReportId: a.pairedReportId ?? null,
    paramSchema: a.paramSchema,
    defaultParams: defaultParamsForAutomation(a),
  }));

  // Policies grouped by automation type — the automation equivalent of jobs-by-report.
  const policiesByAutomation: Record<string, CatalogRunnerRef[]> = {};
  for (const p of automationPoliciesDao.findAll()) {
    if (!policiesByAutomation[p.automationType]) policiesByAutomation[p.automationType] = [];
    policiesByAutomation[p.automationType].push({
      id: p.id,
      name: p.name,
      status: p.status,
      mode: p.mode,
      schedule: p.scheduleType === "manual" ? "Manual" : describeSchedule(p.scheduleType, p.schedulePreset, p.cronExpression),
    });
  }

  const recipientGroups = recipientGroupsDao.findAll().map((g) => ({ id: g.id, name: g.name }));
  const quarantinedCount = getQuarantinedPlugins().length;

  return (
    <AppShell title="Catalog">
      <CatalogPermissionsBanner />
      <CatalogClient
        reports={reports}
        initialJobsByReport={jobsByReport}
        automations={automations}
        policiesByAutomation={policiesByAutomation}
        automationPacks={AUTOMATION_SOLUTION_PACKS.map((p) => ({ ...p, automationIds: [...p.automationIds] }))}
        automationIntegration={automationIntegrationInfo()}
        recipientGroups={recipientGroups}
        initialType={initialType}
        quarantinedCount={quarantinedCount}
      />
    </AppShell>
  );
}
