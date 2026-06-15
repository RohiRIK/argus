import { templatesDao, templateVersionsDao } from "@/db/dao/templates";
import { ok, fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/templates/:id/versions — prior snapshots, newest first (F5). */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!templatesDao.findById(id)) throw new NotFoundError(`Template ${id} not found`);
    return ok(templateVersionsDao.list(id));
  } catch (err) {
    return fail(err);
  }
}
