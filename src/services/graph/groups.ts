import { getSharedGraphClient, requestIdFromError } from "./client";
import { recipientGroupsDao } from "@/db/dao/recipient-groups";
import type { CachedGroupMember, RecipientGroup } from "@/db/schema";
import { GraphApiError, NotFoundError, ValidationError } from "@/lib/errors";
import { isAlreadyAssignedError } from "@/lib/graph-consent";

export interface EntraGroupSummary {
  id: string;
  displayName: string;
  description: string;
  mail: string | null;
  securityEnabled: boolean;
  groupTypes: string[];
}

export interface EntraUserSummary {
  id: string;
  displayName: string;
  email: string;
}

interface RawGraphGroup {
  id?: string;
  displayName?: string;
  description?: string | null;
  mail?: string | null;
  securityEnabled?: boolean;
  groupTypes?: string[];
}

interface RawGraphUser {
  id?: string;
  displayName?: string;
  mail?: string | null;
  userPrincipalName?: string;
}

export interface GroupGraphClientLike {
  api(path: string): {
    select(s: string): GroupGraphReq;
    filter(f: string): GroupGraphReq;
    top(n: number): GroupGraphReq;
    post(body: unknown): Promise<unknown>;
    delete(): Promise<unknown>;
    get(): Promise<unknown>;
  };
}

interface GroupGraphReq {
  select(s: string): GroupGraphReq;
  filter(f: string): GroupGraphReq;
  top(n: number): GroupGraphReq;
  get(): Promise<unknown>;
}

export interface GroupGraphDeps {
  client?: GroupGraphClientLike;
}

function getClient(deps: GroupGraphDeps): GroupGraphClientLike {
  return deps.client ?? (getSharedGraphClient() as unknown as GroupGraphClientLike);
}

function toMailNickname(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = crypto.randomUUID().slice(0, 6);
  return `${base || "argus-group"}-${suffix}`;
}

function mapForbidden(action: string, err: unknown): GraphApiError {
  const e = err as { statusCode?: number; code?: string; message?: string };
  const cid = requestIdFromError(err);
  if (e?.statusCode === 403 || e?.code === "Authorization_RequestDenied") {
    return new GraphApiError(
      `Missing permission to ${action} — grant Group.ReadWrite.All via Settings → Integrations → Authorize, then retry.`,
      { graphStatus: 403, requestId: cid, cause: err },
    );
  }
  return new GraphApiError(`Graph error while trying to ${action}: ${e?.message ?? String(err)}`, {
    graphStatus: e?.statusCode,
    requestId: cid,
    cause: err,
  });
}

/** List Entra ID groups from Microsoft Graph, optionally filtered client-side by `query`. */
export async function listEntraGroups(
  query = "",
  deps: GroupGraphDeps = {},
): Promise<EntraGroupSummary[]> {
  const client = getClient(deps);
  try {
    const res = (await client
      .api("/groups")
      .select("id,displayName,description,mail,securityEnabled,groupTypes")
      .top(100)
      .get()) as { value?: RawGraphGroup[] };
    const q = query.trim().toLowerCase();
    return (res?.value ?? [])
      .filter((g) => Boolean(g.id && g.displayName))
      .map((g) => ({
        id: g.id!,
        displayName: g.displayName!,
        description: g.description ?? "",
        mail: g.mail ?? null,
        securityEnabled: Boolean(g.securityEnabled),
        groupTypes: g.groupTypes ?? [],
      }))
      .filter(
        (g) =>
          !q ||
          g.displayName.toLowerCase().includes(q) ||
          g.description.toLowerCase().includes(q) ||
          (g.mail ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch (err) {
    throw mapForbidden("list Entra ID groups", err);
  }
}

/** List Entra ID users for the group member picker. */
export async function listEntraUsers(
  query = "",
  deps: GroupGraphDeps = {},
): Promise<EntraUserSummary[]> {
  const client = getClient(deps);
  try {
    const res = (await client
      .api("/users")
      .select("id,displayName,mail,userPrincipalName")
      .top(100)
      .get()) as { value?: RawGraphUser[] };
    const q = query.trim().toLowerCase();
    return (res?.value ?? [])
      .map((u) => {
        const email = (u.mail || u.userPrincipalName || "").trim();
        const upn = (u.userPrincipalName ?? "").trim();
        return {
          id: u.id ?? "",
          displayName: u.displayName ?? email,
          email,
          isExt: upn.includes("#EXT#") || email.includes("#EXT#"),
        };
      })
      .filter((u) => Boolean(u.id && u.email.includes("@") && !u.isExt))
      .map(({ id, displayName, email }) => ({ id, displayName, email }))
      .filter(
        (u) =>
          !q ||
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch (err) {
    throw mapForbidden("list Entra ID users", err);
  }
}

/** Create a new Entra ID Security Group (`POST /groups`). */
export async function createEntraSecurityGroup(
  input: { displayName: string; description?: string },
  deps: GroupGraphDeps = {},
): Promise<EntraGroupSummary> {
  const displayName = input.displayName.trim();
  if (!displayName) throw new ValidationError("Group name is required");
  const client = getClient(deps);
  try {
    const created = (await client.api("/groups").post({
      displayName,
      description: (input.description ?? "").trim() || `Managed by Argus recipient groups`,
      mailEnabled: false,
      securityEnabled: true,
      mailNickname: toMailNickname(displayName),
    })) as RawGraphGroup;
    if (!created?.id) {
      throw new GraphApiError("Entra ID created group without returning an id");
    }
    return {
      id: created.id,
      displayName: created.displayName ?? displayName,
      description: created.description ?? input.description ?? "",
      mail: created.mail ?? null,
      securityEnabled: true,
      groupTypes: created.groupTypes ?? [],
    };
  } catch (err) {
    if (err instanceof GraphApiError) throw err;
    throw mapForbidden(`create Entra group "${displayName}"`, err);
  }
}

/** Fetch all transitive user members of an Entra group, following `@odata.nextLink`. */
export async function fetchEntraGroupMembers(
  entraGroupId: string,
  deps: GroupGraphDeps = {},
): Promise<CachedGroupMember[]> {
  const client = getClient(deps);
  const members: CachedGroupMember[] = [];
  const seenEmails = new Set<string>();
  let nextPath: string | undefined =
    `/groups/${encodeURIComponent(entraGroupId)}/transitiveMembers/microsoft.graph.user`;

  try {
    for (let page = 0; page < 10 && nextPath; page++) {
      const req = client.api(nextPath);
      const res = (page === 0
        ? await req.select("id,displayName,mail,userPrincipalName").top(999).get()
        : await req.get()) as {
        value?: RawGraphUser[];
        "@odata.nextLink"?: string;
      };
      for (const u of res?.value ?? []) {
        const email = (u.mail || u.userPrincipalName || "").trim();
        if (!email.includes("@")) continue;
        const lower = email.toLowerCase();
        if (seenEmails.has(lower)) continue;
        seenEmails.add(lower);
        members.push({
          id: u.id,
          displayName: u.displayName ?? email,
          email,
          source: "entra",
        });
      }
      nextPath = res?.["@odata.nextLink"];
    }
    return members;
  } catch (err) {
    throw mapForbidden(`read members of Entra group ${entraGroupId}`, err);
  }
}

/** Add a directory user to an Entra group (idempotent if already present). */
export async function addEntraGroupMember(
  entraGroupId: string,
  userId: string,
  deps: GroupGraphDeps = {},
): Promise<void> {
  const client = getClient(deps);
  try {
    await client.api(`/groups/${encodeURIComponent(entraGroupId)}/members/$ref`).post({
      "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${userId.trim()}`,
    });
  } catch (err) {
    const e = err as { statusCode?: number; message?: string; body?: string };
    if (isAlreadyAssignedError(e?.statusCode, e?.message ?? e?.body)) return;
    throw mapForbidden("add user to Entra group", err);
  }
}

/** Remove a directory user from an Entra group. */
export async function removeEntraGroupMember(
  entraGroupId: string,
  userId: string,
  deps: GroupGraphDeps = {},
): Promise<void> {
  const client = getClient(deps);
  try {
    await client
      .api(`/groups/${encodeURIComponent(entraGroupId)}/members/${encodeURIComponent(userId)}/$ref`)
      .delete();
  } catch (err) {
    const e = err as { statusCode?: number };
    if (e?.statusCode === 404) return;
    throw mapForbidden("remove user from Entra group", err);
  }
}

/** Refresh an Entra-backed recipient group's member cache in SQLite. */
export async function syncRecipientGroup(
  groupId: string,
  deps: GroupGraphDeps = {},
): Promise<RecipientGroup> {
  const group = recipientGroupsDao.findById(groupId);
  if (!group) throw new NotFoundError(`Recipient group ${groupId} not found`);
  if (!group.entraGroupId) return group;

  try {
    const members = await fetchEntraGroupMembers(group.entraGroupId, deps);
    return (
      recipientGroupsDao.update(group.id, {
        cachedEntraMembers: members,
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
      }) ?? group
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recipientGroupsDao.update(group.id, {
      lastSyncError: message,
    });
    throw err;
  }
}

export const STANDARD_RECIPIENT_GROUPS: Array<{ name: string; description: string }> = [
  {
    name: "Argus - Security Alerts",
    description: "SOC & security responders receiving high-severity identity and threat alerts.",
  },
  {
    name: "Argus - Identity & Access",
    description: "IAM admins receiving MFA coverage, conditional access, and guest hygiene reports.",
  },
  {
    name: "Argus - M365 Operations",
    description: "M365 platform owners receiving license utilization, storage, and app-expiry digests.",
  },
];

/**
 * Idempotently create the 3 standard Argus recipient groups.
 * Attempts Entra Security Group creation if Microsoft 365 is usable; falls back cleanly
 * to local groups with a warning note when Entra isn't connected or lacks Group.ReadWrite.All.
 */
export async function bootstrapDefaultRecipientGroups(
  deps: GroupGraphDeps = {},
): Promise<{
  created: RecipientGroup[];
  skipped: number;
  warnings: string[];
}> {
  const created: RecipientGroup[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (const spec of STANDARD_RECIPIENT_GROUPS) {
    if (recipientGroupsDao.findByName(spec.name)) {
      skipped++;
      continue;
    }

    let entraGroupId: string | null = null;
    let entraDisplayName: string | null = null;
    let managedByArgus = false;
    let lastSyncError: string | null = null;

    try {
      const entra = await createEntraSecurityGroup(
        { displayName: spec.name, description: spec.description },
        deps,
      );
      entraGroupId = entra.id;
      entraDisplayName = entra.displayName;
      managedByArgus = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastSyncError = msg;
      warnings.push(`${spec.name}: created locally (${msg})`);
    }

    const row = recipientGroupsDao.create({
      name: spec.name,
      description: spec.description,
      entraGroupId,
      entraDisplayName,
      managedByArgus,
      staticMembers: [],
      cachedEntraMembers: [],
      lastSyncedAt: entraGroupId ? new Date().toISOString() : null,
      lastSyncError,
    });
    created.push(row);
  }

  return { created, skipped, warnings };
}

/** Combine a group's static + cached Entra members into deduplicated emails. */
export function groupEffectiveEmails(group: RecipientGroup): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  const push = (raw: string) => {
    const email = raw.trim();
    if (!email.includes("@")) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    emails.push(email);
  };
  for (const m of group.cachedEntraMembers ?? []) push(m.email);
  for (const addr of group.staticMembers ?? []) push(addr);
  return emails;
}

export interface ResolvedRecipientsResult {
  emails: string[];
  groupBreakdown: Array<{ id: string; name: string; count: number }>;
  warnings: string[];
}

/**
 * Resolve final delivery addresses from direct recipients + attached groups,
 * falling back to global defaults only when both job-level lists are empty.
 * Optionally live-syncs Entra groups (`syncLive: true`), degrading to cached members on Graph failure.
 */
export async function resolveJobRecipients(
  opts: {
    directRecipients: string[];
    groupIds: string[];
    globalRecipients: string[];
    globalGroupIds: string[];
    syncLive?: boolean;
  },
  deps: GroupGraphDeps = {},
): Promise<ResolvedRecipientsResult> {
  const useJobScope = opts.directRecipients.length > 0 || opts.groupIds.length > 0;
  const direct = useJobScope ? opts.directRecipients : opts.globalRecipients;
  const groupIds = useJobScope ? opts.groupIds : opts.globalGroupIds;

  const seen = new Set<string>();
  const emails: string[] = [];
  const push = (raw: string) => {
    const addr = raw.trim();
    if (!addr.includes("@")) return;
    const key = addr.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    emails.push(addr);
  };

  for (const addr of direct) push(addr);

  const warnings: string[] = [];
  const groupBreakdown: Array<{ id: string; name: string; count: number }> = [];

  if (groupIds.length > 0) {
    const groups = recipientGroupsDao.findByIds(groupIds);
    const byId = new Map(groups.map((g) => [g.id, g]));
    for (const gid of groupIds) {
      let group = byId.get(gid);
      if (!group) {
        warnings.push(`Recipient group ${gid} not found`);
        continue;
      }
      if (opts.syncLive && group.entraGroupId) {
        try {
          group = await syncRecipientGroup(group.id, deps);
        } catch (err) {
          warnings.push(
            `Group "${group.name}" Entra sync failed — using cached members (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
      const resolved = groupEffectiveEmails(group);
      groupBreakdown.push({ id: group.id, name: group.name, count: resolved.length });
      for (const addr of resolved) push(addr);
    }
  }

  return { emails, groupBreakdown, warnings };
}
