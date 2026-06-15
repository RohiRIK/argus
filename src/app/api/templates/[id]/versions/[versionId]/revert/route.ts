import { templatesDao, templateVersionsDao } from "@/db/dao/templates";
import { ok, fail } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; versionId: string }> };

/**
 * POST /api/templates/:id/versions/:versionId/revert — restore a previous
 * snapshot's content. The revert is itself versioned (the pre-revert state is
 * snapshotted first by templatesDao.update).
 */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { id, versionId } = await params;
    if (!templatesDao.findById(id)) throw new NotFoundError(`Template ${id} not found`);
    const version = templateVersionsDao.findById(versionId);
    if (!version) throw new NotFoundError(`Version ${versionId} not found`);
    if (version.templateId !== id) throw new ValidationError("Version does not belong to this template.");
    const reverted = templatesDao.update(id, {
      subject: version.subject,
      htmlBody: version.htmlBody,
      textBody: version.textBody,
    });
    return ok(reverted);
  } catch (err) {
    return fail(err);
  }
}
