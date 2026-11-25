import { templatesDao } from "@/db/dao/templates";
import { ok, fail } from "@/lib/api";
import { parseBody, templateUpdateSchema } from "@/lib/validation";
import { NotFoundError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const t = templatesDao.findById(id);
    if (!t) throw new NotFoundError(`Template ${id} not found`);
    return ok(t);
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const patch = await parseBody(req, templateUpdateSchema);
    const updated = templatesDao.update(id, patch);
    if (!updated) throw new NotFoundError(`Template ${id} not found`);
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const existing = templatesDao.findById(id);
    if (!existing) throw new NotFoundError(`Template ${id} not found`);
    if (existing.isDefault) {
      throw new ValidationError("Default report templates cannot be deleted");
    }
    templatesDao.delete(id);
    return ok({ deleted: id });
  } catch (err) {
    return fail(err);
  }
}
