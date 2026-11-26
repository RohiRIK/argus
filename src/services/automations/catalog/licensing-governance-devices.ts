import { GUID_RE } from "@/lib/validation";
import type { AutomationDefinition, PlannedAutomationAction } from "../types";
import {
  asBoolean,
  asNumber,
  asString,
  asStringList,
  daysSinceIso,
  GLOBAL_ADMIN_ROLE_TEMPLATE_ID,
  latestIso,
} from "../helpers";

/**
 * 9. Disabled User License & Group Reclaim
 */
export const disabledUserLicenseGroupReclaimAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "disabled-user-license-group-reclaim",
  version: "1.0.0",
  name: "Disabled User License & Group Reclaim",
  category: "licensing",
  riskLevel: "medium",
  description:
    "Reclaims direct M365 SKUs and removes mutable cloud group memberships from sign-in-blocked accounts while preserving legal-hold/archiving SKUs and skipping group-inherited licenses or Dynamic/AD-synced groups.",
  requiredPermissions: ["User.ReadWrite.All", "GroupMember.ReadWrite.All", "Directory.Read.All"],
  recommendedSchedule: "daily",
  recommendedMode: "audit",
  service: "Microsoft 365 Licensing",
  icon: "licenses",
  dataSource: "graph-v1",
  tags: ["licensing", "offboarding", "finops", "cost-savings", "groups"],
  pairedReportId: "license-utilization",
  paramSchema: [
    {
      key: "protectedSkuPartNumbers",
      label: "Protected Retention SKU Part Numbers",
      type: "string_list",
      description: "SKUs retained on disabled users for mailbox litigation hold/archiving.",
      defaultValue: ["EXCHANGEENTERPRISE", "EXCHANGEARCHIVE_ADDON"],
    },
    {
      key: "removeGroupMemberships",
      label: "Also Remove Cloud Group Memberships",
      type: "boolean",
      description: "Remove disabled users from cloud-managed non-dynamic, non-role-assignable groups.",
      defaultValue: true,
    },
    {
      key: "excludedUserUpns",
      label: "Excluded User UPNs",
      type: "string_list",
      description: "Shared/room/leave accounts exempt from license reclamation.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const protectedParts = new Set(asStringList(params.protectedSkuPartNumbers).map((s) => s.toUpperCase()));
    const removeGroups = asBoolean(params.removeGroupMemberships, true);
    const excludedUsers = new Set(asStringList(params.excludedUserUpns).map((u) => u.toLowerCase()));

    const skusRes = await transport.get<{ skuId: string; skuPartNumber?: string }>(
      "/subscribedSkus?$select=skuId,skuPartNumber",
    );
    const skuNameById = new Map<string, string>();
    const protectedSkuIds = new Set<string>();
    for (const s of skusRes.value) {
      if (!s.skuId) continue;
      const part = s.skuPartNumber ?? s.skuId;
      skuNameById.set(s.skuId.toLowerCase(), part);
      if (protectedParts.has(part.toUpperCase())) protectedSkuIds.add(s.skuId.toLowerCase());
    }

    const usersRes = await transport.get<{
      id: string;
      userPrincipalName?: string;
      displayName?: string;
      assignedLicenses?: Array<{ skuId: string; disabledPlans?: string[] }>;
      licenseAssignmentStates?: Array<{ skuId?: string; assignedByGroup?: string | null }>;
    }>(
      "/users?$filter=accountEnabled eq false and userType eq 'Member'&$select=id,userPrincipalName,displayName,assignedLicenses,licenseAssignmentStates&$top=500",
    );

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const u of usersRes.value) {
      if (!u.id) continue;
      const upn = (u.userPrincipalName ?? "").toLowerCase();
      if (upn && excludedUsers.has(upn)) continue;
      evaluated++;

      // Skip group-based licenses (must be removed by group membership, not assignLicense).
      const groupAssignedSkus = new Set(
        (u.licenseAssignmentStates ?? [])
          .filter((st) => st.skuId && st.assignedByGroup)
          .map((st) => st.skuId!.toLowerCase()),
      );

      const removableLicenses = (u.assignedLicenses ?? []).filter(
        (lic) =>
          lic.skuId &&
          !protectedSkuIds.has(lic.skuId.toLowerCase()) &&
          !groupAssignedSkus.has(lic.skuId.toLowerCase()),
      );

      let removableGroups: Array<{ id: string; displayName: string }> = [];
      if (removeGroups) {
        const grpRes = await transport.get<{
          id: string;
          displayName?: string;
          groupTypes?: string[];
          onPremisesSyncEnabled?: boolean | null;
          isAssignableToRole?: boolean | null;
        }>(
          `/users/${u.id}/memberOf/microsoft.graph.group?$select=id,displayName,groupTypes,onPremisesSyncEnabled,isAssignableToRole`,
        );
        removableGroups = grpRes.value
          .filter(
            (g) =>
              g.id &&
              !(g.groupTypes ?? []).includes("DynamicMembership") &&
              !g.onPremisesSyncEnabled &&
              !g.isAssignableToRole,
          )
          .map((g) => ({ id: g.id, displayName: g.displayName ?? g.id }));
      }

      if (removableLicenses.length === 0 && removableGroups.length === 0) continue;

      const skuLabels = removableLicenses.map(
        (l) => skuNameById.get(l.skuId.toLowerCase()) ?? l.skuId,
      );
      const parts: string[] = [];
      if (skuLabels.length) parts.push(`${skuLabels.length} direct SKU(s) [${skuLabels.join(", ")}]`);
      if (removableGroups.length) parts.push(`${removableGroups.length} cloud group(s)`);

      const label = u.userPrincipalName ?? u.displayName ?? u.id;
      actions.push({
        targetType: "disabledUser",
        targetId: u.id,
        targetLabel: label,
        actionType: "reclaim_licenses_and_groups",
        reason: `Disabled account still holds ${parts.join(" + ")}`,
        beforeState: {
          userId: u.id,
          userPrincipalName: u.userPrincipalName ?? null,
          removedLicenses: removableLicenses,
          removedGroups: removableGroups,
        },
        plannedAfterState: {
          userId: u.id,
          reclaimedSkuIds: removableLicenses.map((l) => l.skuId),
          removedGroupIds: removableGroups.map((g) => g.id),
        },
        rollbackPayload:
          removableLicenses.length > 0
            ? {
                method: "POST",
                path: `/users/${u.id}/assignLicense`,
                body: {
                  addLicenses: removableLicenses.map((l) => ({
                    skuId: l.skuId,
                    disabledPlans: l.disabledPlans ?? [],
                  })),
                  removeLicenses: [],
                },
                description: `Re-assign reclaimed SKU(s) [${skuLabels.join(", ")}] to "${label}"`,
              }
            : null,
        meta: {
          removeSkuIds: removableLicenses.map((l) => l.skuId),
          removeGroupIds: removableGroups.map((g) => g.id),
        },
      });
    }

    return {
      evaluatedCount: evaluated,
      summary:
        actions.length === 0
          ? `Evaluated ${evaluated} disabled user account(s); zero reclaimable direct licenses or cloud groups found.`
          : `Identified ${actions.length} disabled user account(s) with reclaimable licenses/groups.`,
      actions,
    };
  },

  async apply(transport, action) {
    const removeSkuIds = (action.meta?.removeSkuIds as string[] | undefined) ?? [];
    const removeGroupIds = (action.meta?.removeGroupIds as string[] | undefined) ?? [];

    if (removeSkuIds.length > 0) {
      await transport.post(`/users/${action.targetId}/assignLicense`, {
        addLicenses: [],
        removeLicenses: removeSkuIds,
      });
    }
    for (const groupId of removeGroupIds) {
      await transport.delete(`/groups/${groupId}/members/${action.targetId}/$ref`);
    }

    return {
      afterState: {
        userId: action.targetId,
        reclaimedSkuIds: removeSkuIds,
        removedGroupIds: removeGroupIds,
      },
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};

/**
 * 10. Dormant Active-User Add-On & Premium License Reclaim
 */
export const dormantUserLicenseReclaimAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "dormant-user-license-reclaim",
  version: "1.0.0",
  name: "Dormant Premium & Add-On License Reclaim",
  category: "licensing",
  riskLevel: "medium",
  description:
    "Reclaims expensive direct add-on SKUs (Copilot, Project, Visio, Power BI Pro) from enabled users with zero sign-in activity past N days without disabling their base account.",
  requiredPermissions: ["User.ReadWrite.All", "AuditLog.Read.All", "Organization.Read.All"],
  recommendedSchedule: "weekly",
  recommendedMode: "audit",
  service: "Microsoft 365 Licensing",
  icon: "licenses",
  dataSource: "graph-v1",
  tags: ["copilot", "licensing", "finops", "dormant-users", "cost-optimization"],
  pairedReportId: "dormant-licensed-users",
  paramSchema: [
    {
      key: "inactivityDays",
      label: "Sign-In Inactivity Threshold (Days)",
      type: "number",
      description: "Minimum days without interactive or non-interactive sign-in before reclaiming target SKUs.",
      defaultValue: 60,
    },
    {
      key: "targetSkuPartNumbers",
      label: "Target Reclaimable SKU Part Numbers",
      type: "string_list",
      description: "SKU part numbers eligible for dormant reclamation.",
      defaultValue: ["Microsoft_365_Copilot", "PROJECTPROFESSIONAL", "VISIOCLIENT", "POWER_BI_PRO"],
    },
    {
      key: "excludedUserUpns",
      label: "Excluded User UPNs",
      type: "string_list",
      description: "Executive or seasonal accounts exempt from dormant license reclaim.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const inactivityDays = asNumber(params.inactivityDays, 60, 14);
    const targetParts = new Set(asStringList(params.targetSkuPartNumbers).map((s) => s.toUpperCase()));
    const excludedUsers = new Set(asStringList(params.excludedUserUpns).map((u) => u.toLowerCase()));

    const skusRes = await transport.get<{ skuId: string; skuPartNumber?: string }>(
      "/subscribedSkus?$select=skuId,skuPartNumber",
    );
    const targetSkuMap = new Map<string, string>();
    for (const s of skusRes.value) {
      if (s.skuId && s.skuPartNumber && targetParts.has(s.skuPartNumber.toUpperCase())) {
        targetSkuMap.set(s.skuId.toLowerCase(), s.skuPartNumber);
      }
    }
    if (targetSkuMap.size === 0) {
      return {
        evaluatedCount: 0,
        summary: "None of the configured target SKU part numbers are present in tenant subscribedSkus.",
        actions: [],
      };
    }

    const usersRes = await transport.get<{
      id: string;
      userPrincipalName?: string;
      createdDateTime?: string;
      assignedLicenses?: Array<{ skuId: string; disabledPlans?: string[] }>;
      licenseAssignmentStates?: Array<{ skuId?: string; assignedByGroup?: string | null }>;
      signInActivity?: {
        lastSignInDateTime?: string;
        lastNonInteractiveSignInDateTime?: string;
      };
    }>(
      "/users?$filter=accountEnabled eq true and userType eq 'Member'&$select=id,userPrincipalName,createdDateTime,assignedLicenses,licenseAssignmentStates,signInActivity&$top=999",
    );

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const u of usersRes.value) {
      if (!u.id) continue;
      const upn = (u.userPrincipalName ?? "").toLowerCase();
      if (upn && excludedUsers.has(upn)) continue;

      const groupSkus = new Set(
        (u.licenseAssignmentStates ?? [])
          .filter((s) => s.skuId && s.assignedByGroup)
          .map((s) => s.skuId!.toLowerCase()),
      );
      const matchingLicenses = (u.assignedLicenses ?? []).filter(
        (l) => l.skuId && targetSkuMap.has(l.skuId.toLowerCase()) && !groupSkus.has(l.skuId.toLowerCase()),
      );
      if (matchingLicenses.length === 0) continue;

      evaluated++;
      const lastIso = latestIso(
        u.signInActivity?.lastSignInDateTime,
        u.signInActivity?.lastNonInteractiveSignInDateTime,
        u.createdDateTime,
      );
      const idleDays = daysSinceIso(lastIso);
      if (idleDays === null || idleDays < inactivityDays) continue;

      const skuNames = matchingLicenses.map((l) => targetSkuMap.get(l.skuId.toLowerCase()) ?? l.skuId);
      const label = u.userPrincipalName ?? u.id;
      actions.push({
        targetType: "licensedUser",
        targetId: u.id,
        targetLabel: label,
        actionType: "reclaim_dormant_skus",
        reason: `No sign-in activity for ${idleDays} days while holding [${skuNames.join(", ")}]`,
        beforeState: {
          userId: u.id,
          userPrincipalName: label,
          lastActivityIso: lastIso,
          removedLicenses: matchingLicenses,
        },
        plannedAfterState: {
          userId: u.id,
          reclaimedSkuIds: matchingLicenses.map((l) => l.skuId),
        },
        rollbackPayload: {
          method: "POST",
          path: `/users/${u.id}/assignLicense`,
          body: {
            addLicenses: matchingLicenses.map((l) => ({
              skuId: l.skuId,
              disabledPlans: l.disabledPlans ?? [],
            })),
            removeLicenses: [],
          },
          description: `Restore SKU(s) [${skuNames.join(", ")}] to "${label}"`,
        },
        meta: { removeSkuIds: matchingLicenses.map((l) => l.skuId) },
      });
    }

    return {
      evaluatedCount: evaluated,
      summary:
        actions.length === 0
          ? `All ${evaluated} holder(s) of target premium SKUs signed in within ${inactivityDays} days.`
          : `Found ${actions.length} dormant user(s) inactive ≥ ${inactivityDays}d with reclaimable premium SKUs.`,
      actions,
    };
  },

  async apply(transport, action) {
    const removeSkuIds = (action.meta?.removeSkuIds as string[] | undefined) ?? [];
    await transport.post(`/users/${action.targetId}/assignLicense`, {
      addLicenses: [],
      removeLicenses: removeSkuIds,
    });
    return {
      afterState: { userId: action.targetId, reclaimedSkuIds: removeSkuIds },
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};

/**
 * 11. Privileged Role Drift Guard
 */
export const privilegedRoleDriftGuardAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "privileged-role-drift-guard",
  version: "1.0.0",
  name: "Privileged Tier-0 Role Drift Guard",
  category: "governance",
  riskLevel: "high",
  description:
    "Detects and removes unauthorized standing active assignments on Tier-0 Entra directory roles (Global Admin, Privileged Role Admin, Conditional Access Admin) outside your approved principal allowlist, with a strict last-Global-Admin lockout guard.",
  requiredPermissions: ["RoleManagement.ReadWrite.Directory", "Directory.Read.All"],
  recommendedSchedule: "hourly",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "entra",
  dataSource: "graph-v1",
  tags: ["tier-0", "global-admin", "rbac", "pim", "privilege-escalation"],
  pairedReportId: "audit-log-summary",
  paramSchema: [
    {
      key: "approvedPrincipalIds",
      label: "Approved Tier-0 Principal Object IDs",
      type: "string_list",
      description: "User, Group, or Service Principal GUIDs authorized to hold standing Tier-0 roles.",
      defaultValue: [],
    },
    {
      key: "monitoredRoleTemplateIds",
      label: "Monitored Role Template IDs",
      type: "string_list",
      description: "Defaults to Global Admin, Privileged Role Admin, Security Admin, CA Admin, App Admin.",
      defaultValue: [
        GLOBAL_ADMIN_ROLE_TEMPLATE_ID,
        "e8611ab8-c189-46e8-94e1-60213ab1f814",
        "194ae4cb-b126-40b2-bd5b-6091b380977d",
        "b1be1c3e-b65d-4f19-8427-f6fa0d97feb9",
        "9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3",
      ],
    },
  ],

  async plan(transport, params) {
    const approved = new Set(asStringList(params.approvedPrincipalIds).map((id) => id.toLowerCase()));
    const monitoredRoles = new Set(
      asStringList(params.monitoredRoleTemplateIds, [GLOBAL_ADMIN_ROLE_TEMPLATE_ID]).map((r) =>
        r.toLowerCase(),
      ),
    );

    if (approved.size === 0) {
      return {
        evaluatedCount: 0,
        summary:
          "Configure Approved Tier-0 Principal Object IDs before evaluating standing role drift (safety guard prevents removing all admins).",
        actions: [],
      };
    }

    const res = await transport.get<{
      id: string;
      principalId: string;
      roleDefinitionId: string;
      directoryScopeId?: string;
      principal?: { id?: string; displayName?: string; userPrincipalName?: string };
    }>(
      "/roleManagement/directory/roleAssignments?$select=id,principalId,roleDefinitionId,directoryScopeId&$expand=principal($select=id,displayName,userPrincipalName)",
    );

    const scopedAssignments = res.value.filter(
      (a) => a.id && a.principalId && monitoredRoles.has((a.roleDefinitionId ?? "").toLowerCase()),
    );

    // Lockout safety invariant: ensure at least 1 Global Admin remains approved before removing any Global Admin!
    const globalAdmins = scopedAssignments.filter(
      (a) => a.roleDefinitionId.toLowerCase() === GLOBAL_ADMIN_ROLE_TEMPLATE_ID,
    );
    const remainingGlobalAdmins = globalAdmins.filter((a) => approved.has(a.principalId.toLowerCase()));

    const actions: PlannedAutomationAction[] = [];
    for (const a of scopedAssignments) {
      if (approved.has(a.principalId.toLowerCase())) continue;
      if (
        a.roleDefinitionId.toLowerCase() === GLOBAL_ADMIN_ROLE_TEMPLATE_ID &&
        remainingGlobalAdmins.length === 0
      ) {
        // Never remove the last Global Admin!
        continue;
      }

      const principalName =
        a.principal?.userPrincipalName ?? a.principal?.displayName ?? a.principalId;
      actions.push({
        targetType: "unifiedRoleAssignment",
        targetId: a.id,
        targetLabel: `${principalName} (role ${a.roleDefinitionId.slice(0, 8)}…)`,
        actionType: "remove_unauthorized_role_assignment",
        reason: `Standing Tier-0 role assignment (${a.roleDefinitionId}) is not in approvedPrincipalIds`,
        beforeState: {
          assignmentId: a.id,
          principalId: a.principalId,
          principalName,
          roleDefinitionId: a.roleDefinitionId,
          directoryScopeId: a.directoryScopeId ?? "/",
        },
        plannedAfterState: { removed: true },
        rollbackPayload: {
          method: "POST",
          path: "/roleManagement/directory/roleAssignments",
          body: {
            "@odata.type": "#microsoft.graph.unifiedRoleAssignment",
            principalId: a.principalId,
            roleDefinitionId: a.roleDefinitionId,
            directoryScopeId: a.directoryScopeId ?? "/",
          },
          description: `Restore role assignment (${a.roleDefinitionId}) for "${principalName}"`,
        },
      });
    }

    return {
      evaluatedCount: scopedAssignments.length,
      summary:
        actions.length === 0
          ? `All ${scopedAssignments.length} standing Tier-0 role assignment(s) match approved principals.`
          : `Detected ${actions.length} unauthorized standing Tier-0 role assignment(s).`,
      actions,
    };
  },

  async apply(transport, action) {
    await transport.delete(`/roleManagement/directory/roleAssignments/${action.targetId}`);
    return { afterState: { removed: true }, rollbackPayload: action.rollbackPayload ?? null };
  },
};

/**
 * 12. Expired App Secret Cleanup & App Owner Enforcement
 */
export const expiredAppSecretHygieneAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "expired-app-secret-hygiene",
  version: "1.0.0",
  name: "Expired App Secret Cleanup & Owner Enforcement",
  category: "governance",
  riskLevel: "low",
  description:
    "Purges dead passwordCredentials expired past the grace window on Entra App Registrations and assigns a fallback governance custodian to orphaned apps with zero active owners.",
  requiredPermissions: ["Application.ReadWrite.All", "User.Read.All"],
  recommendedSchedule: "weekly",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "credentials",
  dataSource: "graph-v1",
  tags: ["app-registrations", "secrets", "credentials", "owners", "hygiene"],
  pairedReportId: "app-secrets-expiry",
  paramSchema: [
    {
      key: "expiredGraceDays",
      label: "Post-Expiry Grace Period (Days)",
      type: "number",
      description: "Only remove client secrets expired for at least this many days.",
      defaultValue: 14,
    },
    {
      key: "fallbackOwnerUserId",
      label: "Fallback Custodian User Object ID (Optional)",
      type: "string",
      description: "Entra User Object ID (GUID) assigned as owner on orphaned 0-owner App Registrations.",
      defaultValue: "",
    },
    {
      key: "excludedAppIds",
      label: "Excluded Application (Client) IDs",
      type: "string_list",
      description: "App Registrations to skip.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const graceDays = asNumber(params.expiredGraceDays, 14, 1);
    const fallbackOwnerId = asString(params.fallbackOwnerUserId);
    const excludedApps = new Set(asStringList(params.excludedAppIds).map((a) => a.toLowerCase()));

    const appsRes = await transport.get<{
      id: string;
      appId?: string;
      displayName?: string;
      passwordCredentials?: Array<{
        keyId?: string;
        displayName?: string;
        endDateTime?: string;
        hint?: string;
      }>;
      owners?: Array<{ id?: string }>;
    }>(
      "/applications?$select=id,appId,displayName,passwordCredentials&$expand=owners($select=id)&$top=500",
    );

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const app of appsRes.value) {
      if (!app.id) continue;
      if (app.appId && excludedApps.has(app.appId.toLowerCase())) continue;
      evaluated++;
      const label = app.displayName ?? app.appId ?? app.id;

      for (const cred of app.passwordCredentials ?? []) {
        if (!cred.keyId || !cred.endDateTime) continue;
        const expiredDays = daysSinceIso(cred.endDateTime);
        if (expiredDays !== null && expiredDays >= graceDays) {
          actions.push({
            targetType: "applicationSecret",
            targetId: `${app.id}:${cred.keyId}`,
            targetLabel: `${label} · secret "${cred.displayName ?? cred.keyId.slice(0, 8)}"`,
            actionType: "remove_expired_app_secret",
            reason: `Client secret expired ${expiredDays} days ago (${cred.endDateTime.slice(0, 10)})`,
            beforeState: {
              appObjectId: app.id,
              appId: app.appId ?? null,
              keyId: cred.keyId,
              secretDisplayName: cred.displayName ?? null,
              endDateTime: cred.endDateTime,
            },
            plannedAfterState: { removedKeyId: cred.keyId },
            rollbackPayload: null,
            meta: { kind: "secret", appObjectId: app.id, keyId: cred.keyId },
          });
        }
      }

      if (GUID_RE.test(fallbackOwnerId) && (app.owners?.length ?? 0) === 0) {
        actions.push({
          targetType: "application",
          targetId: app.id,
          targetLabel: label,
          actionType: "assign_fallback_app_owner",
          reason: "Orphaned App Registration has 0 owners",
          beforeState: { appObjectId: app.id, owners: [] },
          plannedAfterState: { appObjectId: app.id, addedOwnerId: fallbackOwnerId },
          rollbackPayload: {
            method: "DELETE",
            path: `/applications/${app.id}/owners/${fallbackOwnerId}/$ref`,
            description: `Remove fallback custodian owner from app "${label}"`,
          },
          meta: { kind: "owner", appObjectId: app.id, fallbackOwnerId },
        });
      }
    }

    return {
      evaluatedCount: evaluated,
      summary:
        actions.length === 0
          ? `Checked ${evaluated} App Registration(s); no expired secrets (≥${graceDays}d) or unowned apps requiring action.`
          : `Planned ${actions.length} app hygiene action(s) across ${evaluated} App Registration(s).`,
      actions,
    };
  },

  async apply(transport, action) {
    if (action.meta?.kind === "secret") {
      await transport.post(`/applications/${action.meta.appObjectId}/removePassword`, {
        keyId: action.meta.keyId,
      });
      return { afterState: { removedKeyId: action.meta.keyId }, rollbackPayload: null };
    }
    const ownerId = String(action.meta?.fallbackOwnerId ?? "");
    await transport.post(`/applications/${action.meta?.appObjectId}/owners/$ref`, {
      "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${ownerId}`,
    });
    return {
      afterState: { addedOwnerId: ownerId },
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};

/**
 * 13. Ownerless Microsoft 365 Group & Team Governance
 */
export const ownerlessM365GroupAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "ownerless-m365-group-remediation",
  version: "1.0.0",
  name: "Ownerless M365 Group & Team Custodian Assignment",
  category: "governance",
  riskLevel: "low",
  description:
    "Detects Microsoft 365 Unified Groups and Teams left with zero active owners after employee offboarding and assigns a governance custodian (or promotes an active member).",
  requiredPermissions: ["Group.ReadWrite.All", "User.Read.All"],
  recommendedSchedule: "weekly",
  recommendedMode: "audit",
  service: "Microsoft Teams & Groups",
  icon: "groups",
  dataSource: "graph-v1",
  tags: ["m365-groups", "teams", "ownerless", "governance", "sprawl"],
  pairedReportId: "m365-groups-activity",
  paramSchema: [
    {
      key: "fallbackOwnerUserId",
      label: "Fallback Custodian User Object ID",
      type: "string",
      description: "Entra User Object ID (GUID) assigned when a Unified Group has 0 active owners.",
      defaultValue: "",
    },
    {
      key: "promoteActiveMemberFirst",
      label: "Promote Active Group Member Before Fallback",
      type: "boolean",
      description: "Promote the first enabled internal Member of the group if available; otherwise assign fallback custodian.",
      defaultValue: false,
    },
    {
      key: "excludedGroupIds",
      label: "Excluded Group IDs",
      type: "string_list",
      description: "Unified Group GUIDs exempt from owner assignment.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const fallbackOwnerId = asString(params.fallbackOwnerUserId);
    const promoteMember = asBoolean(params.promoteActiveMemberFirst, false);
    const excluded = new Set(asStringList(params.excludedGroupIds).map((g) => g.toLowerCase()));

    const groupsRes = await transport.get<{
      id: string;
      displayName?: string;
      mail?: string;
      owners?: Array<{ id?: string; accountEnabled?: boolean }>;
    }>(
      "/groups?$filter=groupTypes/any(c:c eq 'Unified')&$select=id,displayName,mail&$expand=owners($select=id,accountEnabled)&$top=500",
    );

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const g of groupsRes.value) {
      if (!g.id || excluded.has(g.id.toLowerCase())) continue;
      evaluated++;
      const activeOwners = (g.owners ?? []).filter((o) => o.id && o.accountEnabled !== false);
      if (activeOwners.length > 0) continue;

      let chosenOwnerId = GUID_RE.test(fallbackOwnerId) ? fallbackOwnerId : "";
      let chosenSource = "fallback custodian";

      if (promoteMember) {
        const memRes = await transport.get<{
          id?: string;
          userPrincipalName?: string;
          accountEnabled?: boolean;
          userType?: string;
        }>(
          `/groups/${g.id}/members/microsoft.graph.user?$select=id,userPrincipalName,accountEnabled,userType&$top=25`,
        );
        const activeMember = memRes.value.find(
          (m) => m.id && m.accountEnabled === true && m.userType === "Member",
        );
        if (activeMember?.id) {
          chosenOwnerId = activeMember.id;
          chosenSource = `active member ${activeMember.userPrincipalName ?? activeMember.id}`;
        }
      }

      if (!chosenOwnerId) continue;

      const label = g.displayName ?? g.mail ?? g.id;
      actions.push({
        targetType: "unifiedGroup",
        targetId: g.id,
        targetLabel: label,
        actionType: "assign_group_owner",
        reason: `M365 Group has 0 enabled owners; assigning ${chosenSource}`,
        beforeState: {
          groupId: g.id,
          displayName: label,
          previousOwnerIds: (g.owners ?? []).map((o) => o.id).filter(Boolean),
        },
        plannedAfterState: { groupId: g.id, addedOwnerId: chosenOwnerId },
        rollbackPayload: {
          method: "DELETE",
          path: `/groups/${g.id}/owners/${chosenOwnerId}/$ref`,
          description: `Remove assigned owner ${chosenOwnerId} from M365 Group "${label}"`,
        },
        meta: { newOwnerId: chosenOwnerId },
      });
    }

    return {
      evaluatedCount: evaluated,
      summary:
        !GUID_RE.test(fallbackOwnerId) && !promoteMember
          ? `Evaluated ${evaluated} M365 Group(s). Set Fallback Custodian User Object ID or enable member promotion to remediate ownerless groups.`
          : actions.length === 0
            ? `All ${evaluated} M365 Unified Group(s) have at least one active owner.`
            : `Found ${actions.length} ownerless M365 Group(s) ready for owner assignment.`,
      actions,
    };
  },

  async apply(transport, action) {
    const newOwnerId = String(action.meta?.newOwnerId ?? "");
    await transport.post(`/groups/${action.targetId}/owners/$ref`, {
      "@odata.id": `https://graph.microsoft.com/v1.0/users/${newOwnerId}`,
    });
    return {
      afterState: { groupId: action.targetId, addedOwnerId: newOwnerId },
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};

/**
 * 14. Stale Intune & Entra Device Lifecycle Hygiene
 */
export const staleDeviceHygieneAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "stale-device-hygiene",
  version: "1.0.0",
  name: "Stale Intune & Entra Device Lifecycle Hygiene",
  category: "devices",
  riskLevel: "medium",
  description:
    "Retires stale Intune managed devices inactive beyond N days and soft-deletes abandoned cloud-only Entra device records while automatically protecting Autopilot (ZTDID) and Hybrid AD-synced endpoints.",
  requiredPermissions: [
    "DeviceManagementManagedDevices.ReadWrite.All",
    "DeviceManagementManagedDevices.PrivilegedOperations.All",
    "Device.ReadWrite.All",
  ],
  recommendedSchedule: "weekly",
  recommendedMode: "audit",
  service: "Microsoft Intune & Entra",
  icon: "intune",
  dataSource: "graph-v1",
  tags: ["intune", "devices", "endpoints", "stale-devices", "autopilot-safe"],
  pairedReportId: "device-compliance",
  paramSchema: [
    {
      key: "retireIntuneAfterDays",
      label: "Retire Intune Managed Devices Inactive > N Days",
      type: "number",
      description: "Send Intune retire action to MDM devices not synced for N days (0 to skip Intune stage).",
      defaultValue: 90,
    },
    {
      key: "deleteEntraAfterDays",
      label: "Soft-Delete Cloud Entra Devices Inactive > N Days",
      type: "number",
      description: "Soft-delete Entra device objects inactive beyond N days (skips Autopilot & on-prem synced).",
      defaultValue: 180,
    },
    {
      key: "excludedDeviceNames",
      label: "Excluded Device Names",
      type: "string_list",
      description: "Kiosk or lab device display names exempt from cleanup.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const retireDays = asNumber(params.retireIntuneAfterDays, 90, 0);
    const deleteDays = asNumber(params.deleteEntraAfterDays, 180, 0);
    const excludedNames = new Set(asStringList(params.excludedDeviceNames).map((d) => d.toLowerCase()));

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    if (retireDays >= 30) {
      try {
        const mdmRes = await transport.get<{
          id: string;
          deviceName?: string;
          operatingSystem?: string;
          lastSyncDateTime?: string;
          userPrincipalName?: string;
        }>(
          "/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,lastSyncDateTime,userPrincipalName&$top=500",
        );
        for (const d of mdmRes.value) {
          if (!d.id) continue;
          if (d.deviceName && excludedNames.has(d.deviceName.toLowerCase())) continue;
          evaluated++;
          const staleDays = daysSinceIso(d.lastSyncDateTime);
          if (staleDays !== null && staleDays >= retireDays) {
            actions.push({
              targetType: "managedDevice",
              targetId: d.id,
              targetLabel: `${d.deviceName ?? d.id} (${d.operatingSystem ?? "MDM"})`,
              actionType: "retire_intune_device",
              reason: `Intune device has not synced for ${staleDays} days (threshold: ${retireDays}d)`,
              beforeState: {
                managedDeviceId: d.id,
                deviceName: d.deviceName ?? null,
                lastSyncDateTime: d.lastSyncDateTime ?? null,
                userPrincipalName: d.userPrincipalName ?? null,
              },
              plannedAfterState: { retired: true },
              rollbackPayload: null,
              meta: { stage: "intune" },
            });
          }
        }
      } catch {
        // Tenant without Intune license may 403/400 on managedDevices; continue to Entra stage if configured.
      }
    }

    if (deleteDays >= 60) {
      const entraRes = await transport.get<{
        id: string;
        deviceId?: string;
        displayName?: string;
        operatingSystem?: string;
        approximateLastSignInDateTime?: string;
        onPremisesSyncEnabled?: boolean | null;
        physicalIds?: string[];
      }>(
        "/devices?$select=id,deviceId,displayName,operatingSystem,approximateLastSignInDateTime,onPremisesSyncEnabled,physicalIds&$top=500",
      );
      for (const dev of entraRes.value) {
        if (!dev.id) continue;
        if (dev.displayName && excludedNames.has(dev.displayName.toLowerCase())) continue;
        if (dev.onPremisesSyncEnabled) continue;
        const isAutopilot = (dev.physicalIds ?? []).some((p) => p.includes("[ZTDID]:"));
        if (isAutopilot) continue;

        evaluated++;
        const staleDays = daysSinceIso(dev.approximateLastSignInDateTime);
        if (staleDays !== null && staleDays >= deleteDays) {
          const label = dev.displayName ?? dev.deviceId ?? dev.id;
          actions.push({
            targetType: "entraDevice",
            targetId: dev.id,
            targetLabel: `${label} (${dev.operatingSystem ?? "Entra"})`,
            actionType: "delete_stale_entra_device",
            reason: `Cloud Entra device inactive for ${staleDays} days (threshold: ${deleteDays}d)`,
            beforeState: {
              id: dev.id,
              deviceId: dev.deviceId ?? null,
              displayName: dev.displayName ?? null,
              approximateLastSignInDateTime: dev.approximateLastSignInDateTime ?? null,
            },
            plannedAfterState: { deletedToRecycleBin: true },
            rollbackPayload: {
              method: "POST",
              path: `/directory/deletedItems/${dev.id}/restore`,
              body: {},
              description: `Restore soft-deleted Entra device "${label}" from 30-day recycle bin`,
            },
            meta: { stage: "entra" },
          });
        }
      }
    }

    return {
      evaluatedCount: evaluated,
      summary:
        actions.length === 0
          ? `Evaluated ${evaluated} endpoint(s); zero stale devices exceeded cleanup thresholds.`
          : `Identified ${actions.length} stale endpoint(s) across ${evaluated} evaluated device(s).`,
      actions,
    };
  },

  async apply(transport, action) {
    if (action.meta?.stage === "intune") {
      await transport.post(`/deviceManagement/managedDevices/${action.targetId}/retire`, {});
      return { afterState: { retired: true }, rollbackPayload: null };
    }
    await transport.delete(`/devices/${action.targetId}`);
    return {
      afterState: { deletedToRecycleBin: true },
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};
