import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GraphClientLike, GrantDeps } from "../src/services/graph/permissions-grant";

// Isolated DB so auditDao (GRANT-6) has real tables to write to.
const dir = mkdtempSync(join(tmpdir(), "argus-grant-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { grantMissingPermissions, GRAPH_APP_ID } = await import("../src/services/graph/permissions-grant");
const { auditDao } = await import("../src/db/dao/audit");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const GRAPH_ROLES = [
  { id: "role-userread", value: "User.Read.All" },
  { id: "role-mailsend", value: "Mail.Send" },
];

interface FakeOpts {
  graphAppRoles?: { id: string; value: string }[];
  existingRra?: { resourceAppId: string; resourceAccess: { id: string; type: string }[] }[];
  /** throw to simulate a Graph error on the appRoleAssignment POST */
  postError?: { statusCode: number };
}

function makeFakeClient(opts: FakeOpts = {}) {
  const calls = { posts: [] as { path: string; body: unknown }[], patches: [] as { path: string; body: unknown }[] };
  const resolveGet = (path: string, f?: string) => {
    if (path === "/servicePrincipals") {
      if (f?.includes(GRAPH_APP_ID)) return { value: [{ id: "graph-sp", appRoles: opts.graphAppRoles ?? GRAPH_ROLES }] };
      return { value: [{ id: "argus-sp" }] };
    }
    if (path === "/applications") return { value: [{ id: "app-1", requiredResourceAccess: opts.existingRra ?? [] }] };
    return { value: [] };
  };
  const client: GraphClientLike = {
    api(path: string) {
      return {
        filter(f: string) {
          return { select: () => ({ get: async () => resolveGet(path, f) }) };
        },
        select: () => ({ get: async () => resolveGet(path) }),
        post: async (body: unknown) => {
          calls.posts.push({ path, body });
          if (opts.postError) throw opts.postError;
        },
        patch: async (body: unknown) => {
          calls.patches.push({ path, body });
        },
      };
    },
  };
  return { client, calls };
}

/** Injected testConnection: first call = before-state missing, second = after-state. */
function makeProbe(before: string[], after: string[]): GrantDeps["testConnection"] {
  let n = 0;
  return async () => ({ steps: { permissions: { missing: n++ === 0 ? before : after } } });
}

describe("grantMissingPermissions orchestration (D2)", () => {
  test("GRANT-3: creates an appRoleAssignment per missing role; missing clears (success audit)", async () => {
    const { client, calls } = makeFakeClient();
    const res = await grantMissingPermissions({
      client,
      clientId: "client-123",
      testConnection: makeProbe(["User.Read.All", "Mail.Send"], []),
    });
    expect(res.granted.sort()).toEqual(["Mail.Send", "User.Read.All"]);
    expect(res.stillMissing).toEqual([]);

    const assignments = calls.posts.filter((p) => p.path === "/servicePrincipals/argus-sp/appRoleAssignments");
    expect(assignments).toHaveLength(2);
    expect(assignments.map((a) => (a.body as { appRoleId: string }).appRoleId).sort()).toEqual(["role-mailsend", "role-userread"]);
    expect((assignments[0].body as { resourceId: string }).resourceId).toBe("graph-sp");

    const audit = auditDao.list(5).find((a) => (a.detail as { granted?: string[] }).granted?.length === 2);
    expect(audit?.outcome).toBe("success");
  });

  test("GRANT-4: declares the granted roles on the application manifest", async () => {
    const { client, calls } = makeFakeClient();
    await grantMissingPermissions({
      client,
      clientId: "client-123",
      testConnection: makeProbe(["User.Read.All"], []),
    });
    expect(calls.patches).toHaveLength(1);
    expect(calls.patches[0].path).toBe("/applications/app-1");
    const rra = (calls.patches[0].body as { requiredResourceAccess: { resourceAppId: string; resourceAccess: { id: string }[] }[] }).requiredResourceAccess;
    const graph = rra.find((r) => r.resourceAppId === GRAPH_APP_ID)!;
    expect(graph.resourceAccess.map((r) => r.id)).toContain("role-userread");
  });

  test("GRANT-5: a 403 on assignment surfaces the bootstrap hint and audits an error", async () => {
    const { client } = makeFakeClient({ postError: { statusCode: 403 } });
    const before = auditDao.list(50).length;
    await expect(
      grantMissingPermissions({ client, clientId: "client-123", testConnection: makeProbe(["User.Read.All"], ["User.Read.All"]) }),
    ).rejects.toThrow(/AppRoleAssignment\.ReadWrite\.All/);
    const latest = auditDao.list(1)[0];
    expect(auditDao.list(50).length).toBe(before + 1);
    expect(latest.outcome).toBe("error");
  });

  test("409 (already assigned) is treated as granted, not an error", async () => {
    const { client } = makeFakeClient({ postError: { statusCode: 409 } });
    const res = await grantMissingPermissions({
      client,
      clientId: "client-123",
      testConnection: makeProbe(["Mail.Send"], []),
    });
    expect(res.granted).toEqual(["Mail.Send"]);
  });

  test("partial grant: leftover missing after re-test → partial audit", async () => {
    const { client } = makeFakeClient();
    const res = await grantMissingPermissions({
      client,
      clientId: "client-123",
      testConnection: makeProbe(["User.Read.All", "Mail.Send"], ["Mail.Send"]),
    });
    expect(res.stillMissing).toEqual(["Mail.Send"]);
    const audit = auditDao.list(1)[0];
    expect(audit.outcome).toBe("partial");
  });

  test("unknown scope (no matching appRole) is skipped — no assignment posted for it", async () => {
    const { client, calls } = makeFakeClient({ graphAppRoles: [{ id: "role-mailsend", value: "Mail.Send" }] });
    const res = await grantMissingPermissions({
      client,
      clientId: "client-123",
      testConnection: makeProbe(["Mail.Send", "Nonexistent.Scope"], ["Nonexistent.Scope"]),
    });
    expect(res.granted).toEqual(["Mail.Send"]);
    expect(calls.posts.filter((p) => p.path.endsWith("/appRoleAssignments"))).toHaveLength(1);
  });

  test("nothing missing → no Graph calls, success audit", async () => {
    const { client, calls } = makeFakeClient();
    const res = await grantMissingPermissions({ client, clientId: "client-123", testConnection: makeProbe([], []) });
    expect(res).toEqual({ granted: [], stillMissing: [] });
    expect(calls.posts).toHaveLength(0);
  });

  test("missing client id throws before any Graph call", async () => {
    const { client, calls } = makeFakeClient();
    await expect(
      grantMissingPermissions({ client, clientId: "", testConnection: makeProbe(["Mail.Send"], []) }),
    ).rejects.toThrow(/client ID/i);
    expect(calls.posts).toHaveLength(0);
  });
});
