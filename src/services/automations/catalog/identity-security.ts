import type { AutomationDefinition, PlannedAutomationAction } from "../types";
import {
  asBoolean,
  asNumber,
  asString,
  asStringList,
  daysSinceIso,
  latestIso,
  MICROSOFT_TENANT_APP_OWNER_ID,
} from "../helpers";

/**
 * 3. Stale & Unredeemed B2B Guest Cleanup
 */
export const staleB2bGuestCleanupAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "stale-b2b-guest-cleanup",
  version: "1.0.0",
  name: "Stale & Unredeemed B2B Guest Cleanup",
  category: "identity",
  riskLevel: "medium",
  description:
    "Two-stage external guest hygiene: disables unredeemed B2B invitations or long-inactive guest accounts, or soft-deletes disabled guests to the 30-day Entra recycle bin.",
  requiredPermissions: ["User.ReadWrite.All", "AuditLog.Read.All"],
  recommendedSchedule: "weekly",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "entra",
  dataSource: "graph-v1",
  tags: ["b2b", "guests", "external-identities", "lifecycle", "hygiene"],
  pairedReportId: "inactive-guest-users",
  paramSchema: [
    {
      key: "unredeemedInviteDays",
      label: "Unredeemed Invitation Threshold (Days)",
      type: "number",
      description: "Flag PendingAcceptance B2B invites older than this many days.",
      defaultValue: 30,
    },
    {
      key: "inactiveSignInDays",
      label: "Guest Sign-In Inactivity Threshold (Days)",
      type: "number",
      description: "Flag accepted B2B guests with no interactive/non-interactive sign-in beyond N days.",
      defaultValue: 90,
    },
    {
      key: "remediationAction",
      label: "Remediation Action",
      type: "select",
      description: "Disable sign-in first (safer) or soft-delete into Entra 30-day recycle bin.",
      defaultValue: "disable",
      options: [
        { value: "disable", label: "Block Sign-In (accountEnabled = false)" },
        { value: "delete", label: "Soft-Delete Guest (30-day Entra Recycle Bin)" },
      ],
    },
    {
      key: "excludedDomains",
      label: "Partner Allowlist Domains",
      type: "string_list",
      description: "Email domains never touched by guest cleanup (e.g. partnercorp.com).",
      defaultValue: [],
    },
    {
      key: "excludedGuestUpns",
      label: "Excluded Guest UPNs / Emails",
      type: "string_list",
      description: "Specific guest UPNs or email addresses to skip.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const unredeemedDays = asNumber(params.unredeemedInviteDays, 30, 1);
    const inactiveDays = asNumber(params.inactiveSignInDays, 90, 7);
    const actionMode = params.remediationAction === "delete" ? "delete" : "disable";
    const excludedDomains = new Set(asStringList(params.excludedDomains).map((d) => d.toLowerCase()));
    const excludedUpns = new Set(asStringList(params.excludedGuestUpns).map((u) => u.toLowerCase()));

    const res = await transport.get<{
      id: string;
      userPrincipalName?: string;
      mail?: string;
      displayName?: string;
      accountEnabled?: boolean;
      externalUserState?: string;
      externalUserStateChangeDateTime?: string;
      createdDateTime?: string;
      signInActivity?: {
        lastSignInDateTime?: string;
        lastNonInteractiveSignInDateTime?: string;
      };
    }>(
      "/users?$filter=userType eq 'Guest'&$select=id,userPrincipalName,mail,displayName,accountEnabled,externalUserState,externalUserStateChangeDateTime,createdDateTime,signInActivity&$top=999",
    );

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const u of res.value) {
      if (!u.id) continue;
      const upn = (u.userPrincipalName ?? "").toLowerCase();
      const mail = (u.mail ?? "").toLowerCase();
      if (excludedUpns.has(upn) || (mail && excludedUpns.has(mail))) continue;
      const domain = mail.includes("@") ? mail.split("@")[1] : "";
      if (domain && excludedDomains.has(domain)) continue;
      if (actionMode === "disable" && u.accountEnabled === false) continue;

      evaluated++;
      const inviteAge = daysSinceIso(u.externalUserStateChangeDateTime ?? u.createdDateTime);
      const lastActivityIso = latestIso(
        u.signInActivity?.lastSignInDateTime,
        u.signInActivity?.lastNonInteractiveSignInDateTime,
        u.createdDateTime,
      );
      const inactiveAge = daysSinceIso(lastActivityIso);

      let reason: string | null = null;
      if (u.externalUserState === "PendingAcceptance" && inviteAge !== null && inviteAge >= unredeemedInviteDaysCheck(unredeemedDays)) {
        reason = `Unredeemed B2B invitation pending for ${inviteAge} days (threshold: ${unredeemedDays}d)`;
      } else if (inactiveAge !== null && inactiveAge >= inactiveDays) {
        reason = `No B2B guest sign-in activity for ${inactiveAge} days (threshold: ${inactiveDays}d)`;
      }
      if (!reason) continue;

      const label = u.mail || u.userPrincipalName || u.displayName || u.id;
      actions.push({
        targetType: "guestUser",
        targetId: u.id,
        targetLabel: label,
        actionType: actionMode === "delete" ? "delete_stale_guest" : "disable_stale_guest",
        reason,
        beforeState: {
          id: u.id,
          userPrincipalName: u.userPrincipalName ?? null,
          mail: u.mail ?? null,
          accountEnabled: u.accountEnabled ?? true,
          externalUserState: u.externalUserState ?? null,
          lastActivityIso,
        },
        plannedAfterState:
          actionMode === "delete"
            ? { deletedToRecycleBin: true }
            : { id: u.id, accountEnabled: false },
        rollbackPayload:
          actionMode === "delete"
            ? {
                method: "POST",
                path: `/directory/deletedItems/${u.id}/restore`,
                body: {},
                description: `Restore soft-deleted guest "${label}" from Entra recycle bin`,
              }
            : {
                method: "PATCH",
                path: `/users/${u.id}`,
                body: { accountEnabled: u.accountEnabled ?? true },
                description: `Re-enable guest account "${label}"`,
              },
        meta: { actionMode },
      });
    }

    return {
      evaluatedCount: evaluated,
      summary:
        actions.length === 0
          ? `All ${evaluated} in-scope B2B guest accounts are within activity thresholds.`
          : `Identified ${actions.length} stale/unredeemed B2B guest account(s) for ${actionMode}.`,
      actions,
    };
  },

  async apply(transport, action) {
    if (action.meta?.actionMode === "delete") {
      await transport.delete(`/users/${action.targetId}`);
      return { afterState: { deletedToRecycleBin: true }, rollbackPayload: action.rollbackPayload ?? null };
    }
    await transport.patch(`/users/${action.targetId}`, { accountEnabled: false });
    return {
      afterState: { id: action.targetId, accountEnabled: false },
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};

function unredeemedInviteDaysCheck(days: number): number {
  return Math.max(1, days);
}

/**
 * 4. High-Risk User Auto-Containment
 */
export const highRiskUserContainmentAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "high-risk-user-containment",
  version: "1.0.0",
  name: "High-Risk User Auto-Containment",
  category: "security",
  riskLevel: "high",
  description:
    "Contains users flagged at risk by Entra ID Protection: blocks sign-in first, revokes all refresh/session tokens, and confirms compromise while never touching protected/break-glass accounts.",
  requiredPermissions: [
    "IdentityRiskyUser.ReadWrite.All",
    "User.ReadWrite.All",
    "User.RevokeSessions.All",
  ],
  recommendedSchedule: "hourly",
  recommendedMode: "audit",
  service: "Entra ID Protection",
  icon: "defender",
  dataSource: "graph-v1",
  tags: ["identity-protection", "risky-users", "incident-response", "containment", "tokens"],
  pairedReportId: "risky-users",
  paramSchema: [
    {
      key: "minRiskLevel",
      label: "Minimum Risk Level",
      type: "select",
      description: "Minimum Entra ID Protection risk level that triggers containment.",
      defaultValue: "high",
      options: [
        { value: "high", label: "High Risk Only" },
        { value: "medium", label: "Medium & High Risk" },
      ],
    },
    {
      key: "confirmCompromised",
      label: "Confirm User Compromised in ID Protection",
      type: "boolean",
      description: "Also call riskyUsers/confirmCompromised after blocking sign-in and revoking tokens.",
      defaultValue: true,
    },
    {
      key: "protectedUsers",
      label: "Protected / Break-Glass User UPNs or IDs",
      type: "string_list",
      description: "VIP or Break-Glass user UPNs/GUIDs exempt from automated containment.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const minRisk = params.minRiskLevel === "medium" ? "medium" : "high";
    const confirmCompromised = asBoolean(params.confirmCompromised, true);
    const protectedSet = new Set(asStringList(params.protectedUsers).map((u) => u.toLowerCase()));
    const allowedLevels = minRisk === "medium" ? new Set(["medium", "high"]) : new Set(["high"]);

    const riskyRes = await transport.get<{
      id: string;
      userPrincipalName?: string;
      userDisplayName?: string;
      riskLevel?: string;
      riskState?: string;
      riskDetail?: string;
      riskLastUpdatedDateTime?: string;
    }>(
      "/identityProtection/riskyUsers?$filter=riskState eq 'atRisk'&$select=id,userPrincipalName,userDisplayName,riskLevel,riskState,riskDetail,riskLastUpdatedDateTime&$top=500",
    );

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const r of riskyRes.value) {
      if (!r.id) continue;
      evaluated++;
      const upn = (r.userPrincipalName ?? "").toLowerCase();
      if (protectedSet.has(r.id.toLowerCase()) || (upn && protectedSet.has(upn))) continue;
      if (!r.riskLevel || !allowedLevels.has(r.riskLevel.toLowerCase())) continue;

      const userRes = await transport.getOne<{
        id: string;
        userPrincipalName?: string;
        accountEnabled?: boolean;
        signInSessionsValidFromDateTime?: string;
      }>(`/users/${r.id}?$select=id,userPrincipalName,accountEnabled,signInSessionsValidFromDateTime`);
      const u = userRes.data;

      const label = r.userPrincipalName ?? r.userDisplayName ?? r.id;
      actions.push({
        targetType: "riskyUser",
        targetId: r.id,
        targetLabel: label,
        actionType: "contain_risky_user",
        reason: `Entra ID Protection flagged user as ${r.riskLevel} risk (${r.riskDetail ?? "atRisk"})`,
        beforeState: {
          id: r.id,
          userPrincipalName: r.userPrincipalName ?? null,
          accountEnabled: u?.accountEnabled ?? true,
          signInSessionsValidFromDateTime: u?.signInSessionsValidFromDateTime ?? null,
          riskLevel: r.riskLevel,
          riskState: r.riskState ?? "atRisk",
        },
        plannedAfterState: {
          id: r.id,
          accountEnabled: false,
          sessionsRevoked: true,
          riskState: confirmCompromised ? "confirmedCompromised" : (r.riskState ?? "atRisk"),
        },
        rollbackPayload: {
          method: "PATCH",
          path: `/users/${r.id}`,
          body: { accountEnabled: u?.accountEnabled ?? true },
          description: `Re-enable sign-in for "${label}" (also review ID Protection state in Entra)`,
        },
        meta: { confirmCompromised },
      });
    }

    return {
      evaluatedCount: evaluated,
      summary:
        actions.length === 0
          ? `No uncontained ${minRisk}-risk users detected across ${evaluated} risky user record(s).`
          : `Queued auto-containment (block sign-in + revoke sessions) for ${actions.length} ${minRisk}-risk user(s).`,
      actions,
    };
  },

  async apply(transport, action) {
    // 1. Disable account FIRST so no new refresh token can be minted during revocation.
    await transport.patch(`/users/${action.targetId}`, { accountEnabled: false });
    // 2. Revoke all active refresh/session tokens.
    await transport.post(`/users/${action.targetId}/revokeSignInSessions`, {});
    // 3. Optionally confirm compromise in Entra ID Protection.
    const confirmCompromised = Boolean(action.meta?.confirmCompromised);
    if (confirmCompromised) {
      await transport.post("/identityProtection/riskyUsers/confirmCompromised", {
        userIds: [action.targetId],
      });
    }
    return {
      afterState: {
        id: action.targetId,
        accountEnabled: false,
        sessionsRevoked: true,
        confirmedCompromised: confirmCompromised,
      },
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};

/**
 * 5. External Mailbox Forwarding Rule Remediation
 */
export const externalMailboxForwardingAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "external-mailbox-forwarding-remediation",
  version: "1.0.0",
  name: "External Mailbox Forwarding Rule Remediation",
  category: "security",
  riskLevel: "medium",
  description:
    "Scans Exchange Online Inbox messageRules for Business Email Compromise (BEC) auto-forwarding or redirect rules pointing outside verified tenant domains, disabling or deleting offending rules.",
  requiredPermissions: ["MailboxSettings.ReadWrite", "User.Read.All", "Organization.Read.All"],
  recommendedSchedule: "hourly",
  recommendedMode: "audit",
  service: "Exchange Online",
  icon: "exchange",
  dataSource: "graph-v1",
  tags: ["exchange", "bec", "forwarding", "exfiltration", "inbox-rules"],
  pairedReportId: "dlp-alerts",
  paramSchema: [
    {
      key: "allowedExternalDomains",
      label: "Approved External Forwarding Domains",
      type: "string_list",
      description: "Approved external domains allowed in Inbox forwarding rules (verified tenant domains are always allowed).",
      defaultValue: [],
    },
    {
      key: "remediationMode",
      label: "Rule Action",
      type: "select",
      description: "Disable rule in place (preserves forensic evidence) or permanently delete it.",
      defaultValue: "disable",
      options: [
        { value: "disable", label: "Disable Inbox Rule (Forensic Safe)" },
        { value: "delete", label: "Delete Inbox Rule" },
      ],
    },
    {
      key: "excludedMailboxes",
      label: "Excluded Mailbox UPNs",
      type: "string_list",
      description: "Shared or service mailboxes exempt from external forwarding checks.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const allowedDomains = new Set(asStringList(params.allowedExternalDomains).map((d) => d.toLowerCase()));
    const remediationMode = params.remediationMode === "delete" ? "delete" : "disable";
    const excludedMailboxes = new Set(asStringList(params.excludedMailboxes).map((m) => m.toLowerCase()));

    const orgRes = await transport.get<{
      verifiedDomains?: Array<{ name?: string }>;
    }>("/organization?$select=verifiedDomains");
    for (const org of orgRes.value) {
      for (const dom of org.verifiedDomains ?? []) {
        if (dom.name) allowedDomains.add(dom.name.toLowerCase());
      }
    }

    const usersRes = await transport.get<{
      id: string;
      userPrincipalName?: string;
      mail?: string;
      assignedLicenses?: Array<{ skuId: string }>;
    }>("/users?$filter=userType eq 'Member'&$select=id,userPrincipalName,mail,assignedLicenses&$top=200");

    const licensedUsers = usersRes.value.filter(
      (u) =>
        u.id &&
        (u.assignedLicenses?.length ?? 0) > 0 &&
        !excludedMailboxes.has((u.userPrincipalName ?? "").toLowerCase()) &&
        !excludedMailboxes.has((u.mail ?? "").toLowerCase()),
    );

    interface RecipientItem {
      emailAddress?: { address?: string };
    }
    interface MessageRuleRow {
      id: string;
      displayName?: string;
      isEnabled?: boolean;
      sequence?: number;
      conditions?: Record<string, unknown>;
      exceptions?: Record<string, unknown>;
      actions?: {
        forwardTo?: RecipientItem[];
        forwardAsAttachmentTo?: RecipientItem[];
        redirectTo?: RecipientItem[];
      };
    }

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const u of licensedUsers) {
      evaluated++;
      let rules: MessageRuleRow[] = [];
      try {
        const ruleRes = await transport.get<MessageRuleRow>(
          `/users/${u.id}/mailFolders/inbox/messageRules`,
        );
        rules = ruleRes.value;
      } catch {
        // Mailboxes not yet provisioned in Exchange Online can return 404 MailboxNotEnabledForRESTAPI; skip cleanly.
        continue;
      }

      for (const rule of rules) {
        if (!rule.id || rule.isEnabled === false) continue;
        const targets = [
          ...(rule.actions?.forwardTo ?? []),
          ...(rule.actions?.forwardAsAttachmentTo ?? []),
          ...(rule.actions?.redirectTo ?? []),
        ]
          .map((r) => (r.emailAddress?.address ?? "").trim().toLowerCase())
          .filter((addr) => addr.includes("@"));

        const externalTargets = targets.filter((addr) => {
          const dom = addr.split("@")[1] ?? "";
          return dom && !allowedDomains.has(dom);
        });
        if (externalTargets.length === 0) continue;

        const upn = u.mail || u.userPrincipalName || u.id;
        actions.push({
          targetType: "inboxMessageRule",
          targetId: `${u.id}:${rule.id}`,
          targetLabel: `${upn} → "${rule.displayName ?? rule.id}"`,
          actionType: remediationMode === "delete" ? "delete_forwarding_rule" : "disable_forwarding_rule",
          reason: `Forwards/redirects mail externally to [${externalTargets.join(", ")}]`,
          beforeState: {
            userId: u.id,
            mailbox: upn,
            rule,
          },
          plannedAfterState:
            remediationMode === "delete"
              ? { deleted: true }
              : { userId: u.id, ruleId: rule.id, isEnabled: false },
          rollbackPayload:
            remediationMode === "delete"
              ? {
                  method: "POST",
                  path: `/users/${u.id}/mailFolders/inbox/messageRules`,
                  body: {
                    displayName: rule.displayName ?? "Restored Rule",
                    sequence: rule.sequence ?? 1,
                    isEnabled: true,
                    conditions: rule.conditions ?? {},
                    actions: rule.actions ?? {},
                    ...(rule.exceptions ? { exceptions: rule.exceptions } : {}),
                  },
                  description: `Recreate deleted Inbox rule "${rule.displayName ?? rule.id}" on ${upn}`,
                }
              : {
                  method: "PATCH",
                  path: `/users/${u.id}/mailFolders/inbox/messageRules/${rule.id}`,
                  body: { isEnabled: true },
                  description: `Re-enable Inbox rule "${rule.displayName ?? rule.id}" on ${upn}`,
                },
          meta: { userId: u.id, ruleId: rule.id, remediationMode },
        });
      }
    }

    return {
      evaluatedCount: evaluated,
      summary:
        actions.length === 0
          ? `Scanned ${evaluated} licensed mailbox(es); zero unauthorized external Inbox forwarding rules found.`
          : `Detected ${actions.length} unauthorized external Inbox forwarding rule(s) across ${evaluated} mailbox(es).`,
      actions,
    };
  },

  async apply(transport, action) {
    const userId = String(action.meta?.userId ?? "");
    const ruleId = String(action.meta?.ruleId ?? "");
    if (!userId || !ruleId) throw new Error("Missing userId/ruleId metadata for messageRule remediation");

    if (action.meta?.remediationMode === "delete") {
      await transport.delete(`/users/${userId}/mailFolders/inbox/messageRules/${ruleId}`);
      return { afterState: { deleted: true }, rollbackPayload: action.rollbackPayload ?? null };
    }
    await transport.patch(`/users/${userId}/mailFolders/inbox/messageRules/${ruleId}`, {
      isEnabled: false,
    });
    return {
      afterState: { userId, ruleId, isEnabled: false },
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};

/**
 * 6. Compromised Workload Identity (Service Principal) Auto-Containment
 */
export const riskyWorkloadIdentityContainmentAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "risky-workload-identity-containment",
  version: "1.0.0",
  name: "Compromised Workload Identity Auto-Containment",
  category: "security",
  riskLevel: "high",
  description:
    "Disables Enterprise Service Principals flagged at high risk by Entra Workload ID Protection (leaked credentials, suspicious token replay) while protecting Microsoft first-party and allowlisted apps.",
  requiredPermissions: ["IdentityRiskyServicePrincipal.ReadWrite.All", "Application.ReadWrite.All"],
  recommendedSchedule: "hourly",
  recommendedMode: "audit",
  service: "Entra Workload ID",
  icon: "credentials",
  dataSource: "graph-v1",
  tags: ["service-principal", "workload-id", "containment", "compromise"],
  pairedReportId: "risky-service-principals",
  paramSchema: [
    {
      key: "minRiskLevel",
      label: "Minimum Risk Level",
      type: "select",
      description: "Minimum workload identity risk level to disable.",
      defaultValue: "high",
      options: [
        { value: "high", label: "High Risk Only" },
        { value: "medium", label: "Medium & High Risk" },
      ],
    },
    {
      key: "confirmCompromised",
      label: "Confirm Compromised in Workload ID Protection",
      type: "boolean",
      description: "Mark service principal as confirmedCompromised after disabling sign-in.",
      defaultValue: true,
    },
    {
      key: "protectedAppIds",
      label: "Protected Application (Client) IDs",
      type: "string_list",
      description: "Critical appIds exempt from automatic disablement.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const minRisk = params.minRiskLevel === "medium" ? "medium" : "high";
    const confirmCompromised = asBoolean(params.confirmCompromised, true);
    const protectedApps = new Set(asStringList(params.protectedAppIds).map((a) => a.toLowerCase()));
    const allowedLevels = minRisk === "medium" ? new Set(["medium", "high"]) : new Set(["high"]);

    const riskyRes = await transport.get<{
      id: string;
      appId?: string;
      displayName?: string;
      riskLevel?: string;
      riskState?: string;
      riskDetail?: string;
    }>(
      "/identityProtection/riskyServicePrincipals?$filter=riskState eq 'atRisk'&$select=id,appId,displayName,riskLevel,riskState,riskDetail&$top=500",
    );

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const r of riskyRes.value) {
      if (!r.id) continue;
      evaluated++;
      if (!r.riskLevel || !allowedLevels.has(r.riskLevel.toLowerCase())) continue;
      if (r.appId && protectedApps.has(r.appId.toLowerCase())) continue;

      const spRes = await transport.getOne<{
        id: string;
        appId?: string;
        displayName?: string;
        accountEnabled?: boolean;
        appOwnerOrganizationId?: string;
      }>(`/servicePrincipals/${r.id}?$select=id,appId,displayName,accountEnabled,appOwnerOrganizationId`);
      const sp = spRes.data;
      if (sp?.appOwnerOrganizationId === MICROSOFT_TENANT_APP_OWNER_ID) continue;
      if (sp?.accountEnabled === false && !confirmCompromised) continue;

      const label = sp?.displayName ?? r.displayName ?? r.appId ?? r.id;
      actions.push({
        targetType: "servicePrincipal",
        targetId: r.id,
        targetLabel: label,
        actionType: "contain_risky_service_principal",
        reason: `Workload identity flagged at ${r.riskLevel} risk (${r.riskDetail ?? "atRisk"})`,
        beforeState: {
          id: r.id,
          appId: sp?.appId ?? r.appId ?? null,
          displayName: label,
          accountEnabled: sp?.accountEnabled ?? true,
          riskLevel: r.riskLevel,
          riskState: r.riskState ?? "atRisk",
        },
        plannedAfterState: {
          id: r.id,
          accountEnabled: false,
          confirmedCompromised: confirmCompromised,
        },
        rollbackPayload: {
          method: "PATCH",
          path: `/servicePrincipals/${r.id}`,
          body: { accountEnabled: sp?.accountEnabled ?? true },
          description: `Re-enable Enterprise Service Principal "${label}"`,
        },
        meta: { confirmCompromised },
      });
    }

    return {
      evaluatedCount: evaluated,
      summary:
        actions.length === 0
          ? `Zero uncontained ${minRisk}-risk workload identities across ${evaluated} record(s).`
          : `Flagged ${actions.length} ${minRisk}-risk Enterprise Service Principal(s) for containment.`,
      actions,
    };
  },

  async apply(transport, action) {
    await transport.patch(`/servicePrincipals/${action.targetId}`, { accountEnabled: false });
    const confirmCompromised = Boolean(action.meta?.confirmCompromised);
    if (confirmCompromised) {
      await transport.post("/identityProtection/riskyServicePrincipals/confirmCompromised", {
        servicePrincipalIds: [action.targetId],
      });
    }
    return {
      afterState: {
        id: action.targetId,
        accountEnabled: false,
        confirmedCompromised: confirmCompromised,
      },
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};

/**
 * 7. Unverified / High-Risk OAuth2 App Consent Revocation
 */
export const riskyOauthConsentRevocationAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "risky-oauth-consent-revocation",
  version: "1.0.0",
  name: "Unverified OAuth2 Phishing Consent Revocation",
  category: "security",
  riskLevel: "medium",
  description:
    "Neutralizes illicit consent-phishing grants by revoking delegated oauth2PermissionGrants from unverified external publishers holding high-impact mail, files, or directory scopes.",
  requiredPermissions: ["DelegatedPermissionGrant.ReadWrite.All", "Application.Read.All", "Organization.Read.All"],
  recommendedSchedule: "daily",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "defender",
  dataSource: "graph-v1",
  tags: ["oauth", "consent-phishing", "permissions", "shadow-it", "security"],
  pairedReportId: "sp-sign-ins",
  paramSchema: [
    {
      key: "highRiskScopes",
      label: "High-Risk Delegated Scopes",
      type: "string_list",
      description: "Delegated scopes that trigger revocation on unverified external apps.",
      defaultValue: [
        "Mail.ReadWrite",
        "Mail.Send",
        "MailboxSettings.ReadWrite",
        "Files.ReadWrite.All",
        "Sites.ReadWrite.All",
        "Directory.AccessAsUser.All",
        "RoleManagement.ReadWrite.Directory",
      ],
    },
    {
      key: "onlyUserConsented",
      label: "Only User-Consented Grants (consentType = Principal)",
      type: "boolean",
      description: "Skip tenant-wide admin-consented grants (consentType = AllPrincipals).",
      defaultValue: true,
    },
    {
      key: "approvedClientAppIds",
      label: "Approved Client App IDs",
      type: "string_list",
      description: "Third-party client appIds explicitly approved for delegated scopes.",
      defaultValue: [],
    },
  ],

  async plan(transport, params) {
    const riskyScopes = new Set(asStringList(params.highRiskScopes).map((s) => s.toLowerCase()));
    const onlyUserConsented = asBoolean(params.onlyUserConsented, true);
    const approvedApps = new Set(asStringList(params.approvedClientAppIds).map((a) => a.toLowerCase()));

    const orgRes = await transport.get<{ id: string }>("/organization?$select=id");
    const tenantId = orgRes.value[0]?.id;

    const grantsRes = await transport.get<{
      id: string;
      clientId: string;
      consentType?: string;
      principalId?: string | null;
      resourceId: string;
      scope?: string;
    }>("/oauth2PermissionGrants?$top=999");

    const spCache = new Map<
      string,
      { appId?: string; displayName?: string; appOwnerOrganizationId?: string; verified?: boolean }
    >();

    const actions: PlannedAutomationAction[] = [];
    let evaluated = 0;

    for (const g of grantsRes.value) {
      if (!g.id || !g.clientId) continue;
      evaluated++;
      if (onlyUserConsented && g.consentType !== "Principal") continue;

      const scopes = (g.scope ?? "")
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const matchedScopes = scopes.filter((s) => riskyScopes.has(s.toLowerCase()));
      if (matchedScopes.length === 0) continue;

      let spInfo = spCache.get(g.clientId);
      if (!spInfo) {
        try {
          const spRes = await transport.getOne<{
            appId?: string;
            displayName?: string;
            appOwnerOrganizationId?: string;
            verifiedPublisher?: { verifiedPublisherId?: string | null };
          }>(
            `/servicePrincipals/${g.clientId}?$select=id,appId,displayName,appOwnerOrganizationId,verifiedPublisher`,
          );
          spInfo = {
            appId: spRes.data.appId,
            displayName: spRes.data.displayName,
            appOwnerOrganizationId: spRes.data.appOwnerOrganizationId,
            verified: Boolean(spRes.data.verifiedPublisher?.verifiedPublisherId),
          };
        } catch {
          spInfo = { verified: false };
        }
        spCache.set(g.clientId, spInfo);
      }

      if (spInfo.appOwnerOrganizationId === MICROSOFT_TENANT_APP_OWNER_ID) continue;
      if (tenantId && spInfo.appOwnerOrganizationId === tenantId) continue;
      if (spInfo.appId && approvedApps.has(spInfo.appId.toLowerCase())) continue;
      if (spInfo.verified) continue;

      const appLabel = spInfo.displayName ?? spInfo.appId ?? g.clientId;
      actions.push({
        targetType: "oauth2PermissionGrant",
        targetId: g.id,
        targetLabel: `${appLabel} (${g.consentType ?? "Principal"})`,
        actionType: "revoke_oauth2_grant",
        reason: `Unverified external app holds high-risk delegated scope(s): [${matchedScopes.join(", ")}]`,
        beforeState: {
          id: g.id,
          clientId: g.clientId,
          clientAppId: spInfo.appId ?? null,
          clientDisplayName: appLabel,
          consentType: g.consentType ?? "Principal",
          principalId: g.principalId ?? null,
          resourceId: g.resourceId,
          scope: g.scope ?? "",
        },
        plannedAfterState: { revoked: true },
        rollbackPayload: {
          method: "POST",
          path: "/oauth2PermissionGrants",
          body: {
            clientId: g.clientId,
            consentType: g.consentType ?? "Principal",
            ...(g.principalId ? { principalId: g.principalId } : {}),
            resourceId: g.resourceId,
            scope: g.scope ?? "",
          },
          description: `Recreate delegated OAuth2 grant for "${appLabel}"`,
        },
      });
    }

    return {
      evaluatedCount: evaluated,
      summary:
        actions.length === 0
          ? `Evaluated ${evaluated} OAuth2 permission grant(s); zero unverified high-risk grants detected.`
          : `Detected ${actions.length} unverified high-risk OAuth2 consent grant(s) to revoke.`,
      actions,
    };
  },

  async apply(transport, action) {
    await transport.delete(`/oauth2PermissionGrants/${action.targetId}`);
    return { afterState: { revoked: true }, rollbackPayload: action.rollbackPayload ?? null };
  },
};

/**
 * 8. Entra Tenant Authorization & Consent Policy Hardening Guardrail
 */
export const tenantAuthPolicyGuardrailAutomation: AutomationDefinition = {
  apiVersion: "argus.automation/v1",
  id: "tenant-authorization-policy-guardrail",
  version: "1.0.0",
  name: "Entra Tenant Authorization & Consent Hardening",
  category: "identity",
  riskLevel: "high",
  description:
    "Enforces CIS Microsoft 365 Benchmark defaults on the Entra singleton authorizationPolicy: restricts non-admin app registrations, shadow tenant creation, open guest invites, and legacy MSOnline PowerShell.",
  requiredPermissions: ["Policy.Read.All", "Policy.ReadWrite.Authorization"],
  recommendedSchedule: "daily",
  recommendedMode: "audit",
  service: "Microsoft Entra ID",
  icon: "entra",
  dataSource: "graph-v1",
  tags: ["cis-benchmark", "authorization-policy", "hardening", "user-consent", "shadow-it"],
  pairedReportId: "secure-score",
  paramSchema: [
    {
      key: "allowedToCreateApps",
      label: "Allow Standard Users to Register Apps",
      type: "boolean",
      description: "CIS recommends false (restrict app creation to Application Developer / Admin roles).",
      defaultValue: false,
    },
    {
      key: "allowedToCreateTenants",
      label: "Allow Standard Users to Create Tenants",
      type: "boolean",
      description: "CIS recommends false to prevent unmanaged shadow Entra/Azure AD tenants.",
      defaultValue: false,
    },
    {
      key: "allowInvitesFrom",
      label: "External Guest Invitation Scope",
      type: "select",
      description: "Who can invite B2B guest users into the tenant.",
      defaultValue: "adminsAndGuestInviters",
      options: [
        { value: "adminsAndGuestInviters", label: "Admins & Guest Inviter Role Only (CIS)" },
        { value: "adminsOnly", label: "Admins Only" },
        { value: "none", label: "No One" },
      ],
    },
    {
      key: "blockMsolPowerShell",
      label: "Block Legacy MSOnline PowerShell",
      type: "boolean",
      description: "Block deprecated MSOnline PowerShell module access.",
      defaultValue: true,
    },
  ],

  async plan(transport, params) {
    const desiredCreateApps = asBoolean(params.allowedToCreateApps, false);
    const desiredCreateTenants = asBoolean(params.allowedToCreateTenants, false);
    const desiredInvites = asString(params.allowInvitesFrom, "adminsAndGuestInviters");
    const desiredBlockMsol = asBoolean(params.blockMsolPowerShell, true);

    const res = await transport.getOne<{
      id?: string;
      allowInvitesFrom?: string;
      blockMsolPowerShell?: boolean;
      defaultUserRolePermissions?: {
        allowedToCreateApps?: boolean;
        allowedToCreateTenants?: boolean;
        allowedToCreateSecurityGroups?: boolean;
        allowedToReadOtherUsers?: boolean;
        permissionGrantPoliciesAssigned?: string[];
      };
    }>("/policies/authorizationPolicy");

    const cur = res.data;
    const curPerms = cur.defaultUserRolePermissions ?? {};
    const diffs: string[] = [];

    if (cur.allowInvitesFrom !== desiredInvites) {
      diffs.push(`allowInvitesFrom: ${cur.allowInvitesFrom} → ${desiredInvites}`);
    }
    if (Boolean(cur.blockMsolPowerShell) !== desiredBlockMsol) {
      diffs.push(`blockMsolPowerShell: ${Boolean(cur.blockMsolPowerShell)} → ${desiredBlockMsol}`);
    }
    if (Boolean(curPerms.allowedToCreateApps) !== desiredCreateApps) {
      diffs.push(`allowedToCreateApps: ${Boolean(curPerms.allowedToCreateApps)} → ${desiredCreateApps}`);
    }
    if (Boolean(curPerms.allowedToCreateTenants) !== desiredCreateTenants) {
      diffs.push(`allowedToCreateTenants: ${Boolean(curPerms.allowedToCreateTenants)} → ${desiredCreateTenants}`);
    }

    if (diffs.length === 0) {
      return {
        evaluatedCount: 1,
        summary: "Tenant authorizationPolicy matches CIS hardening baseline.",
        actions: [],
      };
    }

    const patchBody = {
      allowInvitesFrom: desiredInvites,
      blockMsolPowerShell: desiredBlockMsol,
      defaultUserRolePermissions: {
        ...curPerms,
        allowedToCreateApps: desiredCreateApps,
        allowedToCreateTenants: desiredCreateTenants,
      },
    };

    const rollbackBody = {
      ...(cur.allowInvitesFrom ? { allowInvitesFrom: cur.allowInvitesFrom } : {}),
      ...(cur.blockMsolPowerShell !== undefined ? { blockMsolPowerShell: cur.blockMsolPowerShell } : {}),
      defaultUserRolePermissions: curPerms,
    };

    return {
      evaluatedCount: 1,
      summary: `Tenant authorizationPolicy drifted on ${diffs.length} setting(s): ${diffs.join("; ")}`,
      actions: [
        {
          targetType: "authorizationPolicy",
          targetId: cur.id ?? "authorizationPolicy",
          targetLabel: "Tenant Authorization Policy",
          actionType: "harden_authorization_policy",
          reason: diffs.join("; "),
          beforeState: rollbackBody as Record<string, unknown>,
          plannedAfterState: patchBody as Record<string, unknown>,
          rollbackPayload: {
            method: "PATCH",
            path: "/policies/authorizationPolicy",
            body: rollbackBody,
            description: "Restore previous Entra authorizationPolicy settings",
          },
          meta: { patchBody },
        },
      ],
    };
  },

  async apply(transport, action) {
    const patchBody = action.meta?.patchBody;
    if (!patchBody) throw new Error("Missing patchBody for authorizationPolicy");
    await transport.patch("/policies/authorizationPolicy", patchBody);
    return {
      afterState: action.plannedAfterState ?? {},
      rollbackPayload: action.rollbackPayload ?? null,
    };
  },
};
