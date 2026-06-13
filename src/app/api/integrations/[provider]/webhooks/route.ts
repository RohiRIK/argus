import { integrationsDao } from "@/db/dao/integrations";
import { webhooksDao } from "@/db/dao/webhooks";
import { ok, fail } from "@/lib/api";
import { parseBody, webhookInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** GET — list webhooks for an integration (creating the integration if absent). */
export async function GET(_req: Request, { params }: { params: { provider: string } }) {
  try {
    const integration = integrationsDao.upsert(params.provider, {});
    return ok(webhooksDao.forIntegration(integration.id));
  } catch (err) {
    return fail(err);
  }
}

/** POST — add a webhook URL to an integration. */
export async function POST(req: Request, { params }: { params: { provider: string } }) {
  try {
    const input = await parseBody(req, webhookInputSchema);
    const integration = integrationsDao.upsert(params.provider, {});
    return ok(webhooksDao.create({ ...input, integrationId: integration.id }));
  } catch (err) {
    return fail(err);
  }
}
