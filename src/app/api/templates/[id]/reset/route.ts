import { templatesDao } from "@/db/dao/templates";
import { ok, fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/templates/:id/reset — restore built-in defaults (snapshots prior
 * version). A seeded default becomes Argus-managed again (auto-upgraded by seed).
 */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const updated = templatesDao.resetToDefault(id);
    if (!updated) throw new NotFoundError(`Template ${id} not found`);
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}
