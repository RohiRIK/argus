import { describe, expect, test } from "bun:test";
import type { AutomationGraphTransport } from "@/services/automations/types";
import {
  compareVersions,
  disabledUserCleanupAutomation,
  inactiveUserDisableAutomation,
  joinerMoverGroupSyncAutomation,
  leaverOffboardingAutomation,
  parseGroupSyncRules,
  unsupportedOsLifecycleAutomation,
} from "@/services/automations/catalog/lifecycle";
import { listAutomations } from "@/services/automations/registry";

const GROUP = "11111111-1111-1111-1111-111111111111";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Fake transport: routes GETs by path prefix, records writes. */
function fakeTransport(routes: Record<string, unknown[] | Record<string, unknown>>) {
  const writes: Array<{ method: string; path: string; body?: unknown }> = [];
  const find = (path: string) => {
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => path.startsWith(k));
    if (!key) throw new Error(`unexpected GET ${path}`);
    return routes[key];
  };
  const transport: AutomationGraphTransport = {
    get: async <T,>(path: string) => ({ value: find(path) as T[], latencyMs: 1 }),
    getOne: async <T,>(path: string) => ({ data: find(path) as T, latencyMs: 1 }),
    post: async <T,>(path: string, body?: unknown) => (writes.push({ method: "POST", path, body }), { data: {} as T, latencyMs: 1 }),
    patch: async <T,>(path: string, body: unknown) => (writes.push({ method: "PATCH", path, body }), { data: {} as T, latencyMs: 1 }),
    delete: async (path: string) => (writes.push({ method: "DELETE", path }), { latencyMs: 1 }),
  };
  return { transport, writes };
}

describe("lifecycle helpers", () => {
  test("compareVersions handles dotted and short versions", () => {
    expect(compareVersions("10.0.19045.3803", "10.0.22000")).toBeLessThan(0);
    expect(compareVersions("10.0.22631", "10.0.22000")).toBeGreaterThan(0);
    expect(compareVersions("13", "13.0")).toBe(0);
    expect(compareVersions("17.2.1", "17.0")).toBeGreaterThan(0);
  });

  test("parseGroupSyncRules parses and rejects bad rules", () => {
    expect(parseGroupSyncRules([`Department = Sales => ${GROUP}`])).toEqual([
      { attribute: "department", value: "Sales", groupId: GROUP },
    ]);
    expect(() => parseGroupSyncRules(["department=Sales"])).toThrow(/Invalid rule/);
    expect(() => parseGroupSyncRules([`manager=x => ${GROUP}`])).toThrow(/Unsupported attribute/);
  });

  test("registry ids are unique and include lifecycle automations", () => {
    const ids = listAutomations().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("leaver-offboarding");
    expect(ids).toContain("unsupported-os-lifecycle");
  });
});

describe("user lifecycle", () => {
  test("leaver: only past-leave, non-excluded, cloud users; apply disables + revokes", async () => {
    const { transport, writes } = fakeTransport({
      "/users": [
        { id: "u1", userPrincipalName: "gone@x.com", employeeLeaveDateTime: daysAgo(2) },
        { id: "u2", userPrincipalName: "future@x.com", employeeLeaveDateTime: daysAgo(-5) },
        { id: "u3", userPrincipalName: "bg@x.com", employeeLeaveDateTime: daysAgo(9) },
        { id: "u4", userPrincipalName: "synced@x.com", employeeLeaveDateTime: daysAgo(9), onPremisesSyncEnabled: true },
      ],
    });
    const plan = await leaverOffboardingAutomation.plan(transport, { graceDays: 1, excludedUserUpns: ["BG@x.com"] });
    expect(plan.actions.map((a) => a.targetId)).toEqual(["u1"]);
    expect(plan.actions[0].rollbackPayload).toMatchObject({ method: "PATCH", body: { accountEnabled: true } });

    await leaverOffboardingAutomation.apply(transport, plan.actions[0], {});
    expect(writes).toEqual([
      { method: "PATCH", path: "/users/u1", body: { accountEnabled: false } },
      { method: "POST", path: "/users/u1/revokeSignInSessions", body: {} },
    ]);
  });

  test("inactive disable uses latest sign-in; minimum threshold is 30 days", async () => {
    const { transport } = fakeTransport({
      "/users": [
        { id: "idle", createdDateTime: daysAgo(400), signInActivity: { lastSignInDateTime: daysAgo(120) } },
        { id: "nonint", createdDateTime: daysAgo(400), signInActivity: { lastSignInDateTime: daysAgo(120), lastNonInteractiveSignInDateTime: daysAgo(3) } },
        { id: "fresh", createdDateTime: daysAgo(10) },
      ],
    });
    const plan = await inactiveUserDisableAutomation.plan(transport, { inactivityDays: 5 });
    // 5 clamps up to 30 → "fresh" (10 days old, never signed in) is not disabled.
    expect(plan.actions.map((a) => a.targetId)).toEqual(["idle"]);
  });

  test("disabled cleanup soft-deletes with restore rollback", async () => {
    const { transport } = fakeTransport({
      "/users": [{ id: "d1", userPrincipalName: "old@x.com", createdDateTime: daysAgo(900), signInActivity: { lastSignInDateTime: daysAgo(200) } }],
    });
    const plan = await disabledUserCleanupAutomation.plan(transport, {});
    expect(plan.actions[0].rollbackPayload?.path).toBe("/directory/deletedItems/d1/restore");
  });

  test("joiner/mover adds matches and removes movers", async () => {
    const { transport, writes } = fakeTransport({
      [`/groups/${GROUP}/members`]: [{ id: "mover" }, { id: "stay" }],
      [`/groups/${GROUP}`]: { displayName: "SG-Sales", groupTypes: [] },
      "/users": [
        { id: "joiner", userPrincipalName: "j@x.com", department: "sales" },
        { id: "stay", userPrincipalName: "s@x.com", department: "Sales" },
        { id: "mover", userPrincipalName: "m@x.com", department: "Finance" },
      ],
    });
    const plan = await joinerMoverGroupSyncAutomation.plan(transport, { rules: [`department=Sales => ${GROUP}`] });
    expect(plan.actions.map((a) => `${a.actionType}:${a.targetId}`).sort()).toEqual([
      "add_group_member:joiner",
      "remove_group_member:mover",
    ]);
    for (const a of plan.actions) await joinerMoverGroupSyncAutomation.apply(transport, a, {});
    expect(writes.map((w) => `${w.method} ${w.path}`).sort()).toEqual([
      `DELETE /groups/${GROUP}/members/mover/$ref`,
      `POST /groups/${GROUP}/members/$ref`,
    ]);
  });

  test("joiner/mover refuses dynamic groups", async () => {
    const { transport } = fakeTransport({
      [`/groups/${GROUP}`]: { groupTypes: ["DynamicMembership"] },
      "/users": [],
    });
    await expect(joinerMoverGroupSyncAutomation.plan(transport, { rules: [`department=Sales => ${GROUP}`] })).rejects.toThrow(/dynamic/);
  });
});

describe("OS lifecycle", () => {
  test("tags end-of-support devices and untags upgraded ones", async () => {
    const { transport } = fakeTransport({
      [`/groups/${GROUP}/members`]: [{ id: "obj-upgraded" }, { id: "obj-old-tagged" }],
      [`/groups/${GROUP}`]: { displayName: "Unsupported OS", groupTypes: [] },
      "/deviceManagement/managedDevices": [
        { id: "m1", deviceName: "W10", operatingSystem: "Windows", osVersion: "10.0.19045.1", azureADDeviceId: "D1" },
        { id: "m2", deviceName: "W11", operatingSystem: "Windows", osVersion: "10.0.22631.1", azureADDeviceId: "d2" },
        { id: "m3", deviceName: "OldTagged", operatingSystem: "iOS", osVersion: "16.7", azureADDeviceId: "d3" },
        { id: "m4", deviceName: "Linux", operatingSystem: "Linux", osVersion: "1.0", azureADDeviceId: "d4" },
      ],
      "/devices": [
        { id: "obj-w10", deviceId: "d1" },
        { id: "obj-upgraded", deviceId: "d2" },
        { id: "obj-old-tagged", deviceId: "d3" },
      ],
    });
    const plan = await unsupportedOsLifecycleAutomation.plan(transport, {
      targetGroupId: GROUP,
      minWindowsVersion: "10.0.22000",
      minIosVersion: "17.0",
    });
    expect(plan.evaluatedCount).toBe(3);
    expect(plan.actions.map((a) => `${a.actionType}:${a.targetId}`).sort()).toEqual([
      "add_group_member:obj-w10",
      "remove_group_member:obj-upgraded",
    ]);
  });

  test("asks for a target group when unset and rejects a non-GUID", async () => {
    const { transport } = fakeTransport({});
    const plan = await unsupportedOsLifecycleAutomation.plan(transport, { targetGroupId: "" });
    expect(plan.actions).toEqual([]);
    expect(plan.summary).toMatch(/Configure/);
    await expect(unsupportedOsLifecycleAutomation.plan(transport, { targetGroupId: "nope" })).rejects.toThrow(/GUID/);
  });
});
