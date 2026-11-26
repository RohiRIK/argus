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
const { settingsDao } = await import("../src/db/dao/settings");
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

  test("admins set Microsoft users' roles too; they have no password to reset", async () => {
    await local("ada", "admin");
    const mia = usersDao.create("mia@contoso.com", "", { role: "viewer", authSource: "entra", entraOid: "oid-mia" });
    expect(users.updateUser(mia.id, { role: "operator" }, "ada").role).toBe("operator");
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

  test("only invited people can sign in; first sign-in accepts the invitation", async () => {
    const claims = { oid: "oid-9", tid: T, username: "mia@contoso.com", name: "Mia Wong", email: "mia@contoso.com" };
    expect(() => entra.acceptEntraSignIn(claims)).toThrow(/haven't been invited/);

    const invited = usersDao.create("mia@contoso.com", "", {
      role: "operator",
      authSource: "entra",
      entraOid: "oid-9",
      invitedAt: new Date().toISOString(),
    });
    const accepted = entra.acceptEntraSignIn(claims);
    expect(accepted).toMatchObject({ id: invited.id, role: "operator", displayName: "Mia Wong" });
    expect(usersDao.findById(invited.id)!.lastLoginAt).not.toBeNull();
    expect(auditDao.list(5).some((a) => a.action === "user.invite_accepted")).toBe(true);

    usersDao.update(invited.id, { disabledAt: new Date().toISOString() });
    expect(() => entra.acceptEntraSignIn(claims)).toThrow(/disabled/);
  });

  test("invite from Entra ID creates the account and emails the invitation", async () => {
    await local("ada", "admin");
    settingsDao.update({ fromAddress: "argus@contoso.com", organizationDisplayName: "Contoso" });
    const sent: Array<{ from: string; to: string[]; subject: string; html: string }> = [];
    const deps = {
      fetchEntraUser: async (id: string) => ({ id, displayName: "Noa <Admin>", email: "noa@contoso.com", userPrincipalName: "Noa@contoso.com" }),
      transport: { send: async (m: (typeof sent)[number]) => void sent.push(m) },
    };
    const id = "33333333-3333-3333-3333-333333333333";
    const res = await users.inviteEntraUser({ entraId: id, role: "viewer", sendEmail: true }, "ada", "https://argus.example", deps);
    expect(res.emailSent).toBe(true);
    expect(res.user).toMatchObject({ username: "noa@contoso.com", authSource: "entra", entraOid: id, role: "viewer" });
    expect(res.user.invitedAt).not.toBeNull();
    expect(sent[0]).toMatchObject({ from: "argus@contoso.com", to: ["noa@contoso.com"], subject: "You're invited to Argus for Contoso" });
    expect(sent[0]!.html).toContain("https://argus.example/login");
    expect(sent[0]!.html).toContain("Noa &lt;Admin&gt;");
    expect(sent[0]!.html).not.toContain("<Admin>");

    await expect(users.inviteEntraUser({ entraId: id, role: "viewer", sendEmail: true }, "ada", "o", deps)).rejects.toThrow(/already in Argus/);

    // Pending invitation can be resent; once accepted it can't.
    expect((await users.resendInvite(res.user.id, "ada", "https://argus.example", deps)).emailSent).toBe(true);
    usersDao.touchLogin(res.user.id);
    await expect(users.resendInvite(res.user.id, "ada", "o", deps)).rejects.toThrow(/haven't accepted/);
  });

  test("invite still creates the account when there is no sender mailbox", async () => {
    await local("ada", "admin");
    settingsDao.update({ fromAddress: null });
    const deps = {
      fetchEntraUser: async (id: string) => ({ id, displayName: "Lior", email: "lior@contoso.com", userPrincipalName: "lior@contoso.com" }),
      transport: { send: async () => undefined },
    };
    const res = await users.inviteEntraUser(
      { entraId: "44444444-4444-4444-4444-444444444444", role: "operator", sendEmail: true },
      "ada",
      "o",
      deps,
    );
    expect(res.emailSent).toBe(false);
    expect(res.emailError).toMatch(/sender mailbox/);
    expect(usersDao.findByEntraOid("44444444-4444-4444-4444-444444444444")).toBeDefined();
  });

  test("a pending Microsoft admin doesn't count as the active admin", async () => {
    const ada = await local("ada", "admin");
    usersDao.create("pending@contoso.com", "", { role: "admin", authSource: "entra", entraOid: "oid-p", invitedAt: new Date().toISOString() });
    expect(() => users.updateUser(ada.id, { role: "viewer" }, "x")).toThrow(/at least one active admin/);
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
