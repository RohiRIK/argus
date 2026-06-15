import { auditDao } from "@/db/dao/audit";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/** GET /api/integrations/:provider/audit — recent privileged-action audit entries (GRANT-6). */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider !== "microsoft365") throw new ValidationError("Audit is only supported for microsoft365");
    return ok(auditDao.list(20));
  } catch (err) {
    return fail(err);
  }
}
