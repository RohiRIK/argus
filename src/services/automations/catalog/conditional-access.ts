import { GUID_RE } from "@/lib/validation";
import type { AutomationDefinition, PlannedAutomationAction } from "../types";
import { asStringList } from "../helpers";

interface CaUsersCondition {
  includeUsers?: string[];
  excludeUsers?: string[];
  includeGroups?: string[];
  excludeGroups?: string[];
  includeRoles?: string[];
  excludeRoles?: string[];
  includeGuestsOrExternalUsers?: unknown;
  excludeGuestsOrExternalUsers?: unknown;
}

interface CaPolicyRow {
  id: string;
  displayName?: string;
  state?: string;
  conditions?: {
    users?: CaUsersCondition;
  };
}

interface NamedLocationRow {
  id: string;
  displayName?: string;
  "@odata.type"?: string;
  isTrusted?: boolean;
  ipRanges?: Array<{ "@odata.type"?: string; cidrAddress?: string }>;
}

/**
 * 1. Break-Glass Conditional Access Exclusion Guardrail
 * Ensures designated emergency-access accounts and/or security groups remain excluded
 * from all enabled (or report-only) Conditional Access policies without clobbering
 * existing user/group/role conditions.
 */
export const breakGlassCaExclusionAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "break-glass-ca-exclusion-guardrail",
  version: "1.0.0",
  name: "Break-Glass Conditional Access Exclusion Guardrail",
  category: "conditional-access",
  riskLevel: "high",
  description:
    "Ensures designated emergency-access (break-glass) accounts and security groups stay excluded from every active or report-only Conditional Access policy to prevent tenant lockout.",
  requiredPermissions: [
    "Policy.Read.All",
    "Policy.ReadWrite.ConditionalAccess",
    "User.Read.All",
    "Group.Create",
    "Group.Read.All",
  ],
  recommendedSchedule: "hourly",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "conditional-access",
  dataSource: "graph-v1",
  tags: ["break-glass", "conditional-access", "zero-trust", "emergency-access", "lockout-prevention"],
  pairedReportId: "conditional-access-failures",
  paramSchema: [
    {
      key: "breakGlassUsers",
      label: "Break-Glass User IDs or UPNs",
      type: "string_list",
      description: "Emergency-access user Object IDs (GUID) or UPNs (e.g. bg01@contoso.onmicrosoft.com).",
      placeholder: "bg01@contoso.onmicrosoft.com, bg02@contoso.onmicrosoft.com",
      defaultValue: [],
    },
    {
      key: "breakGlassGroups",
      label: "Break-Glass Security Group IDs",
      type: "string_list",
      description: "Entra Security Group Object IDs (GUID) holding emergency-access accounts.",
      placeholder: "00000000-0000-0000-0000-000000000000",
      defaultValue: [],
      provision: {
        kind: "securityGroup",
        displayName: "Argus - Break-Glass Accounts",
        description: "Emergency-access accounts kept excluded from every Conditional Access policy by Argus.",
      },
    },
    {
      key: "includeReportOnlyPolicies",
      label: "Include Report-Only CA Policies",
      type: "boolean",
      description: "Also enforce exclusions on report-only policies before they get flipped to enabled.",
      defaultValue: true,
    },
    {
      key: "ignoredPolicyIds",
      label: "Ignored Policy IDs",
      type: "string_list",
      description: "Conditional Access policy GUIDs intentionally targeting emergency accounts.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const rawUsers = asStringList(params.breakGlassUsers);
    const rawGroups = asStringList(params.breakGlassGroups).filter((g) => GUID_RE.test(g));
    const includeReportOnly = params.includeReportOnlyPolicies !== false;
    const ignored = new Set(asStringList(params.ignoredPolicyIds).map((x) => x.toLowerCase()));

    if (rawUsers.length === 0 && rawGroups.length === 0) {
      return {
        evaluatedCount: 0,
        summary:
          "Configure at least one Break-Glass User UPN/ID or Security Group ID in policy parameters to evaluate Conditional Access exclusions.",
        actions: [],
      };
    }

    // Resolve UPNs to immutable Entra user Object IDs.
    const resolvedUserIds: string[] = [];
    const userLabelById = new Map<string, string>();
    for (const entry of rawUsers) {
      if (GUID_RE.test(entry)) {
        resolvedUserIds.push(entry);
        userLabelById.set(entry, entry);
      } else {
        const res = await transport.getOne<{ id: string; userPrincipalName?: string }>(
          `/users/${encodeURIComponent(entry)}?$select=id,userPrincipalName`,
        );
        if (res.data?.id) {
          resolvedUserIds.push(res.data.id);
          userLabelById.set(res.data.id, res.data.userPrincipalName ?? entry);
        }
      }
    }

    const policiesRes = await transport.get<CaPolicyRow>(
      "/identity/conditionalAccess/policies?$select=id,displayName,state,conditions",
    );
    const targetStates = new Set(
      includeReportOnly
        ? ["enabled", "enabledForReportingButNotEnforced"]
        : ["enabled"],
    );

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const pol of policiesRes.value) {
      if (!pol.id || ignored.has(pol.id.toLowerCase())) continue;
      if (!pol.state || !targetStates.has(pol.state)) continue;
      const usersCond = pol.conditions?.users;
      if (!usersCond) continue;

      // Skip workload-identity-only policies that do not target any users/groups/roles.
      const hasUserScope =
        (usersCond.includeUsers?.length ?? 0) > 0 ||
        (usersCond.includeGroups?.length ?? 0) > 0 ||
        (usersCond.includeRoles?.length ?? 0) > 0;
      if (!hasUserScope) continue;

      evaluated++;
      const currentExUsers = usersCond.excludeUsers ?? [];
      const currentExGroups = usersCond.excludeGroups ?? [];
      const exUserSet = new Set(currentExUsers.map((u) => u.toLowerCase()));
      const exGroupSet = new Set(currentExGroups.map((g) => g.toLowerCase()));

      // Safety guard: never exclude an account/group if the policy explicitly targets ONLY that account/group.
      const onlyTargetsBreakGlass =
        (usersCond.includeUsers?.length ?? 0) > 0 &&
        !usersCond.includeUsers!.includes("All") &&
        usersCond.includeUsers!.every((u) =>
          resolvedUserIds.some((bg) => bg.toLowerCase() === u.toLowerCase()),
        );
      if (onlyTargetsBreakGlass) continue;

      const missingUsers = resolvedUserIds.filter((id) => !exUserSet.has(id.toLowerCase()));
      const missingGroups = rawGroups.filter((id) => !exGroupSet.has(id.toLowerCase()));
      if (missingUsers.length === 0 && missingGroups.length === 0) continue;

      const updatedUsersCondition: CaUsersCondition = {
        includeUsers: usersCond.includeUsers ?? [],
        excludeUsers: [...currentExUsers, ...missingUsers],
        includeGroups: usersCond.includeGroups ?? [],
        excludeGroups: [...currentExGroups, ...missingGroups],
        includeRoles: usersCond.includeRoles ?? [],
        excludeRoles: usersCond.includeRoles ? (usersCond.excludeRoles ?? []) : [],
        ...(usersCond.includeGuestsOrExternalUsers !== undefined
          ? { includeGuestsOrExternalUsers: usersCond.includeGuestsOrExternalUsers }
          : {}),
        ...(usersCond.excludeGuestsOrExternalUsers !== undefined
          ? { excludeGuestsOrExternalUsers: usersCond.excludeGuestsOrExternalUsers }
          : {}),
      };

      const missingDesc = [
        ...missingUsers.map((id) => `user ${userLabelById.get(id) ?? id}`),
        ...missingGroups.map((id) => `group ${id}`),
      ].join(", ");

      actions.push({
        targetType: "conditionalAccessPolicy",
        targetId: pol.id,
        targetLabel: pol.displayName ?? pol.id,
        actionType: "exclude_breakglass_principals",
        reason: `Policy (${pol.state}) is missing break-glass exclusion for: ${missingDesc}`,
        beforeState: {
          policyId: pol.id,
          displayName: pol.displayName ?? pol.id,
          state: pol.state,
          conditionsUsers: usersCond as unknown as Record<string, unknown>,
        },
        plannedAfterState: {
          policyId: pol.id,
          displayName: pol.displayName ?? pol.id,
          state: pol.state,
          conditionsUsers: updatedUsersCondition as unknown as Record<string, unknown>,
        },
        rollbackPayload: {
          method: "PATCH",
          path: `/identity/conditionalAccess/policies/${pol.id}`,
          body: { conditions: { users: usersCond } },
          description: `Restore previous conditions.users on CA policy "${pol.displayName ?? pol.id}"`,
        },
        meta: { updatedUsersCondition },
      });
    }

    return {
      evaluatedCount: evaluated,
      summary:
        actions.length === 0
          ? `All ${evaluated} in-scope Conditional Access policies properly exclude configured break-glass accounts/groups.`
          : `Detected ${actions.length} of ${evaluated} Conditional Access policies missing break-glass exclusions.`,
      actions,
    };
  },

  async apply(transport, action) {
    const updatedUsersCondition = action.meta?.updatedUsersCondition;
    if (!updatedUsersCondition) {
      throw new Error("Missing updatedUsersCondition metadata for Conditional Access PATCH");
    }
    await transport.patch(`/identity/conditionalAccess/policies/${action.targetId}`, {
      conditions: { users: updatedUsersCondition },
    });
    return {
      afterState: action.plannedAfterState ?? { conditionsUsers: updatedUsersCondition },
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};

/**
 * 2. Conditional Access Baseline State & Trusted IP Sync Guardrail
 * Ensures mandatory CA policies cannot stay accidentally disabled and keeps corporate
 * Trusted IP Named Locations synchronized with declared CIDR ranges.
 */
export const caBaselineAndNamedLocationAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "ca-baseline-and-named-location-guardrail",
  version: "1.0.0",
  name: "Conditional Access Baseline & Trusted IP Guardrail",
  category: "conditional-access",
  riskLevel: "high",
  description:
    "Prevents configuration drift on mandatory Conditional Access policies (re-enabling any baseline policy left disabled/report-only) and reconciles corporate CIDR ranges on Trusted IP Named Locations.",
  requiredPermissions: ["Policy.Read.All", "Policy.ReadWrite.ConditionalAccess"],
  recommendedSchedule: "hourly",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "conditional-access",
  dataSource: "graph-v1",
  tags: ["conditional-access", "named-locations", "trusted-ip", "drift", "zero-trust"],
  pairedReportId: "conditional-access-failures",
  paramSchema: [
    {
      key: "enforcedEnabledPolicyIds",
      label: "Mandatory Enabled CA Policy IDs",
      type: "string_list",
      description: "Conditional Access policy GUIDs that must remain in state = 'enabled'.",
      placeholder: "11111111-1111-1111-1111-111111111111",
      defaultValue: [],
    },
    {
      key: "namedLocationId",
      label: "Managed Trusted IP Named Location ID (Optional)",
      type: "string",
      description: "GUID of an ipNamedLocation in Entra ID to keep synced with Approved CIDRs.",
      placeholder: "22222222-2222-2222-2222-222222222222",
      defaultValue: "",
    },
    {
      key: "approvedCidrs",
      label: "Approved Corporate Egress CIDRs",
      type: "string_list",
      description: "IPv4 or IPv6 CIDR ranges (e.g. 203.0.113.0/24, 2001:db8::/32) for the managed Named Location.",
      placeholder: "203.0.113.0/24",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const policyIds = asStringList(params.enforcedEnabledPolicyIds).filter((id) => GUID_RE.test(id));
    const locationId = typeof params.namedLocationId === "string" ? params.namedLocationId.trim() : "";
    const approvedCidrs = asStringList(params.approvedCidrs);

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const id of policyIds) {
      evaluated++;
      const res = await transport.getOne<CaPolicyRow>(
        `/identity/conditionalAccess/policies/${id}?$select=id,displayName,state`,
      );
      const pol = res.data;
      if (pol && pol.state !== "enabled") {
        actions.push({
          targetType: "conditionalAccessPolicy",
          targetId: pol.id,
          targetLabel: pol.displayName ?? pol.id,
          actionType: "enable_ca_policy",
          reason: `Mandatory baseline CA policy drifted to state "${pol.state}" (expected "enabled")`,
          beforeState: { id: pol.id, displayName: pol.displayName, state: pol.state },
          plannedAfterState: { id: pol.id, displayName: pol.displayName, state: "enabled" },
          rollbackPayload: {
            method: "PATCH",
            path: `/identity/conditionalAccess/policies/${pol.id}`,
            body: { state: pol.state },
            description: `Revert CA policy "${pol.displayName ?? pol.id}" state to "${pol.state}"`,
          },
          meta: { kind: "policy" },
        });
      }
    }

    if (GUID_RE.test(locationId) && approvedCidrs.length > 0) {
      evaluated++;
      const locRes = await transport.getOne<NamedLocationRow>(
        `/identity/conditionalAccess/namedLocations/${locationId}`,
      );
      const loc = locRes.data;
      const currentCidrs = (loc.ipRanges ?? [])
        .map((r) => (r.cidrAddress ?? "").trim())
        .filter(Boolean)
        .sort();
      const desiredCidrs = [...new Set(approvedCidrs)].sort();
      const drifted =
        loc.isTrusted !== true ||
        currentCidrs.length !== desiredCidrs.length ||
        currentCidrs.some((c, i) => c !== desiredCidrs[i]);

      if (drifted) {
        const ipRanges = desiredCidrs.map((cidr) => ({
          "@odata.type": cidr.includes(":")
            ? "#microsoft.graph.iPv6CidrRange"
            : "#microsoft.graph.iPv4CidrRange",
          cidrAddress: cidr,
        }));
        actions.push({
          targetType: "ipNamedLocation",
          targetId: loc.id,
          targetLabel: loc.displayName ?? loc.id,
          actionType: "sync_named_location_cidrs",
          reason: `Trusted IP Named Location drifted (current: [${currentCidrs.join(", ") || "none"}], desired: [${desiredCidrs.join(", ")}])`,
          beforeState: {
            id: loc.id,
            displayName: loc.displayName,
            isTrusted: loc.isTrusted ?? false,
            ipRanges: loc.ipRanges ?? [],
          },
          plannedAfterState: {
            id: loc.id,
            displayName: loc.displayName,
            isTrusted: true,
            ipRanges,
          },
          rollbackPayload: {
            method: "PATCH",
            path: `/identity/conditionalAccess/namedLocations/${loc.id}`,
            body: {
              "@odata.type": "#microsoft.graph.ipNamedLocation",
              isTrusted: loc.isTrusted ?? false,
              ipRanges: loc.ipRanges ?? [],
            },
            description: `Restore previous CIDR list on Named Location "${loc.displayName ?? loc.id}"`,
          },
          meta: { kind: "location", ipRanges },
        });
      }
    }

    return {
      evaluatedCount: evaluated,
      summary:
        evaluated === 0
          ? "Configure mandatory CA Policy IDs or a Managed Named Location ID to monitor for baseline drift."
          : actions.length === 0
            ? `All ${evaluated} monitored Conditional Access baseline policies and Named Locations match desired state.`
            : `Detected drift on ${actions.length} of ${evaluated} Conditional Access baseline resource(s).`,
      actions,
    };
  },

  async apply(transport, action) {
    if (action.meta?.kind === "policy") {
      await transport.patch(`/identity/conditionalAccess/policies/${action.targetId}`, {
        state: "enabled",
      });
    } else if (action.meta?.kind === "location") {
      await transport.patch(`/identity/conditionalAccess/namedLocations/${action.targetId}`, {
        "@odata.type": "#microsoft.graph.ipNamedLocation",
        isTrusted: true,
        ipRanges: action.meta.ipRanges,
      });
    }
    return {
      afterState: action.plannedAfterState ?? {},
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};
