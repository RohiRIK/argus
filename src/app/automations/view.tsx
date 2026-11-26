import { AppShell } from "@/components/app-shell";
import type { AutomationsTab } from "@/components/automations-client";
import {
  AUTOMATION_SOLUTION_PACKS,
  defaultParamsForAutomation,
  getAutomation,
  listAutomations,
} from "@/services/automations/registry";
import { automationPoliciesDao, automationRunsDao } from "@/db/dao/automations";
import { integrationsDao } from "@/db/dao/integrations";
import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import { vaultService } from "@/services/vault/vault";
import { AUTOMATION_PROVIDER } from "@/services/graph/automation-client";
import {
  AutomationsClient,
  type CatalogAutomationItem,
  type PolicyWithLatestRun,
} from "@/components/automations-client";

/** Shared server view for /automations (policies), /automations/catalog and /automations/runs. */
export function AutomationsView({ tab, title }: { tab: AutomationsTab; title: string }) {
  const rawPolicies = automationPoliciesDao.findAll();
  const latestMap = automationRunsDao.latestByPolicyIds(rawPolicies.map((p) => p.id));

  const policies: PolicyWithLatestRun[] = rawPolicies.map((p) => {
    const def = getAutomation(p.automationType);
    return {
      ...p,
      catalogName: def?.name ?? p.automationType,
      category: def?.category ?? "governance",
      riskLevel: def?.riskLevel ?? "medium",
      icon: def?.icon ?? "graph",
      requiredPermissions: def?.requiredPermissions ?? [],
      latestRun: latestMap.get(p.id) ?? null,
    };
  });

  const catalog: CatalogAutomationItem[] = listAutomations().map((a) => ({
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

  const autoInt = integrationsDao.findByProvider(AUTOMATION_PROVIDER);
  const autoConfig = (autoInt?.config ?? {}) as {
    grantedScopes?: string[];
    missingScopes?: string[];
    tenantDisplayName?: string;
    appDisplayName?: string;
  };

  const groups = recipientGroupsDao.findAll().map((g) => ({
    id: g.id,
    name: g.name,
  }));

  return (
    <AppShell title={title}>
      <AutomationsClient
        tab={tab}
        catalog={catalog}
        packs={[...AUTOMATION_SOLUTION_PACKS]}
        initialPolicies={policies}
        initialRecentRuns={automationRunsDao.recent(25)}
        recipientGroups={groups}
        integration={{
          configured: vaultService.isAutomationConfigured(),
          status: autoInt?.status ?? "disconnected",
          authMode: vaultService.automationAuthMode(),
          grantedScopes: autoConfig.grantedScopes ?? [],
          missingScopes: autoConfig.missingScopes ?? [],
          tenantDisplayName: autoConfig.tenantDisplayName ?? null,
          appDisplayName: autoConfig.appDisplayName ?? null,
        }}
      />
    </AppShell>
  );
}
