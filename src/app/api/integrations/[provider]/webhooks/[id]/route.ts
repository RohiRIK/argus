import { webhooksDao } from "@/db/dao/webhooks";
import { ok, fail } from "@/lib/api";
import { parseBody, webhookUpdateSchema } from "@/lib/validation";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: { provider: string; id: string } };

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const patch = await parseBody(req, webhookUpdateSchema);
    const updated = webhooksDao.update(params.id, patch);
    if (!updated) throw new NotFoundError(`Webhook ${params.id} not found`);
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    if (!webhooksDao.findById(params.id)) throw new NotFoundError(`Webhook ${params.id} not found`);
    webhooksDao.delete(params.id);
    return ok({ deleted: params.id });
  } catch (err) {
    return fail(err);
  }
}
