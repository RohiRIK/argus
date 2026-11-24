import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import {
  addEntraGroupMember,
  groupEffectiveEmails,
  removeEntraGroupMember,
  syncRecipientGroup,
} from "@/services/graph/groups";
import { ok, fail } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseBody, recipientGroupMemberSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function serialize(g: NonNullable<ReturnType<typeof recipientGroupsDao.findById>>) {
  const resolvedEmails = groupEffectiveEmails(g);
  return { ...g, resolvedEmails, memberCount: resolvedEmails.length };
}

/** POST /api/recipient-groups/:id/members — add an Entra user or static email to a group. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const g = recipientGroupsDao.findById(id);
    if (!g) throw new NotFoundError(`Recipient group ${id} not found`);

    const input = await parseBody(req, recipientGroupMemberSchema);
    if (input.kind === "entra") {
      if (!g.entraGroupId) {
        throw new ValidationError("This is a local group — add email addresses directly.");
      }
      await addEntraGroupMember(g.entraGroupId, input.userId);
      const updated = await syncRecipientGroup(id).catch(() => recipientGroupsDao.findById(id) ?? g);
      return ok(serialize(updated));
    }

    const email = input.email.trim();
    const exists = g.staticMembers.some((m) => m.toLowerCase() === email.toLowerCase());
    const next = exists ? g.staticMembers : [...g.staticMembers, email];
    const updated = recipientGroupsDao.update(id, { staticMembers: next }) ?? g;
    return ok(serialize(updated));
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/recipient-groups/:id/members — remove an Entra user or static email from a group. */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const g = recipientGroupsDao.findById(id);
    if (!g) throw new NotFoundError(`Recipient group ${id} not found`);

    const input = await parseBody(req, recipientGroupMemberSchema);
    if (input.kind === "entra") {
      if (!g.entraGroupId) {
        throw new ValidationError("This is a local group.");
      }
      await removeEntraGroupMember(g.entraGroupId, input.userId);
      const updated = await syncRecipientGroup(id).catch(() => recipientGroupsDao.findById(id) ?? g);
      return ok(serialize(updated));
    }

    const email = input.email.trim().toLowerCase();
    const next = g.staticMembers.filter((m) => m.toLowerCase() !== email);
    const updated = recipientGroupsDao.update(id, { staticMembers: next }) ?? g;
    return ok(serialize(updated));
  } catch (err) {
    return fail(err);
  }
}
