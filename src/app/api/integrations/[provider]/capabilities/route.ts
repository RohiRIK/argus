import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { auditDao } from "@/db/dao/audit";
import { integrationsDao } from "@/db/dao/integrations";
import {
  directoryWritesEnabled,
  scopeGroups,
  setDirectoryWrites,
  type CapabilityReport,
} from "@/services/graph/capabilities";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

const schema = z.object({ directoryWrites: z.boolean() });

function provider(p: string) {
  if (p !== "microsoft365") throw new ValidationError("Only supported for microsoft365");
}

/** GET /api/integrations/:provider/capabilities — opt-ins and last verified readiness per capability. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    provider((await params).provider);
    const directoryWrites = directoryWritesEnabled();
    const cfg = (integrationsDao.findByProvider("microsoft365")?.config ?? {}) as Record<string, unknown>;
    return ok({
      directoryWrites,
      groups: scopeGroups(directoryWrites),
      lastVerified: (cfg.capabilities as CapabilityReport | undefined) ?? null,
    });
  } catch (err) {
    return fail(err);
  }
}

/**
 * PUT /api/integrations/:provider/capabilities — opt in/out of Entra group writes.
 * Turning it on only changes what Argus requests next time consent is granted;
 * turning it off stops Argus from requesting or using Group.ReadWrite.All (an
 * existing grant must be removed in Entra by an admin).
 */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    provider((await params).provider);
    const { directoryWrites } = await parseBody(req, schema);
    const before = directoryWritesEnabled();
    setDirectoryWrites(directoryWrites);
    auditDao.record({
      action: "capability.directory_writes",
      provider: "microsoft365",
      outcome: "success",
      detail: { from: before, to: directoryWrites },
    });
    return ok({ directoryWrites, groups: scopeGroups(directoryWrites) });
  } catch (err) {
    return fail(err);
  }
}
