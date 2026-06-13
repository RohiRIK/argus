import { integrationsDao } from "@/db/dao/integrations";
import { ok, fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** POST /api/integrations/:provider/disconnect — mark disconnected. */
export async function POST(_req: Request, { params }: { params: { provider: string } }) {
  try {
    if (!integrationsDao.findByProvider(params.provider)) {
      throw new NotFoundError(`Integration ${params.provider} not found`);
    }
    return ok(integrationsDao.upsert(params.provider, { status: "disconnected" }));
  } catch (err) {
    return fail(err);
  }
}
