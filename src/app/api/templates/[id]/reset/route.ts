import { templatesDao } from "@/db/dao/templates";
import { ok, fail } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { DEFAULT_SUBJECT, DEFAULT_TEMPLATE_HTML, DEFAULT_TEXT_TEMPLATE } from "@/services/report-engine/default-template";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/templates/:id/reset — restore built-in defaults (snapshots prior version). */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const updated = templatesDao.update(id, {
      subject: DEFAULT_SUBJECT,
      htmlBody: DEFAULT_TEMPLATE_HTML,
      textBody: DEFAULT_TEXT_TEMPLATE,
    });
    if (!updated) throw new NotFoundError(`Template ${id} not found`);
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}
