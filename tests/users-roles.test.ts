import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const MASTER = "a".repeat(64);
const dir = mkdtempSync(join(tmpdir(), "argus-roles-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = MASTER;
delete process.env.ARGUS_AUTH_MODE;

const { runMigrations } = await import("../src/db/migrate");
const { closeDb, getRawDb } = await import("../src/db/client");
const { usersDao } = await import("../src/db/dao/users");
const { auditDao } = await import("../src/db/dao/audit");
const { requiredRole, hasRole, highestRole } = await import("../src/lib/auth/roles");
const { SESSION_COOKIE, createSessionToken } = await import("../src/lib/auth/access");
const users = await import("../src/services/auth/users");
const accounts = await import("../src/services/auth/accounts");
const { requireRole } = await import("../src/services/auth/identity");
const entra = await import("../src/services/auth/entra");
const { proxy } = await import("../src/proxy");
const usersRoute = await import("../src/app/api/users/route");
const { formatEvent } = await import("../src/db/dao/activity-logs");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  getRawDb().run("DELETE FROM users");
  accounts.resetAuthState();
});

const PW = "correct horse battery";

async function local(username: string, role: "admin" | "operator" | "viewer") {
  return usersDao.create(username, await accounts.hashPassword(PW), { role });
}

async function asUser(username: string, url: string, method = "GET", extraHeaders: Record<string, string> = {}) {
  const { token } = await createSessionToken(MASTER, username);
  return proxy(new NextRequest(`http://localhost:8100${url}`, { method, headers: { cookie: `${SESSION_COOKIE}=${token}`, ...extraHeaders } }));
}

describe("role policy table", () => {
  test("reads need viewer, writes operator, secrets and users admin", () => {
    expect(requiredRole("GET", "/api/jobs")).toBe("viewer");
    expect(requiredRole("POST", "/api/jobs")).toBe("operator");
    expect(requiredRole("PUT", "/api/automations/x")).toBe("operator");
    expect(requiredRole("GET", "/api/users")).toBe("admin");
    expect(requiredRole("GET", "/api/vault")).toBe("admin");
    expect(requiredRole("GET", "/api/backup")).toBe("admin");
    expect(requiredRole("GET", "/api/integrations/microsoft365/authorize")).toBe("admin");
    expect(requiredRole("GET", "/api/integrations/microsoft365/consent-url")).toBe("admin");
    expect(requiredRole("GET", "/api/integrations")).toBe("viewer");
    expect(requiredRole("PUT", "/api/settings")).toBe("admin");
    expect(requiredRole("POST", "/api/automations/actions/a1/rollback")).toBe("admin");
    expect(requiredRole("POST", "/api/recipient-groups")).toBe("admin");
    expect(requiredRole("POST", "/api/auth/password")).toBe("viewer");
    expect(requiredRole("POST", "/api/templates/preview")).toBe("viewer");
  });

  test("rank helpers", () => {
    expect(hasRole("admin", "operator")).toBe(true);
    expect(hasRole("viewer", "operator")).toBe(false);
    expect(highestRole(["viewer", "admin", "operator"])).toBe("admin");
    expect(highestRole([])).toBeNull();
  });
});

describe("proxy role enforcement", () => {
  test("viewer reads, but writes get 403 with a clear message", async () => {
    await local("vera", "viewer");
    const read = await asUser("vera", "/api/jobs");
    expect(read.headers.get("x-middleware-next")).toBe("1");
    expect(read.headers.get("x-middleware-request-x-argus-role")).toBe("viewer");
    const write = await asUser("vera", "/api/jobs", "POST");
    expect(write.status).toBe(403);
    const body = await write.json();
    expect(body.error.code).toBe("ForbiddenError");
    expect(body.error.message).toContain("Viewer");
  });

  test("operator writes jobs but cannot touch secrets or users", async () => {
    await local("otto", "operator");
    expect((await asUser("otto", "/api/jobs", "POST")).headers.get("x-middleware-next")).toBe("1");
    expect((await asUser("otto", "/api/vault", "PUT")).status).toBe(403);
    expect((await asUser("otto", "/api/users")).status).toBe(403);
  });

  test("admin passes; client-sent identity/role headers are replaced", async () => {
    await local("ada", "admin");
    const res = await asUser("ada", "/api/users", "GET", { "x-argus-user": "spoofed", "x-argus-role": "viewer" });
    expect(res.headers.get("x-middleware-request-x-argus-user")).toBe("ada");
    expect(res.headers.get("x-middleware-request-x-argus-role")).toBe("admin");
  });

  test("disabled or deleted accounts are signed out at once", async () => {
    const u = await local("dina", "operator");
    usersDao.update(u.id, { disabledAt: new Date().toISOString() });
    expect((await asUser("dina", "/api/jobs")).status).toBe(401);
    const page = await asUser("dina", "/dashboard");
    expect(page.status).toBe(307);
    expect(page.headers.get("set-cookie") ?? "").toContain(`${SESSION_COOKIE}=;`);
    expect((await asUser("ghost", "/api/jobs")).status).toBe(401);
  });

  test("anonymous: 401 for API, redirect for pages, health and sign-in stay public", async () => {
    expect((await proxy(new NextRequest("http://localhost:8100/api/jobs"))).status).toBe(401);
    const page = await proxy(new NextRequest("http://localhost:8100/jobs/abc?tab=runs"));
    expect(new URL(page.headers.get("location") ?? "").searchParams.get("next")).toBe("/jobs/abc?tab=runs");
    for (const p of ["/api/health", "/api/auth/providers", "/api/auth/microsoft/start", "/api/auth/microsoft/callback"]) {
      expect((await proxy(new NextRequest(`http://localhost:8100${p}`))).headers.get("x-middleware-next")).toBe("1");
    }
  });
});

describe("user management", () => {
  test("create, change role, reset password; every change is audited", async () => {
    await local("ada", "admin");
    const dana = await users.createLocalUser({ username: "Dana", password: PW, role: "viewer" }, "ada");
    expect(dana.username).toBe("dana");
    expect("passwordHash" in dana).toBe(false);
    expect(users.updateUser(dana.id, { role: "operator" }, "ada").role).toBe("operator");
    await users.resetUserPassword(dana.id, "a brand new password", "ada");
    expect((await accounts.verifyLogin("dana", "a brand new password")).role).toBe("operator");
    const actions = auditDao.list(10).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["user.create", "user.role_change", "user.password_reset"]));
  });

  test("the last active admin can't be demoted, disabled or removed", async () => {
    const ada = await local("ada", "admin");
    await local("bob", "operator");
    expect(() => users.updateUser(ada.id, { role: "viewer" }, "bob")).toThrow(/at least one active admin/);
    expect(() => users.updateUser(ada.id, { disabled: true }, "bob")).toThrow(/at least one active admin/);
    expect(() => users.deleteUser(ada.id, "bob")).toThrow(/at least one active admin/);
    const second = await local("cy", "admin");
    expect(users.updateUser(ada.id, { role: "viewer" }, "cy").role).toBe("viewer");
    expect(() => users.updateUser(second.id, { disabled: true }, "bob")).toThrow(/at least one active admin/);
  });

  test("admins can't disable or remove themselves", async () => {
    const ada = await local("ada", "admin");
    await local("cy", "admin");
    expect(() => users.updateUser(ada.id, { disabled: true }, "ada")).toThrow(/your own account/);
    expect(() => users.deleteUser(ada.id, "ada")).toThrow(/your own account/);
  });

  test("duplicate usernames and short passwords are rejected", async () => {
    await local("ada", "admin");
    await expect(users.createLocalUser({ username: "ADA", password: PW, role: "viewer" }, "x")).rejects.toThrow(/already exists/);
    await expect(users.createLocalUser({ username: "eve", password: "short", role: "viewer" }, "x")).rejects.toThrow();
  });

  test("disabled and Microsoft accounts can't use password sign-in", async () => {
    const u = await local("dina", "viewer");
    usersDao.update(u.id, { disabledAt: new Date().toISOString() });
    await expect(accounts.verifyLogin("dina", PW)).rejects.toThrow(/incorrect/);
    usersDao.create("mia@contoso.com", "", { role: "viewer", authSource: "entra", entraOid: "oid-mia" });
    await expect(accounts.verifyLogin("mia@contoso.com", "")).rejects.toThrow();
  });

  test("Microsoft users' roles come from groups, not the admin screen", async () => {
    await local("ada", "admin");
    const mia = usersDao.create("mia@contoso.com", "", { role: "viewer", authSource: "entra", entraOid: "oid-mia" });
    expect(() => users.updateUser(mia.id, { role: "admin" }, "ada")).toThrow(/Entra group/);
    await expect(users.resetUserPassword(mia.id, "whatever password", "ada")).rejects.toThrow(/Microsoft/);
  });

  test("host recovery re-enables and promotes a local account", async () => {
    const u = await local("ada", "viewer");
    usersDao.update(u.id, { disabledAt: new Date().toISOString() });
    expect((await accounts.resetPassword("ada", "recovered password!")).created).toBe(false);
    const after = usersDao.findById(u.id)!;
    expect(after.role).toBe("admin");
    expect(after.disabledAt).toBeNull();
  });

  test("POST /api/users validates the role", async () => {
    const res = await usersRoute.POST(
      new Request("http://x/api/users", {
        method: "POST",
        headers: { "content-type": "application/json", "x-argus-user": "ada" },
        body: JSON.stringify({ username: "zed", password: PW, role: "superuser" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("requireRole (Enforce guard)", () => {
  const req = (role: string) => new Request("http://x", { headers: { "x-argus-role": role } });
  test("operators can't enforce, admins can", () => {
    expect(() => requireRole(req("operator"), "admin", "switch an automation to Enforce")).toThrow(/Only Admins/);
    expect(() => requireRole(req("admin"), "admin", "x")).not.toThrow();
  });
});

describe("Microsoft sign-in", () => {
  const T = "11111111-1111-1111-1111-111111111111";
  const C = "22222222-2222-2222-2222-222222222222";
  const now = Date.UTC(2026, 10, 26, 12);
  const token = (claims: Record<string, unknown>) =>
    `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
  const good = {
    iss: `https://login.microsoftonline.com/${T}/v2.0`,
    aud: C,
    tid: T,
    nonce: "n1",
    exp: now / 1000 + 600,
    oid: "oid-1",
    preferred_username: "Mia@Contoso.com",
    name: "Mia Wong",
  };

  test("ID token claims are validated", () => {
    const claims = entra.parseIdToken(token(good), { tenantId: T, clientId: C, nonce: "n1", now });
    expect(claims).toMatchObject({ oid: "oid-1", username: "mia@contoso.com", name: "Mia Wong", email: "Mia@Contoso.com" });
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ ...good, aud: "other" }, /audience/],
      [{ ...good, iss: "https://evil/v2.0" }, /issuer/],
      [{ ...good, tid: "other" }, /issuer|tenant/],
      [{ ...good, nonce: "n2" }, /nonce/],
      [{ ...good, exp: now / 1000 - 3600 }, /expired/],
      [{ ...good, oid: undefined }, /missing/],
    ];
    for (const [c, why] of bad) {
      expect(() => entra.parseIdToken(token(c), { tenantId: T, clientId: C, nonce: "n1", now })).toThrow(why);
    }
    expect(() => entra.parseIdToken("not-a-jwt", { tenantId: T, clientId: C, nonce: "n1", now })).toThrow();
  });

  test("role is the highest mapped group the user is in; none → no access", async () => {
    const cfg = {
      enabled: true,
      groups: { admin: { id: "g-admin", name: "Admins" }, operator: { id: "g-op", name: "Ops" }, viewer: { id: "g-view", name: "Viewers" } },
    };
    const fakeFetch = (member: string[]) =>
      (async (_url: string, init?: RequestInit) => {
        const asked = (JSON.parse(String(init?.body)) as { groupIds: string[] }).groupIds;
        return new Response(JSON.stringify({ value: asked.filter((g) => member.includes(g)) }), { status: 200 });
      }) as unknown as typeof fetch;
    const deps = (m: string[]) => ({ fetch: fakeFetch(m), token: async () => "t" });
    expect(await entra.roleFromGroups("oid", cfg, deps(["g-view", "g-op"]))).toBe("operator");
    expect(await entra.roleFromGroups("oid", cfg, deps(["g-admin", "g-view"]))).toBe("admin");
    expect(await entra.roleFromGroups("oid", cfg, deps([]))).toBeNull();
    expect(await entra.roleFromGroups("oid", { enabled: true, groups: {} }, deps(["g-admin"]))).toBeNull();
  });

  test("upsert creates, refreshes the role, refuses a local name clash and disabled users", async () => {
    const claims = { oid: "oid-9", tid: T, username: "mia@contoso.com", name: "Mia", email: "mia@contoso.com" };
    const created = entra.upsertEntraUser(claims, "viewer");
    expect(created).toMatchObject({ authSource: "entra", role: "viewer", entraOid: "oid-9" });
    expect(entra.upsertEntraUser(claims, "operator").role).toBe("operator");
    usersDao.update(created.id, { disabledAt: new Date().toISOString() });
    expect(() => entra.upsertEntraUser(claims, "admin")).toThrow(/disabled/);

    await local("sam@contoso.com", "viewer");
    expect(() => entra.upsertEntraUser({ ...claims, oid: "oid-10", username: "sam@contoso.com" }, "admin")).toThrow(/local Argus account/);
  });

  test("attempt cookie round-trips and rejects junk", () => {
    const a = entra.newAttempt("/catalog");
    expect(entra.decodeAttempt(entra.encodeAttempt(a))).toEqual(a);
    expect(entra.decodeAttempt("garbage")).toBeNull();
    expect(entra.decodeAttempt(undefined)).toBeNull();
  });
});

describe("user events in Activity", () => {
  test("role changes read clearly and show who did it", () => {
    expect(formatEvent("user.role_change", "info", null, JSON.stringify({ username: "dana", actor: "ada", from: "Viewer", to: "Operator" }))).toBe(
      "Role changed: dana (Viewer → Operator) by ada",
    );
    expect(formatEvent("auth.login", "info", null, JSON.stringify({ username: "mia", method: "microsoft" }))).toBe(
      "Signed in with Microsoft: mia",
    );
  });
});
