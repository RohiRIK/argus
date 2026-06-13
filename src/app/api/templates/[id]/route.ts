import { templatesDao } from "@/db/dao/templates";
import { ok, fail } from "@/lib/api";
import { parseBody, templateInputSchema } from "@/lib/validation";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const t = templatesDao.findById(params.id);
    if (!t) throw new NotFoundError(`Template ${params.id} not found`);
    return ok(t);
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const patch = await parseBody(req, templateInputSchema.partial());
    const updated = templatesDao.update(params.id, patch);
    if (!updated) throw new NotFoundError(`Template ${params.id} not found`);
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}
