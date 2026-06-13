import { integrationsDao } from "@/db/dao/integrations";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({ name: z.string().optional(), config: z.record(z.unknown()).optional() });

/** POST /api/integrations/:provider/connect — mark connected, store config. */
export async function POST(req: Request, { params }: { params: { provider: string } }) {
  try {
    const body = await parseBody(req, schema);
    const integration = integrationsDao.upsert(params.provider, {
      status: "connected",
      name: body.name ?? params.provider,
      config: body.config ?? {},
      errorMessage: null,
    });
    return ok(integration);
  } catch (err) {
    return fail(err);
  }
}
