import {
  AUTOMATION_SOLUTION_PACKS,
  defaultParamsForAutomation,
  listAutomations,
} from "@/services/automations/registry";
import { automationPoliciesDao } from "@/db/dao/automations";
import { integrationsDao } from "@/db/dao/integrations";
import { vaultService } from "@/services/vault/vault";
import { AUTOMATION_PROVIDER } from "@/services/graph/automation-client";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/automations/catalog — list all built-in M365 automations, packs, and integration readiness. */
export async function GET() {
  try {
    const policies = automationPoliciesDao.findAll();
    const policiesByType: Record<string, Array<{ id: string; name: string; mode: string; status: string }>> = {};
    for (const p of policies) {
      if (!policiesByType[p.automationType]) policiesByType[p.automationType] = [];
      policiesByType[p.automationType].push({
        id: p.id,
        name: p.name,
        mode: p.mode,
        status: p.status,
      });
    }

    const autoInt = integrationsDao.findByProvider(AUTOMATION_PROVIDER);
    const config = (autoInt?.config ?? {}) as {
      grantedScopes?: string[];
      missingScopes?: string[];
      tenantDisplayName?: string;
      appDisplayName?: string;
    };

    const items = listAutomations().map((a) => ({
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
      policies: policiesByType[a.id] ?? [],
    }));

    return ok({
      items,
      packs: AUTOMATION_SOLUTION_PACKS,
      integration: {
        provider: AUTOMATION_PROVIDER,
        configured: vaultService.isAutomationConfigured(),
        authMode: vaultService.automationAuthMode(),
        status: autoInt?.status ?? "disconnected",
        grantedScopes: config.grantedScopes ?? [],
        missingScopes: config.missingScopes ?? [],
        tenantDisplayName: config.tenantDisplayName ?? null,
        appDisplayName: config.appDisplayName ?? null,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
