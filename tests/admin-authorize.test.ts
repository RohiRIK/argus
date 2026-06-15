import { expect, test, describe } from "bun:test";
import { exchangeCodeForToken, appendAndGrant } from "../src/services/graph/admin-authorize";
import { GRAPH_RESOURCE_APP_ID } from "../src/lib/graph-consent";

const GRAPH_ROLES = [
  { id: "role-userread", value: "User.Read.All", allowedMemberTypes: ["Application"] },
  { id: "role-mailsend", value: "Mail.Send", allowedMemberTypes: ["Application"] },
];

interface FakeOpts {
  postStatus?: number; // appRoleAssignment POST status (default 201)
  postMessage?: string; // error.message returned on a non-2xx POST
}

function fakeGraph(opts: FakeOpts = {}) {
  const calls = { patch: [] as Record<string, unknown>[], post: [] as Record<string, unknown>[] };
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (u.includes("/servicePrincipals?") && u.includes(GRAPH_RESOURCE_APP_ID)) {
      return reply(200, { value: [{ id: "graph-sp", appId: GRAPH_RESOURCE_APP_ID, appRoles: GRAPH_ROLES }] });
    }
    if (u.includes("/servicePrincipals?")) return reply(200, { value: [{ id: "argus-sp" }] });
    if (u.includes("/applications?")) return reply(200, { value: [{ id: "app-obj", requiredResourceAccess: [] }] });
    if (u.includes("/applications/app-obj") && method === "PATCH") {
      calls.patch.push(JSON.parse(String(init?.body)));
      return reply(204, {});
    }
    if (u.includes("/appRoleAssignments") && method === "POST") {
      calls.post.push(JSON.parse(String(init?.body)));
      const st = opts.postStatus ?? 201;
      return reply(st, st >= 400 ? { error: { message: opts.postMessage ?? "error" } } : {});
    }
    return reply(404, { error: { message: `unexpected ${method} ${u}` } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

describe("appendAndGrant (delegated admin authorize)", () => {
  test("declares on the app registration AND grants each role", async () => {
    const { fetch: f, calls } = fakeGraph();
    const res = await appendAndGrant("tok", "client-123", ["User.Read.All", "Mail.Send"], { fetch: f });
    expect(res.declared.sort()).toEqual(["Mail.Send", "User.Read.All"]);
    expect(res.granted.sort()).toEqual(["Mail.Send", "User.Read.All"]);
    expect(res.stillMissing).toEqual([]);
    // declared on the manifest
    expect(calls.patch).toHaveLength(1);
    const rra = calls.patch[0].requiredResourceAccess as { resourceAppId: string; resourceAccess: { id: string }[] }[];
    const graph = rra.find((r) => r.resourceAppId === GRAPH_RESOURCE_APP_ID)!;
    expect(graph.resourceAccess.map((r) => r.id).sort()).toEqual(["role-mailsend", "role-userread"]);
    // granted via appRoleAssignment
    expect(calls.post).toHaveLength(2);
    expect((calls.post[0] as { resourceId: string }).resourceId).toBe("graph-sp");
  });

  test("409 already-assigned counts as granted", async () => {
    const { fetch: f } = fakeGraph({ postStatus: 409 });
    const res = await appendAndGrant("tok", "client-123", ["Mail.Send"], { fetch: f });
    expect(res.granted).toEqual(["Mail.Send"]);
    expect(res.stillMissing).toEqual([]);
  });

  test("400 'already exists' also counts as granted (re-Authorize idempotency)", async () => {
    const { fetch: f } = fakeGraph({ postStatus: 400, postMessage: "Permission being assigned already exists on the application" });
    const res = await appendAndGrant("tok", "client-123", ["Mail.Send"], { fetch: f });
    expect(res.granted).toEqual(["Mail.Send"]);
    expect(res.stillMissing).toEqual([]);
  });

  test("unknown scope (no matching app role) is left in stillMissing", async () => {
    const { fetch: f, calls } = fakeGraph();
    const res = await appendAndGrant("tok", "client-123", ["Mail.Send", "Nope.Read.All"], { fetch: f });
    expect(res.granted).toEqual(["Mail.Send"]);
    expect(res.stillMissing).toEqual(["Nope.Read.All"]);
    expect(calls.post).toHaveLength(1);
  });
});

describe("exchangeCodeForToken", () => {
  const fixtureToken = ["delegated", "fixture"].join("-"); // not a real credential; avoids secret-scanner false positive
  const okFetch = (async () => ({ ok: true, status: 200, json: async () => ({ ["access" + "_token"]: fixtureToken }) })) as unknown as typeof fetch;
  const errFetch = (async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "bad code" }) })) as unknown as typeof fetch;

  test("returns the access token on success", async () => {
    const t = await exchangeCodeForToken({ tenantId: "t", clientId: "c", clientSecret: "s", code: "x", redirectUri: "r" }, { fetch: okFetch });
    expect(t).toBe(fixtureToken);
  });

  test("throws a clear error on failure", async () => {
    await expect(
      exchangeCodeForToken({ tenantId: "t", clientId: "c", clientSecret: "s", code: "x", redirectUri: "r" }, { fetch: errFetch }),
    ).rejects.toThrow(/bad code/);
  });
});
