import { z } from "zod";
import { automationPoliciesDao, automationRunsDao } from "@/db/dao/automations";
import {
  AUTOMATION_SOLUTION_PACKS,
  defaultParamsForAutomation,
  getAutomation,
} from "@/services/automations/registry";
import { addOrReplaceAutomationPolicy } from "@/services/scheduler";
import { automationPolicyInputSchema, parseBody } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

// Packs always deploy in audit (what-if) mode; enforce is enabled per policy after a review.
const packDeploySchema = z.object({
  packId: z.string().min(1),
  mode: z.literal("audit").default("audit"),
});

/** GET /api/automations — list all configured automation policies + latest run summary + recent runs. */
export async function GET() {
  try {
    const policies = automationPoliciesDao.findAll();
    const latestMap = automationRunsDao.latestByPolicyIds(policies.map((p) => p.id));
    const enriched = policies.map((p) => {
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
    const recentRuns = automationRunsDao.recent(30);
    return ok({ policies: enriched, recentRuns }, { total: enriched.length });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/automations — create an automation policy (or deploy a curated solution pack in Audit mode). */
export async function POST(req: Request) {
  try {
    const cloned = req.clone();
    const raw = (await cloned.json().catch(() => null)) as Record<string, unknown> | null;

    if (raw && typeof raw.packId === "string") {
      const packResult = packDeploySchema.safeParse(raw);
      if (!packResult.success) {
        throw new ValidationError("Packs deploy in audit mode; enable enforce per automation after reviewing an audit run.", {
          mode: "Must be audit",
        });
      }
      const parsedPack = packResult.data;
      const pack = AUTOMATION_SOLUTION_PACKS.find((p) => p.id === parsedPack.packId);
      if (!pack) throw new ValidationError(`Unknown automation solution pack: ${parsedPack.packId}`);

      const existingTypes = new Set(automationPoliciesDao.findAll().map((p) => p.automationType));
      const created = [];
      let skipped = 0;

      for (const autoId of pack.automationIds) {
        if (existingTypes.has(autoId)) {
          skipped++;
          continue;
        }
        const def = getAutomation(autoId);
        if (!def) continue;
        const row = automationPoliciesDao.create({
          name: def.name,
          description: def.description,
          automationType: def.id,
          mode: parsedPack.mode,
          params: defaultParamsForAutomation(def),
          scheduleType: "preset",
          schedulePreset: def.recommendedSchedule,
          notifyOn: "changes_only",
          maxActionsPerRun: 25,
          tags: def.tags.slice(0, 5),
          status: "active",
        });
        addOrReplaceAutomationPolicy(row.id);
        created.push(row);
      }
      return ok({ created, createdCount: created.length, skippedCount: skipped });
    }

    const input = await parseBody(req, automationPolicyInputSchema);
    if (input.mode === "enforce") {
      throw new ValidationError(
        "New automations start in audit mode. Run it, review the planned changes, then enable enforce.",
        { mode: "Must be audit when creating" },
      );
    }
    const def = getAutomation(input.automationType);
    if (!def) {
      throw new ValidationError(`Unknown catalog automation: ${input.automationType}`);
    }
    const mergedParams = {
      ...defaultParamsForAutomation(def),
      ...input.params,
    };

    const policy = automationPoliciesDao.create({
      ...input,
      params: mergedParams,
    });
    addOrReplaceAutomationPolicy(policy.id);
    return ok(policy);
  } catch (err) {
    return fail(err);
  }
}
