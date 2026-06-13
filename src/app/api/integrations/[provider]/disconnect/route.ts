import { integrationsDao } from "@/db/dao/integrations";
import { ok, fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** POST /api/integrations/:provider/disconnect — mark disconnected. */
export async function POST(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    if (!integrationsDao.findByProvider(provider)) {
      throw new NotFoundError(`Integration ${provider} not found`);
    }
    return ok(integrationsDao.upsert(provider, { status: "disconnected" }));
  } catch (err) {
    return fail(err);
  }
}
