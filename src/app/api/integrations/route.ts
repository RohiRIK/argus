import { integrationsDao } from "@/db/dao/integrations";
import { webhooksDao } from "@/db/dao/webhooks";
import { ok, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/integrations — all integrations with their webhook counts. */
export async function GET() {
  try {
    const list = integrationsDao.findAll().map((i) => ({
      ...i,
      webhookCount: webhooksDao.forIntegration(i.id).length,
    }));
    return ok(list, { total: list.length });
  } catch (err) {
    return fail(err);
  }
}
