import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import {
  bootstrapDefaultRecipientGroups,
  createEntraSecurityGroup,
  groupEffectiveEmails,
  listEntraGroups,
  syncRecipientGroup,
} from "@/services/graph/groups";
import { ok, fail } from "@/lib/api";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { parseBody, recipientGroupCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

function serializeGroup(g: NonNullable<ReturnType<typeof recipientGroupsDao.findById>>) {
  const resolvedEmails = groupEffectiveEmails(g);
  return {
    ...g,
    resolvedEmails,
    memberCount: resolvedEmails.length,
  };
}

/** GET /api/recipient-groups — list all recipient groups with computed effective members. */
export async function GET() {
  try {
    const groups = recipientGroupsDao.findAll().map(serializeGroup);
    return ok(groups, { total: groups.length });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/recipient-groups — create (Entra/linked/local) or bootstrap 3 standard groups. */
export async function POST(req: Request) {
  try {
    const input = await parseBody(req, recipientGroupCreateSchema);
    if (input.action === "bootstrap") {
      const res = await bootstrapDefaultRecipientGroups();
      return ok({
        created: res.created.map(serializeGroup),
        createdCount: res.created.length,
        skippedCount: res.skipped,
        warnings: res.warnings,
      });
    }

    const name = input.name!.trim();
    if (recipientGroupsDao.findByName(name)) {
      throw new ConflictError(`Recipient group "${name}" already exists`);
    }

    if (input.mode === "create_entra") {
      const desc = (input.description ?? "").trim();
      const entra = await createEntraSecurityGroup({
        displayName: name,
        description: desc,
      });
      const created = recipientGroupsDao.create({
        name,
        description: desc,
        entraGroupId: entra.id,
        entraDisplayName: entra.displayName,
        managedByArgus: true,
        staticMembers: input.staticMembers ?? [],
        cachedEntraMembers: [],
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
      });
      return ok(serializeGroup(created));
    }

    if (input.mode === "link_entra") {
      const entraId = input.entraGroupId!.trim();
      const existing = recipientGroupsDao.findByEntraId(entraId);
      if (existing) {
        throw new ConflictError(`Entra group is already linked as "${existing.name}"`);
      }
      const matches = await listEntraGroups("");
      const target = matches.find((g) => g.id === entraId);
      if (!target) {
        throw new NotFoundError(`Entra ID group ${entraId} not found`);
      }
      const created = recipientGroupsDao.create({
        name,
        description: (input.description ?? "").trim() || target.description,
        entraGroupId: target.id,
        entraDisplayName: target.displayName,
        managedByArgus: false,
        staticMembers: input.staticMembers ?? [],
        cachedEntraMembers: [],
        lastSyncedAt: null,
        lastSyncError: null,
      });
      const synced = await syncRecipientGroup(created.id).catch(() => created);
      return ok(serializeGroup(synced));
    }

    // mode === "local"
    const created = recipientGroupsDao.create({
      name,
      description: (input.description ?? "").trim(),
      entraGroupId: null,
      entraDisplayName: null,
      managedByArgus: false,
      staticMembers: input.staticMembers ?? [],
      cachedEntraMembers: [],
      lastSyncedAt: null,
      lastSyncError: null,
    });
    return ok(serializeGroup(created));
  } catch (err) {
    return fail(err);
  }
}
