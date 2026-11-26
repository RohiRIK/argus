import { AppShell } from "@/components/app-shell";
import { getAutomation } from "@/services/automations/registry";
import { automationPoliciesDao, automationRunsDao } from "@/db/dao/automations";
import { integrationsDao } from "@/db/dao/integrations";
import { vaultService } from "@/services/vault/vault";
import { AUTOMATION_PROVIDER } from "@/services/graph/automation-client";
import {
  AutomationsClient,
  type AutomationIntegrationInfo,
  type AutomationsTab,
  type PolicyWithLatestRun,
} from "@/components/automations-client";

/** Server snapshot of the write-capable automation integration (shared by /automations and /catalog). */
export function automationIntegrationInfo(): AutomationIntegrationInfo {
  const autoInt = integrationsDao.findByProvider(AUTOMATION_PROVIDER);
  const autoConfig = (autoInt?.config ?? {}) as {
    grantedScopes?: string[];
    missingScopes?: string[];
    tenantDisplayName?: string;
    appDisplayName?: string;
  };
  return {
    configured: vaultService.isAutomationConfigured(),
    status: autoInt?.status ?? "disconnected",
    authMode: vaultService.automationAuthMode(),
    grantedScopes: autoConfig.grantedScopes ?? [],
    missingScopes: autoConfig.missingScopes ?? [],
    tenantDisplayName: autoConfig.tenantDisplayName ?? null,
    appDisplayName: autoConfig.appDisplayName ?? null,
  };
}

/**
 * Shared server view for /automations (policies) and /automations/runs.
 * The automation catalog lives in the unified /catalog (`?type=automation`).
 */
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

  return (
    <AppShell title={title}>
      <AutomationsClient
        tab={tab}
        initialPolicies={policies}
        initialRecentRuns={automationRunsDao.recent(25)}
        integration={automationIntegrationInfo()}
      />
    </AppShell>
  );
}
