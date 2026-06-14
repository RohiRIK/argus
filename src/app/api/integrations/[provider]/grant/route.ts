import { grantMissingPermissions } from "@/services/graph/permissions-grant";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/** POST /api/integrations/:provider/grant — programmatically grant missing Graph scopes (D2). */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider !== "microsoft365") throw new ValidationError("Permission grant is only supported for microsoft365");
    return ok(await grantMissingPermissions());
  } catch (err) {
    return fail(err);
  }
}
