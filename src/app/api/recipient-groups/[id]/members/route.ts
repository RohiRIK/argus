import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import {
  addEntraGroupMember,
  groupEffectiveEmails,
  removeEntraGroupMember,
  syncRecipientGroup,
} from "@/services/graph/groups";
import { ok, fail } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseBody, recipientGroupMemberSchema, recipientGroupMembersBatchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function serialize(g: NonNullable<ReturnType<typeof recipientGroupsDao.findById>>) {
  const resolvedEmails = groupEffectiveEmails(g);
  return { ...g, resolvedEmails, memberCount: resolvedEmails.length };
}

async function runInChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

/** PUT /api/recipient-groups/:id/members — apply batched Entra user + static email additions/removals in one save. */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const g = recipientGroupsDao.findById(id);
    if (!g) throw new NotFoundError(`Recipient group ${id} not found`);

    const input = await parseBody(req, recipientGroupMembersBatchSchema);
    const removeUserIds = input.removeEntraUserIds ?? [];
    const addUserIds = input.addEntraUserIds ?? [];
    const addStaticEmails = input.addStaticEmails ?? [];
    const removeStaticEmails = input.removeStaticEmails ?? [];

    const removeSet = new Set(removeUserIds.map((u) => u.trim()).filter(Boolean));
    const addIds = [...new Set(addUserIds.map((u) => u.trim()).filter((u) => u && !removeSet.has(u)))];
    const removeIds = [...removeSet];

    if (addIds.length > 0 || removeIds.length > 0) {
      if (!g.entraGroupId) {
        throw new ValidationError("This is a local group — add email addresses directly.");
      }
      const entraId = g.entraGroupId;
      await runInChunks(addIds, 5, (uid) => addEntraGroupMember(entraId, uid));
      await runInChunks(removeIds, 5, (uid) => removeEntraGroupMember(entraId, uid));
    }

    if (addStaticEmails.length > 0 || removeStaticEmails.length > 0) {
      const removeEmails = new Set(removeStaticEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
      const nextStatic = g.staticMembers.filter((e) => !removeEmails.has(e.trim().toLowerCase()));
      const seenStatic = new Set(nextStatic.map((e) => e.trim().toLowerCase()));
      for (const raw of addStaticEmails) {
        const email = raw.trim();
        const key = email.toLowerCase();
        if (!email || removeEmails.has(key) || seenStatic.has(key)) continue;
        seenStatic.add(key);
        nextStatic.push(email);
      }
      recipientGroupsDao.update(id, { staticMembers: nextStatic });
    }

    const updated =
      addIds.length > 0 || removeIds.length > 0
        ? await syncRecipientGroup(id).catch(() => recipientGroupsDao.findById(id) ?? g)
        : (recipientGroupsDao.findById(id) ?? g);
    return ok(serialize(updated));
  } catch (err) {
    return fail(err);
  }
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
