import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import { groupEffectiveEmails, syncRecipientGroup } from "@/services/graph/groups";
import { ok, fail } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/recipient-groups/:id/sync — live-sync members from Entra ID. */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const g = recipientGroupsDao.findById(id);
    if (!g) throw new NotFoundError(`Recipient group ${id} not found`);
    if (!g.entraGroupId) {
      throw new ValidationError("Local groups are not backed by an Entra ID group.");
    }
    const updated = await syncRecipientGroup(id);
    const resolvedEmails = groupEffectiveEmails(updated);
    return ok({ ...updated, resolvedEmails, memberCount: resolvedEmails.length });
  } catch (err) {
    return fail(err);
  }
}
