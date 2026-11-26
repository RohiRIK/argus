import { GUID_RE } from "@/lib/validation";
import type { AutomationDefinition, AutomationGraphTransport, PlannedAutomationAction } from "../types";
import { asBoolean, asNumber, asString, asStringList, daysSinceIso, latestIso } from "../helpers";

/**
 * User & OS lifecycle automations (joiner / mover / leaver + end-of-support OS).
 * Every mutation here is reversible through its rollbackPayload (re-enable, restore, re-add/remove).
 */

type LifecycleUser = {
  id: string;
  userPrincipalName?: string;
  displayName?: string;
  accountEnabled?: boolean;
  onPremisesSyncEnabled?: boolean | null;
  createdDateTime?: string;
  employeeLeaveDateTime?: string | null;
  signInActivity?: { lastSignInDateTime?: string; lastNonInteractiveSignInDateTime?: string };
  [attr: string]: unknown;
};

const directoryRef = (id: string) => ({ "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${id}` });

function excludedSet(params: Record<string, unknown>): Set<string> {
  return new Set(asStringList(params.excludedUserUpns).map((u) => u.toLowerCase()));
}

function isExcluded(u: LifecycleUser, excluded: Set<string>): boolean {
  return Boolean(u.userPrincipalName && excluded.has(u.userPrincipalName.toLowerCase()));
}

function lastActivityIso(u: LifecycleUser): string | null {
  return latestIso(
    u.signInActivity?.lastSignInDateTime,
    u.signInActivity?.lastNonInteractiveSignInDateTime,
    u.createdDateTime,
  );
}

/** Group must be a cloud, assigned-membership group or we refuse to write to it. */
async function assertWritableGroup(transport: AutomationGraphTransport, groupId: string): Promise<string> {
  if (!GUID_RE.test(groupId)) throw new Error(`"${groupId}" is not a group object id (GUID)`);
  const { data } = await transport.getOne<{
    displayName?: string;
    groupTypes?: string[];
    onPremisesSyncEnabled?: boolean | null;
  }>(`/groups/${groupId}?$select=id,displayName,groupTypes,onPremisesSyncEnabled`);
  if ((data.groupTypes ?? []).includes("DynamicMembership")) throw new Error(`Group ${groupId} is dynamic`);
  if (data.onPremisesSyncEnabled) throw new Error(`Group ${groupId} is synced from on-prem AD`);
  return data.displayName ?? groupId;
}

async function groupMemberIds(
  transport: AutomationGraphTransport,
  groupId: string,
  type: "user" | "device",
): Promise<Set<string>> {
  const res = await transport.get<{ id: string }>(`/groups/${groupId}/members/microsoft.graph.${type}?$select=id&$top=999`);
  return new Set(res.value.map((m) => m.id));
}

function addMemberAction(groupId: string, groupName: string, targetId: string, targetLabel: string, targetType: string, reason: string): PlannedAutomationAction {
  return {
    targetType,
    targetId,
    targetLabel,
    actionType: "add_group_member",
    reason,
    beforeState: { groupId, groupName, member: false },
    plannedAfterState: { groupId, groupName, member: true },
    rollbackPayload: {
      method: "DELETE",
      path: `/groups/${groupId}/members/${targetId}/$ref`,
      description: `Remove "${targetLabel}" from group "${groupName}"`,
    },
    meta: { groupId, op: "add" },
  };
}

function removeMemberAction(groupId: string, groupName: string, targetId: string, targetLabel: string, targetType: string, reason: string): PlannedAutomationAction {
  return {
    targetType,
    targetId,
    targetLabel,
    actionType: "remove_group_member",
    reason,
    beforeState: { groupId, groupName, member: true },
    plannedAfterState: { groupId, groupName, member: false },
    rollbackPayload: {
      method: "POST",
      path: `/groups/${groupId}/members/$ref`,
      body: directoryRef(targetId),
      description: `Re-add "${targetLabel}" to group "${groupName}"`,
    },
    meta: { groupId, op: "remove" },
  };
}

async function applyMembership(transport: AutomationGraphTransport, action: PlannedAutomationAction) {
  const groupId = String(action.meta?.groupId);
  if (action.meta?.op === "add") {
    await transport.post(`/groups/${groupId}/members/$ref`, directoryRef(action.targetId));
  } else {
    await transport.delete(`/groups/${groupId}/members/${action.targetId}/$ref`);
  }
  return { afterState: action.plannedAfterState ?? {}, rollbackPayload: action.rollbackPayload ?? null };
}

const EXCLUDED_USERS_FIELD = {
  key: "excludedUserUpns",
  label: "Excluded User UPNs",
  type: "string_list" as const,
  description: "Break-glass, service and shared accounts that must never be touched.",
  defaultValue: [],
};

/* ── 1. Leaver offboarding ─────────────────────────────────────────────── */
export const leaverOffboardingAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "leaver-offboarding",
  version: "1.0.0",
  name: "Leaver Offboarding (Leave Date)",
  category: "identity",
  riskLevel: "high",
  description:
    "Disables sign-in and revokes all refresh tokens for cloud members whose HR employeeLeaveDateTime has passed (plus optional grace days). Rollback re-enables the account.",
  requiredPermissions: ["User.ReadWrite.All", "User-LifeCycleInfo.Read.All"],
  recommendedSchedule: "daily",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "entra",
  dataSource: "graph-v1",
  tags: ["lifecycle", "leaver", "offboarding", "users"],
  paramSchema: [
    {
      key: "graceDays",
      label: "Grace Days After Leave Date",
      type: "number",
      description: "Wait this many days after employeeLeaveDateTime before disabling (0 = same day).",
      defaultValue: 0,
    },
    EXCLUDED_USERS_FIELD,
  ],

  async plan(transport, params) {
    const grace = asNumber(params.graceDays, 0, 0);
    const excluded = excludedSet(params);
    const res = await transport.get<LifecycleUser>(
      "/users?$filter=accountEnabled eq true and userType eq 'Member'&$select=id,userPrincipalName,displayName,onPremisesSyncEnabled,employeeLeaveDateTime&$top=999",
    );
    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;
    for (const u of res.value) {
      if (!u.id || isExcluded(u, excluded) || u.onPremisesSyncEnabled) continue;
      evaluated++;
      const pastLeave = daysSinceIso(u.employeeLeaveDateTime);
      if (pastLeave === null || pastLeave < grace) continue;
      const label = u.userPrincipalName ?? u.id;
      actions.push({
        targetType: "user",
        targetId: u.id,
        targetLabel: label,
        actionType: "disable_and_revoke_sessions",
        reason: `Leave date ${u.employeeLeaveDateTime} passed ${pastLeave} day(s) ago`,
        beforeState: { accountEnabled: true, employeeLeaveDateTime: u.employeeLeaveDateTime },
        plannedAfterState: { accountEnabled: false, sessionsRevoked: true },
        rollbackPayload: {
          method: "PATCH",
          path: `/users/${u.id}`,
          body: { accountEnabled: true },
          description: `Re-enable sign-in for "${label}"`,
        },
      });
    }
    return {
      evaluatedCount: evaluated,
      summary: actions.length
        ? `${actions.length} leaver(s) past their leave date still have active accounts.`
        : `Checked ${evaluated} enabled cloud member(s); no leavers past their leave date.`,
      actions,
    };
  },

  async apply(transport, action) {
    await transport.patch(`/users/${action.targetId}`, { accountEnabled: false });
    await transport.post(`/users/${action.targetId}/revokeSignInSessions`, {});
    return { afterState: { accountEnabled: false, sessionsRevoked: true }, rollbackPayload: action.rollbackPayload ?? null };
  },
};

/* ── 2. Inactive user disable ──────────────────────────────────────────── */
export const inactiveUserDisableAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "inactive-user-disable",
  version: "1.0.0",
  name: "Inactive Member Account Disable",
  category: "identity",
  riskLevel: "high",
  description:
    "Blocks sign-in for cloud member accounts with no interactive or non-interactive sign-in for N days. Skips AD-synced and excluded accounts. Rollback re-enables.",
  requiredPermissions: ["User.ReadWrite.All", "AuditLog.Read.All"],
  recommendedSchedule: "weekly",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "entra",
  dataSource: "graph-v1",
  tags: ["lifecycle", "inactive-users", "zero-trust", "users"],
  pairedReportId: "dormant-licensed-users",
  paramSchema: [
    {
      key: "inactivityDays",
      label: "Inactivity Threshold (Days)",
      type: "number",
      description: "Days without any sign-in before the account is disabled (minimum 30).",
      defaultValue: 90,
    },
    EXCLUDED_USERS_FIELD,
  ],

  async plan(transport, params) {
    const days = asNumber(params.inactivityDays, 90, 30);
    const excluded = excludedSet(params);
    const res = await transport.get<LifecycleUser>(
      "/users?$filter=accountEnabled eq true and userType eq 'Member'&$select=id,userPrincipalName,onPremisesSyncEnabled,createdDateTime,signInActivity&$top=999",
    );
    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;
    for (const u of res.value) {
      if (!u.id || isExcluded(u, excluded) || u.onPremisesSyncEnabled) continue;
      evaluated++;
      const last = lastActivityIso(u);
      const idle = daysSinceIso(last);
      if (idle === null || idle < days) continue;
      const label = u.userPrincipalName ?? u.id;
      actions.push({
        targetType: "user",
        targetId: u.id,
        targetLabel: label,
        actionType: "disable_inactive_user",
        reason: `No sign-in for ${idle} days (threshold ${days}d)`,
        beforeState: { accountEnabled: true, lastActivity: last },
        plannedAfterState: { accountEnabled: false },
        rollbackPayload: {
          method: "PATCH",
          path: `/users/${u.id}`,
          body: { accountEnabled: true },
          description: `Re-enable sign-in for "${label}"`,
        },
      });
    }
    return {
      evaluatedCount: evaluated,
      summary: actions.length
        ? `${actions.length} member account(s) inactive ≥ ${days} days.`
        : `All ${evaluated} cloud member(s) signed in within ${days} days.`,
      actions,
    };
  },

  async apply(transport, action) {
    await transport.patch(`/users/${action.targetId}`, { accountEnabled: false });
    return { afterState: { accountEnabled: false }, rollbackPayload: action.rollbackPayload ?? null };
  },
};

/* ── 3. Disabled user cleanup ──────────────────────────────────────────── */
export const disabledUserCleanupAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "disabled-user-cleanup",
  version: "1.0.0",
  name: "Disabled Account Cleanup (Soft-Delete)",
  category: "identity",
  riskLevel: "high",
  description:
    "Soft-deletes cloud member accounts that are disabled and have had no sign-in for N days. Objects stay restorable from the Entra recycle bin for 30 days (one-click rollback).",
  requiredPermissions: ["User.ReadWrite.All", "AuditLog.Read.All"],
  recommendedSchedule: "weekly",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "entra",
  dataSource: "graph-v1",
  tags: ["lifecycle", "leaver", "cleanup", "users"],
  paramSchema: [
    {
      key: "inactivityDays",
      label: "Delete After N Days Without Sign-In",
      type: "number",
      description: "Disabled accounts idle at least this long are soft-deleted (minimum 30).",
      defaultValue: 180,
    },
    EXCLUDED_USERS_FIELD,
  ],

  async plan(transport, params) {
    const days = asNumber(params.inactivityDays, 180, 30);
    const excluded = excludedSet(params);
    const res = await transport.get<LifecycleUser>(
      "/users?$filter=accountEnabled eq false and userType eq 'Member'&$select=id,userPrincipalName,onPremisesSyncEnabled,createdDateTime,signInActivity&$top=999",
    );
    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;
    for (const u of res.value) {
      if (!u.id || isExcluded(u, excluded) || u.onPremisesSyncEnabled) continue;
      evaluated++;
      const last = lastActivityIso(u);
      const idle = daysSinceIso(last);
      if (idle === null || idle < days) continue;
      const label = u.userPrincipalName ?? u.id;
      actions.push({
        targetType: "user",
        targetId: u.id,
        targetLabel: label,
        actionType: "soft_delete_user",
        reason: `Disabled and idle for ${idle} days (threshold ${days}d)`,
        beforeState: { accountEnabled: false, lastActivity: last },
        plannedAfterState: { deletedToRecycleBin: true },
        rollbackPayload: {
          method: "POST",
          path: `/directory/deletedItems/${u.id}/restore`,
          body: {},
          description: `Restore "${label}" from the 30-day recycle bin`,
        },
      });
    }
    return {
      evaluatedCount: evaluated,
      summary: actions.length
        ? `${actions.length} disabled account(s) idle ≥ ${days} days are ready for soft-delete.`
        : `Checked ${evaluated} disabled account(s); none idle ≥ ${days} days.`,
      actions,
    };
  },

  async apply(transport, action) {
    await transport.delete(`/users/${action.targetId}`);
    return { afterState: { deletedToRecycleBin: true }, rollbackPayload: action.rollbackPayload ?? null };
  },
};

/* ── 4. Joiner / mover attribute → group sync ──────────────────────────── */
const SYNC_ATTRIBUTES = ["department", "jobTitle", "companyName", "officeLocation", "country", "employeeType"] as const;
type SyncAttribute = (typeof SYNC_ATTRIBUTES)[number];

export interface GroupSyncRule {
  attribute: SyncAttribute;
  value: string;
  groupId: string;
}

/** Parses `department=Sales => <groupId>` rules; throws on malformed input so plan() fails loudly. */
export function parseGroupSyncRules(raw: string[]): GroupSyncRule[] {
  return raw.map((line) => {
    const m = /^\s*([A-Za-z]+)\s*=\s*(.+?)\s*=>\s*([0-9a-fA-F-]{36})\s*$/.exec(line);
    if (!m) throw new Error(`Invalid rule "${line}". Expected: attribute=value => groupObjectId`);
    const attribute = SYNC_ATTRIBUTES.find((a) => a.toLowerCase() === m[1].toLowerCase());
    if (!attribute) throw new Error(`Unsupported attribute "${m[1]}". Use one of: ${SYNC_ATTRIBUTES.join(", ")}`);
    return { attribute, value: m[2], groupId: m[3].toLowerCase() };
  });
}

export const joinerMoverGroupSyncAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "joiner-mover-group-sync",
  version: "1.0.0",
  name: "Joiner / Mover Group Sync",
  category: "governance",
  riskLevel: "medium",
  description:
    "Keeps assigned cloud groups in sync with HR attributes (department, jobTitle, company, office, country, employeeType). Adds joiners/movers and, optionally, removes users who no longer match. No Entra P1 dynamic groups needed.",
  requiredPermissions: ["User.Read.All", "GroupMember.ReadWrite.All"],
  recommendedSchedule: "daily",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "groups",
  dataSource: "graph-v1",
  tags: ["lifecycle", "joiner", "mover", "groups", "rbac"],
  paramSchema: [
    {
      key: "rules",
      label: "Rules",
      type: "string_list",
      description: "One per entry: attribute=value => groupObjectId (e.g. department=Sales => 0f1c…). Matching is case-insensitive.",
      required: true,
      placeholder: "department=Sales => 00000000-0000-0000-0000-000000000000",
      defaultValue: [],
    },
    {
      key: "removeNonMatching",
      label: "Remove Users Who No Longer Match (Movers/Leavers)",
      type: "boolean",
      description: "Remove group members whose attribute changed. Off = add-only.",
      defaultValue: true,
    },
    EXCLUDED_USERS_FIELD,
  ],

  async plan(transport, params) {
    const rules = parseGroupSyncRules(asStringList(params.rules));
    if (rules.length === 0) return { evaluatedCount: 0, summary: "No rules configured.", actions: [] };
    const removeStale = asBoolean(params.removeNonMatching, true);
    const excluded = excludedSet(params);

    const res = await transport.get<LifecycleUser>(
      `/users?$filter=accountEnabled eq true and userType eq 'Member'&$select=id,userPrincipalName,${SYNC_ATTRIBUTES.join(",")}&$top=999`,
    );
    const users = res.value.filter((u) => u.id && !isExcluded(u, excluded));
    const byId = new Map(users.map((u) => [u.id, u]));
    const actions: PlannedAutomationAction[] = [];

    // Several rules may feed one group: a user matching ANY rule for that group belongs in it.
    const rulesByGroup = new Map<string, GroupSyncRule[]>();
    for (const r of rules) rulesByGroup.set(r.groupId, [...(rulesByGroup.get(r.groupId) ?? []), r]);

    for (const [groupId, groupRules] of rulesByGroup) {
      const groupName = await assertWritableGroup(transport, groupId);
      const current = await groupMemberIds(transport, groupId, "user");
      const matchingRule = (u: LifecycleUser) =>
        groupRules.find((r) => String(u[r.attribute] ?? "").trim().toLowerCase() === r.value.toLowerCase());

      for (const u of users) {
        const rule = matchingRule(u);
        if (rule && !current.has(u.id)) {
          actions.push(addMemberAction(groupId, groupName, u.id, u.userPrincipalName ?? u.id, "user",
            `${rule.attribute} is "${String(u[rule.attribute])}" (joiner/mover)`));
        }
      }
      if (!removeStale) continue;
      for (const memberId of current) {
        const u = byId.get(memberId);
        // Only remove enabled, non-excluded users we evaluated and who match no rule for this group.
        if (u && !matchingRule(u)) {
          actions.push(removeMemberAction(groupId, groupName, u.id, u.userPrincipalName ?? u.id, "user",
            `No longer matches ${groupRules.map((r) => `${r.attribute}=${r.value}`).join(" or ")}`));
        }
      }
    }

    return {
      evaluatedCount: users.length,
      summary: actions.length
        ? `${actions.length} membership change(s) across ${rulesByGroup.size} group(s).`
        : `All ${rulesByGroup.size} rule group(s) are in sync.`,
      actions,
    };
  },

  apply: (transport, action) => applyMembership(transport, action),
};

/* ── 5. End-of-support OS lifecycle ────────────────────────────────────── */

/** Numeric dotted-version compare: returns <0, 0, >0. Non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const OS_PARAM: Record<string, string> = {
  windows: "minWindowsVersion",
  ios: "minIosVersion",
  ipados: "minIosVersion",
  macos: "minMacosVersion",
  android: "minAndroidVersion",
};

export const unsupportedOsLifecycleAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "unsupported-os-lifecycle",
  version: "1.0.0",
  name: "End-of-Support OS Device Lifecycle",
  category: "devices",
  riskLevel: "low",
  description:
    "Finds Intune devices running an OS below your supported minimum per platform (e.g. Windows 10) and keeps them in an 'Unsupported OS' Entra group, removing devices once upgraded. Target that group with Conditional Access or Intune policies.",
  requiredPermissions: ["DeviceManagementManagedDevices.Read.All", "Device.Read.All", "GroupMember.ReadWrite.All", "Group.Create"],
  recommendedSchedule: "daily",
  recommendedMode: "audit",
  service: "Microsoft Intune & Entra",
  icon: "intune",
  dataSource: "graph-v1",
  tags: ["lifecycle", "devices", "os", "end-of-support", "patching"],
  pairedReportId: "device-compliance",
  paramSchema: [
    {
      key: "targetGroupId",
      label: "Unsupported OS Group (Object ID)",
      type: "string",
      description: "Assigned cloud security group that holds end-of-support devices.",
      required: true,
      placeholder: "00000000-0000-0000-0000-000000000000",
      provision: {
        kind: "securityGroup",
        displayName: "Argus - Unsupported OS Devices",
        description: "Devices below the supported OS minimum. Membership managed by Argus; target with CA/Intune.",
      },
    },
    { key: "minWindowsVersion", label: "Minimum Windows Version", type: "string", description: "10.0.22000 = Windows 11 (Windows 10 ended support Oct 2025).", defaultValue: "10.0.22000" },
    { key: "minIosVersion", label: "Minimum iOS / iPadOS Version", type: "string", description: "Leave empty to skip the platform.", defaultValue: "17.0" },
    { key: "minMacosVersion", label: "Minimum macOS Version", type: "string", description: "Leave empty to skip the platform.", defaultValue: "14.0" },
    { key: "minAndroidVersion", label: "Minimum Android Version", type: "string", description: "Leave empty to skip the platform.", defaultValue: "13" },
  ],

  async plan(transport, params) {
    const groupId = asString(params.targetGroupId).trim().toLowerCase();
    if (!groupId) {
      return { evaluatedCount: 0, summary: "Configure the Unsupported OS Group (Object ID) to evaluate devices.", actions: [] };
    }
    const groupName = await assertWritableGroup(transport, groupId);

    const mdm = await transport.get<{
      id: string;
      deviceName?: string;
      operatingSystem?: string;
      osVersion?: string;
      azureADDeviceId?: string;
    }>("/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,osVersion,azureADDeviceId&$top=999");
    // Group membership uses the Entra device object id, not Intune's id or the deviceId GUID.
    const entra = await transport.get<{ id: string; deviceId?: string }>("/devices?$select=id,deviceId&$top=999");
    const objectIdByDeviceId = new Map(entra.value.filter((d) => d.deviceId).map((d) => [d.deviceId!.toLowerCase(), d.id]));
    const current = await groupMemberIds(transport, groupId, "device");

    const actions: PlannedAutomationAction[] = [];
    const supportedIds = new Set<string>();
    let evaluated = 0;

    for (const d of mdm.value) {
      const min = asString(params[OS_PARAM[(d.operatingSystem ?? "").toLowerCase()] ?? ""]).trim();
      const objectId = d.azureADDeviceId ? objectIdByDeviceId.get(d.azureADDeviceId.toLowerCase()) : undefined;
      if (!min || !d.osVersion || !objectId) continue;
      evaluated++;
      const label = `${d.deviceName ?? d.id} (${d.operatingSystem} ${d.osVersion})`;
      if (compareVersions(d.osVersion, min) >= 0) {
        supportedIds.add(objectId);
        continue;
      }
      if (!current.has(objectId)) {
        actions.push(addMemberAction(groupId, groupName, objectId, label, "device", `${d.operatingSystem} ${d.osVersion} is below minimum ${min}`));
      }
    }
    // Upgraded devices leave the group; members we could not evaluate are left alone.
    for (const memberId of current) {
      if (supportedIds.has(memberId)) {
        actions.push(removeMemberAction(groupId, groupName, memberId, memberId, "device", "OS upgraded to a supported version"));
      }
    }

    return {
      evaluatedCount: evaluated,
      summary: actions.length
        ? `${actions.length} device membership change(s) for "${groupName}".`
        : `All ${evaluated} evaluated device(s) are correctly classified.`,
      actions,
    };
  },

  apply: (transport, action) => applyMembership(transport, action),
};

export const LIFECYCLE_AUTOMATIONS: readonly AutomationDefinition[] = [
  leaverOffboardingAutomation,
  inactiveUserDisableAutomation,
  disabledUserCleanupAutomation,
  joinerMoverGroupSyncAutomation,
  unsupportedOsLifecycleAutomation,
];
