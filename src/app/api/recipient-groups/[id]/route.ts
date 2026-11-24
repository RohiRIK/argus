import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import { groupEffectiveEmails } from "@/services/graph/groups";
import { ok, fail } from "@/lib/api";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { parseBody, recipientGroupUpdateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function serialize(g: NonNullable<ReturnType<typeof recipientGroupsDao.findById>>) {
  const resolvedEmails = groupEffectiveEmails(g);
  return { ...g, resolvedEmails, memberCount: resolvedEmails.length };
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const g = recipientGroupsDao.findById(id);
    if (!g) throw new NotFoundError(`Recipient group ${id} not found`);
    return ok(serialize(g));
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const existing = recipientGroupsDao.findById(id);
    if (!existing) throw new NotFoundError(`Recipient group ${id} not found`);
    const patch = await parseBody(req, recipientGroupUpdateSchema);
    if (patch.name && patch.name.trim() !== existing.name && recipientGroupsDao.findByName(patch.name.trim())) {
      throw new ConflictError(`Recipient group "${patch.name.trim()}" already exists`);
    }
    const updated = recipientGroupsDao.update(id, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.staticMembers !== undefined ? { staticMembers: patch.staticMembers } : {}),
    });
    return ok(serialize(updated ?? existing));
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!recipientGroupsDao.findById(id)) throw new NotFoundError(`Recipient group ${id} not found`);
    recipientGroupsDao.delete(id);
    return ok({ deleted: id });
  } catch (err) {
    return fail(err);
  }
}
