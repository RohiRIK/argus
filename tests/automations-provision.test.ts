import { describe, expect, test } from "bun:test";
import type { AutomationGraphTransport } from "@/services/automations/types";
import type { GroupGraphClientLike } from "@/services/graph/groups";
import { provisionAutomationParam } from "@/services/automations/provision";

function deps(existing: unknown[]) {
  const posts: unknown[] = [];
  const gets: string[] = [];
  const transport = {
    get: async (path: string) => (gets.push(path), { value: existing, latencyMs: 1 }),
  } as unknown as AutomationGraphTransport;
  const client = {
    api: () => ({
      post: async (body: unknown) => (posts.push(body), { id: "new-id", displayName: (body as { displayName: string }).displayName }),
    }),
  } as unknown as GroupGraphClientLike;
  return { posts, gets, d: { transport, groupDeps: { client } } };
}

describe("automation one-click provisioning", () => {
  test("creates the catalog-named security group when missing", async () => {
    const { posts, gets, d } = deps([]);
    const res = await provisionAutomationParam("unsupported-os-lifecycle", "targetGroupId", d);
    expect(res).toEqual({ id: "new-id", displayName: "Argus - Unsupported OS Devices", created: true });
    expect(gets[0]).toContain("displayName eq 'Argus - Unsupported OS Devices'");
    expect(posts[0]).toMatchObject({ securityEnabled: true, mailEnabled: false, displayName: "Argus - Unsupported OS Devices" });
  });

  test("reuses an existing assigned security group instead of duplicating", async () => {
    const { posts, d } = deps([{ id: "dyn", securityEnabled: true, groupTypes: ["DynamicMembership"] }, { id: "old-id", displayName: "Argus - Break-Glass Accounts", securityEnabled: true, groupTypes: [] }]);
    const res = await provisionAutomationParam("break-glass-ca-exclusion-guardrail", "breakGlassGroups", d);
    expect(res).toEqual({ id: "old-id", displayName: "Argus - Break-Glass Accounts", created: false });
    expect(posts).toEqual([]);
  });

  test("rejects params without a provision spec", async () => {
    const { d } = deps([]);
    await expect(provisionAutomationParam("inactive-user-disable", "inactivityDays", d)).rejects.toThrow(/Nothing to provision/);
  });
});
