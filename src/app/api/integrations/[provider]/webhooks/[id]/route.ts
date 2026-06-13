import { webhooksDao } from "@/db/dao/webhooks";
import { ok, fail } from "@/lib/api";
import { parseBody, webhookUpdateSchema } from "@/lib/validation";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string; id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const patch = await parseBody(req, webhookUpdateSchema);
    const updated = webhooksDao.update(id, patch);
    if (!updated) throw new NotFoundError(`Webhook ${id} not found`);
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!webhooksDao.findById(id)) throw new NotFoundError(`Webhook ${id} not found`);
    webhooksDao.delete(id);
    return ok({ deleted: id });
  } catch (err) {
    return fail(err);
  }
}
