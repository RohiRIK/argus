import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const MASTER = "d".repeat(64);
const dir = mkdtempSync(join(tmpdir(), "argus-sessions-"));
const prev = { key: process.env.ARGUS_MASTER_KEY, db: process.env.ARGUS_DB_PATH, mode: process.env.ARGUS_AUTH_MODE };
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = MASTER;
delete process.env.ARGUS_AUTH_MODE;

const { runMigrations } = await import("../src/db/migrate");
const { closeDb, getRawDb } = await import("../src/db/client");
const { usersDao } = await import("../src/db/dao/users");
const { auditDao } = await import("../src/db/dao/audit");
const { SESSION_COOKIE, SESSION_TTL_MS, createSessionToken, readSession, deriveAccessKey } = await import(
  "../src/lib/auth/access"
);
const accounts = await import("../src/services/auth/accounts");
const users = await import("../src/services/auth/users");
const { sessionCutoff } = await import("../src/services/auth/identity");
const { proxy } = await import("../src/proxy");
const passwordRoute = await import("../src/app/api/auth/password/route");
const revokeSelfRoute = await import("../src/app/api/auth/sessions/revoke/route");
const revokeUserRoute = await import("../src/app/api/users/[id]/sessions/revoke/route");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of [["ARGUS_MASTER_KEY", prev.key], ["ARGUS_DB_PATH", prev.db], ["ARGUS_AUTH_MODE", prev.mode]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(() => {
  getRawDb().run("DELETE FROM users");
  accounts.resetAuthState();
});

const PW = "correct horse battery";
const HOUR = 60 * 60_000;

/** A password user whose account was created an hour ago (so earlier sessions are plausible). */
async function seasoned(username: string, role: "admin" | "operator" | "viewer" = "admin") {
  const u = usersDao.create(username, await accounts.hashPassword(PW), { role });
  getRawDb().run("UPDATE users SET created_at = ? WHERE id = ?", [new Date(Date.now() - HOUR).toISOString(), u.id]);
  return usersDao.findById(u.id)!;
}

/** A session issued `agoMs` ago. */
async function sessionToken(username: string, agoMs = 10 * 60_000) {
  return (await createSessionToken(MASTER, username, Date.now() - agoMs)).token;
}

function viaProxy(token: string, url = "/api/jobs") {
  return proxy(new NextRequest(`http://localhost:8100${url}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
}
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

/** The session token set by a route response. */
function issuedCookie(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return decodeURIComponent(raw.split(";")[0]!.split("=")[1] ?? "");
}

function routeReq(url: string, username: string, body?: unknown) {
  return new Request(`http://localhost:8100${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-argus-user": username },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("session tokens", () => {
  test("readSession reports when the session was issued", async () => {
    const now = Date.now() - 5000;
    const { token, expiresAt } = await createSessionToken(MASTER, "alice", now);
    expect(await readSession(MASTER, token)).toEqual({ username: "alice", issuedAt: now });
    expect(expiresAt - SESSION_TTL_MS).toBe(now);
    expect(await readSession(MASTER, `${token}x`)).toBeNull();
  });

  test("cutoff is the later of account creation and the last revocation", () => {
    expect(sessionCutoff({ createdAt: "2026-01-01T00:00:00.000Z", sessionsRevokedAt: null })).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(
      sessionCutoff({ createdAt: "2026-01-01T00:00:00.000Z", sessionsRevokedAt: "2026-02-01T00:00:00.000Z" }),
    ).toBe(Date.parse("2026-02-01T00:00:00.000Z"));
  });
});

describe("proxy rejects revoked sessions", () => {
  test("a session from before the account existed does not work (removed and re-added username)", async () => {
    const old = await sessionToken("reuse");
    usersDao.create("reuse", await accounts.hashPassword(PW), { role: "admin" });
    const api = await viaProxy(old);
    expect(api.status).toBe(401);
    const page = await viaProxy(old, "/dashboard");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
    expect(page.headers.get("set-cookie") ?? "").toContain(`${SESSION_COOKIE}=;`);
  });

  test("sessions issued after the revocation keep working", async () => {
    const u = await seasoned("bob");
    usersDao.revokeSessions(u.id, new Date(Date.now() - 60_000).toISOString());
    expect(passes(await viaProxy(await sessionToken("bob", 5 * 60_000)))).toBe(false);
    expect(passes(await viaProxy(await sessionToken("bob", 0)))).toBe(true);
  });

  test("the machine access key is never revoked", async () => {
    const key = await deriveAccessKey(MASTER);
    const res = await proxy(new NextRequest("http://localhost:8100/api/jobs", { headers: { authorization: `Bearer ${key}` } }));
    expect(passes(res)).toBe(true);
  });
});

describe("changing your password", () => {
  test("signs out other sessions and keeps this browser signed in", async () => {
    await seasoned("carol");
    const otherDevice = await sessionToken("carol");
    expect(passes(await viaProxy(otherDevice))).toBe(true);

    const res = await passwordRoute.POST(
      routeReq("/api/auth/password", "carol", { currentPassword: PW, newPassword: "a brand new passphrase" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.otherSessionsSignedOut).toBe(true);

    expect((await viaProxy(otherDevice)).status).toBe(401);
    const fresh = issuedCookie(res);
    expect(fresh).not.toBe("");
    expect(passes(await viaProxy(fresh))).toBe(true);
  });

  test("a wrong current password revokes nothing", async () => {
    const u = await seasoned("dave");
    const res = await passwordRoute.POST(
      routeReq("/api/auth/password", "dave", { currentPassword: "not my password", newPassword: "a brand new passphrase" }),
    );
    expect(res.status).toBe(401);
    expect(usersDao.findById(u.id)!.sessionsRevokedAt).toBeNull();
    expect(passes(await viaProxy(await sessionToken("dave")))).toBe(true);
  });
});

describe("sign out other sessions (self)", () => {
  test("ends other sessions, re-issues this one, and is audited", async () => {
    await seasoned("erin", "viewer");
    const otherDevice = await sessionToken("erin");
    const res = await revokeSelfRoute.POST(routeReq("/api/auth/sessions/revoke", "erin"));
    expect(res.status).toBe(200);
    expect((await viaProxy(otherDevice)).status).toBe(401);
    expect(passes(await viaProxy(issuedCookie(res)))).toBe(true);
    expect(auditDao.list().some((a) => a.action === "auth.sessions_revoked")).toBe(true);
  });

  test("is open to every role and refused for the access key", async () => {
    await seasoned("vic", "viewer");
    const viaGate = await viaProxy(await sessionToken("vic"), "/api/auth/sessions/revoke");
    expect(passes(viaGate)).toBe(true);
    expect((await revokeSelfRoute.POST(routeReq("/api/auth/sessions/revoke", "api-key"))).status).toBe(401);
  });
});

describe("admin actions", () => {
  test("Sign out everywhere ends the user's sessions (admin only)", async () => {
    await seasoned("admin");
    const target = await seasoned("frank", "operator");
    const token = await sessionToken("frank");

    const forbidden = await proxy(
      new NextRequest(`http://localhost:8100/api/users/${target.id}/sessions/revoke`, {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    expect(forbidden.status).toBe(403);

    const res = await revokeUserRoute.POST(routeReq(`/api/users/${target.id}/sessions/revoke`, "admin"), {
      params: Promise.resolve({ id: target.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.sessionsRevokedAt).not.toBeNull();
    expect(body.data.passwordHash).toBeUndefined();
    expect((await viaProxy(token)).status).toBe(401);
    expect(auditDao.list().some((a) => a.action === "user.sessions_revoked")).toBe(true);
  });

  test("unknown user → 404", async () => {
    const res = await revokeUserRoute.POST(routeReq("/api/users/nope/sessions/revoke", "admin"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  test("resetting a password signs the user out", async () => {
    const u = await seasoned("gina@contoso.com", "viewer");
    const token = await sessionToken("gina@contoso.com");
    await users.resetUserPassword(u.id, "admin", "http://localhost:8100");
    expect((await viaProxy(token)).status).toBe(401);
  });

  test("disabling and re-enabling does not revive old sessions", async () => {
    await seasoned("admin");
    const u = await seasoned("hank", "operator");
    const token = await sessionToken("hank");
    users.updateUser(u.id, { disabled: true }, "admin");
    users.updateUser(u.id, { disabled: false }, "admin");
    expect((await viaProxy(token)).status).toBe(401);
    expect(passes(await viaProxy(await sessionToken("hank", 0)))).toBe(true);
  });

  test("host recovery (auth:reset-password) signs the user out", async () => {
    await seasoned("ivy");
    const token = await sessionToken("ivy");
    await accounts.resetPassword("ivy", "recovered password!");
    expect((await viaProxy(token)).status).toBe(401);
  });
});
