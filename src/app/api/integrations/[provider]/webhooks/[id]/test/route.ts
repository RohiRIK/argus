import { webhooksDao } from "@/db/dao/webhooks";
import { dispatchWebhooks } from "@/services/dispatch/webhook";
import { ok, fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** POST — send a synthetic test payload to a single webhook. */
export async function POST(_req: Request, { params }: { params: Promise<{ provider: string; id: string }> }) {
  try {
    const { id } = await params;
    const wh = webhooksDao.findById(id);
    if (!wh) throw new NotFoundError(`Webhook ${id} not found`);

    const [result] = await dispatchWebhooks(
      [{ id: wh.id, name: wh.name, url: wh.url, secret: wh.secret, enabled: true, includeFullHtml: wh.includeFullHtml }],
      {
        executionId: "test",
        jobId: "test",
        jobName: "Argus webhook test",
        suppressionReason: "test payload",
        timestamp: new Date().toISOString(),
        recordsProcessed: 0,
        baselineSnapshot: null,
        metadata: { test: true },
        fullHtml: "<p>Argus test payload</p>",
      },
    );
    webhooksDao.recordDelivery(wh.id, result.status);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
