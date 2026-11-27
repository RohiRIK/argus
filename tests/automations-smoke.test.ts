import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-auto-smoke-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
const { automationPoliciesDao, automationActionsDao } = await import("../src/db/dao/automations");
const { listAutomations, defaultParamsForAutomation } = await import("../src/services/automations/registry");
const { runAutomationPolicy, rollbackAutomationAction } = await import("../src/services/automations/engine");
import type { AutomationGraphTransport } from "../src/services/automations/types";

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const GROUP = "11111111-1111-1111-1111-111111111111";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Fake Graph: records every call; GET answers come from `fixture(path)`. */
function fakeGraph(fixture: (path: string) => unknown) {
  const calls: string[] = [];
  const writes: string[] = [];
  const transport: AutomationGraphTransport = {
    get: async <T,>(path: string) => {
      calls.push(`GET ${path}`);
      const v = fixture(path);
      return { value: (Array.isArray(v) ? v : []) as T[], latencyMs: 1 };
    },
    getOne: async <T,>(path: string) => {
      calls.push(`GET1 ${path}`);
      return { data: (fixture(path) ?? {}) as T, latencyMs: 1 };
    },
    post: async <T,>(path: string) => (writes.push(`POST ${path}`), { data: {} as T, latencyMs: 1 }),
    patch: async <T,>(path: string) => (writes.push(`PATCH ${path}`), { data: {} as T, latencyMs: 1 }),
    delete: async (path: string) => (writes.push(`DELETE ${path}`), { latencyMs: 1 }),
  };
  return { transport, calls, writes };
}

const BG = "22222222-2222-2222-2222-222222222222";
const CA1 = "33333333-3333-3333-3333-333333333333";
const ADMIN_OK = "44444444-4444-4444-4444-444444444444";
const GA = "62e90394-69f5-4237-9190-012177145e10";

const PARAM_OVERRIDES: Record<string, Record<string, unknown>> = {
  "break-glass-ca-exclusion-guardrail": { breakGlassUsers: [BG] },
  "ca-baseline-and-named-location-guardrail": { enforcedEnabledPolicyIds: [CA1] },
  "privileged-role-drift-guard": { approvedPrincipalIds: [ADMIN_OK] },
  "ownerless-m365-group-remediation": { fallbackOwnerUserId: ADMIN_OK },
  "joiner-mover-group-sync": { rules: [`department=Sales => ${GROUP}`] },
  "unsupported-os-lifecycle": { targetGroupId: GROUP },
};

const quietDeps = {
  canSendEmail: false,
  resolveRecipients: async () => ({ emails: [], groups: [], warnings: [] }) as never,
  dispatchWebhooks: async () => [],
};

describe("automation smoke: every catalog automation through the real engine", () => {
  for (const def of listAutomations()) {
    test(def.id, async () => {
      const policy = automationPoliciesDao.create({
        name: `smoke ${def.id}`,
        automationType: def.id,
        mode: "audit",
        params: { ...defaultParamsForAutomation(def), ...(PARAM_OVERRIDES[def.id] ?? {}) },
        scheduleType: "manual",
        maxActionsPerRun: 500,
      });
      const g = fakeGraph(FIXTURE);

      // 1. Audit: detects drift, never writes.
      const audit = await runAutomationPolicy(policy, { ...quietDeps, transport: g.transport });
      expect(audit.errorMessage ?? null).toBeNull();
      expect(audit.status).toBe("drift_detected");
      expect(audit.plannedCount).toBeGreaterThan(0);
      expect(g.writes).toEqual([]);

      // 2. Enforce: applies every planned change without failures.
      const enforce = await runAutomationPolicy(policy, { ...quietDeps, transport: g.transport, modeOverride: "enforce" });
      expect(enforce.errorMessage ?? null).toBeNull();
      expect(enforce.status).toBe("success");
      expect(enforce.failedCount).toBe(0);
      expect(enforce.appliedCount).toBe(enforce.plannedCount);
      expect(g.writes.length).toBeGreaterThan(0);

      // 3. Rollback: every reversible change rolls back cleanly.
      const applied = automationActionsDao.forRun(enforce.id).filter((a) => a.status === "applied" && a.rollbackPayload);
      for (const a of applied) {
        const rb = await rollbackAutomationAction(a.id, { transport: g.transport });
        expect(rb.action.status).toBe("rolled_back");
      }
    });
  }
});

/** One deliberately unhealthy tenant: every automation should find something to fix. */
const old = { lastSignInDateTime: daysAgo(400), lastNonInteractiveSignInDateTime: daysAgo(400) };
const MEMBER = {
  id: "u-member", userPrincipalName: "m@contoso.com", mail: "m@contoso.com", displayName: "Member",
  accountEnabled: true, userType: "Member", department: "Sales", createdDateTime: daysAgo(900),
  employeeLeaveDateTime: daysAgo(3), signInActivity: old,
  assignedLicenses: [{ skuId: "sku-cop", disabledPlans: [] }], licenseAssignmentStates: [],
};
const DISABLED = { ...MEMBER, id: "u-disabled", userPrincipalName: "d@contoso.com", accountEnabled: false, assignedLicenses: [{ skuId: "sku-e5" }] };
const GUEST = {
  ...MEMBER, id: "u-guest", userPrincipalName: "g_ext#EXT#@contoso.com", userType: "Guest",
  externalUserState: "PendingAcceptance", externalUserStateChangeDateTime: daysAgo(300), assignedLicenses: [],
};

function FIXTURE(path: string): unknown {
  const p = path.split("?")[0];
  if (p === "/identity/conditionalAccess/policies")
    return [{ id: CA1, displayName: "Require MFA", state: "enabled", conditions: { users: { includeUsers: ["All"], excludeUsers: [] } } }];
  if (p.startsWith("/identity/conditionalAccess/policies/")) return { id: CA1, displayName: "Require MFA", state: "disabled" };
  if (p.endsWith("/mailFolders/inbox/messageRules"))
    return [{ id: "rule-1", displayName: "fwd", isEnabled: true, actions: { forwardTo: [{ emailAddress: { address: "x@evil.example" } }] } }];
  if (p === "/roleManagement/directory/roleAssignments")
    return [
      { id: "ra-ok", principalId: ADMIN_OK, roleDefinitionId: GA },
      { id: "ra-bad", principalId: "u-member", roleDefinitionId: GA, principal: { userPrincipalName: "m@contoso.com" } },
    ];
  if (p === "/identityProtection/riskyUsers")
    return [{ id: "u-member", userPrincipalName: "m@contoso.com", riskLevel: "high", riskState: "atRisk" }];
  if (p === "/identityProtection/riskyServicePrincipals")
    return [{ id: "sp-risky", appId: "app-risky", displayName: "Risky SP", riskLevel: "high", riskState: "atRisk" }];
  if (p === "/organization") return [{ id: "org-1", verifiedDomains: [{ name: "contoso.com", isDefault: true }] }];
  if (p === "/oauth2PermissionGrants")
    return [{ id: "grant-1", clientId: "sp-evil", consentType: "Principal", principalId: "u-member", resourceId: "sp-graph", scope: "Mail.ReadWrite Mail.Send Files.ReadWrite.All offline_access" }];
  if (p === "/subscribedSkus") return [{ skuId: "sku-e5", skuPartNumber: "SPE_E5" }, { skuId: "sku-cop", skuPartNumber: "Microsoft_365_Copilot" }];
  if (p === "/users") {
    if (path.includes("Guest")) return [GUEST];
    if (path.includes("accountEnabled eq false")) return [DISABLED];
    return [MEMBER];
  }
  if (p.endsWith("/memberOf/microsoft.graph.group")) return [{ id: "grp-a", displayName: "Grp A", groupTypes: [] }];
  if (p === "/applications")
    return [{ id: "app-obj", appId: "app-1", displayName: "Old App", passwordCredentials: [{ keyId: "key-1", displayName: "old", endDateTime: daysAgo(60) }], owners: [] }];
  if (p === "/groups") return [{ id: "grp-unified", displayName: "Team", mail: "team@contoso.com", owners: [] }];
  if (/^\/groups\/[^/]+\/members/.test(p)) return [];
  if (/^\/groups\/[^/]+$/.test(p)) return { id: GROUP, displayName: "SG Target", groupTypes: [] };
  if (p === "/deviceManagement/managedDevices")
    return [{ id: "md-1", deviceName: "W10-PC", operatingSystem: "Windows", osVersion: "10.0.19045.1", lastSyncDateTime: daysAgo(200), azureADDeviceId: "dev-1" }];
  if (p === "/devices")
    return [{ id: "obj-1", deviceId: "dev-1", displayName: "W10-PC", operatingSystem: "Windows", approximateLastSignInDateTime: daysAgo(400), physicalIds: [] }];
  return [];
}
