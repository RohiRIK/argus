import { auditDao } from "@/db/dao/audit";
import { AUTOMATION_PROVIDER } from "@/services/graph/automation-client";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/** GET /api/integrations/:provider/audit — recent privileged-action audit entries. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider !== "microsoft365" && provider !== AUTOMATION_PROVIDER) {
      throw new ValidationError("Audit is only supported for microsoft365 and microsoft365-automation");
    }
    return ok(auditDao.listForProvider(provider, 25));
  } catch (err) {
    return fail(err);
  }
}
