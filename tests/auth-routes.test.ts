import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MASTER = "c".repeat(64);
const dir = mkdtempSync(join(tmpdir(), "argus-auth-"));
const prev = { key: process.env.ARGUS_MASTER_KEY, db: process.env.ARGUS_DB_PATH, mode: process.env.ARGUS_AUTH_MODE };
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = MASTER;
delete process.env.ARGUS_AUTH_MODE;

const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
const { usersDao } = await import("../src/db/dao/users");
const { auditDao } = await import("../src/db/dao/audit");
const accounts = await import("../src/services/auth/accounts");
const setupRoute = await import("../src/app/api/auth/setup/route");
const loginRoute = await import("../src/app/api/auth/login/route");
const logoutRoute = await import("../src/app/api/auth/logout/route");
const passwordRoute = await import("../src/app/api/auth/password/route");
const meRoute = await import("../src/app/api/auth/me/route");
const { readSessionToken, SESSION_COOKIE } = await import("../src/lib/auth/access");

beforeAll(() => {
  runMigrations();
  accounts.resetAuthState();
});
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of [["ARGUS_MASTER_KEY", prev.key], ["ARGUS_DB_PATH", prev.db], ["ARGUS_AUTH_MODE", prev.mode]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:8100${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const cookieUser = async (res: Response) => {
  const raw = res.headers.get("set-cookie") ?? "";
  const token = decodeURIComponent(raw.split(";")[0]!.split("=")[1] ?? "");
  return readSessionToken(MASTER, token);
};

describe("first-run setup", () => {
  test("reports that setup is needed and open", async () => {
    const b = await (await setupRoute.GET()).json();
    expect(b.data).toEqual({ needsSetup: true, setupOpen: true, minPasswordLength: 10 });
  });

  test("rejects a short password and a bad username", async () => {
    expect((await setupRoute.POST(post("/api/auth/setup", { username: "admin", password: "short" }))).status).toBe(400);
    expect((await setupRoute.POST(post("/api/auth/setup", { username: "a b", password: "long-enough-pw" }))).status).toBe(400);
    expect(usersDao.count()).toBe(0);
  });

  test("closes after the setup window", async () => {
    accounts.resetAuthState(Date.now() - accounts.SETUP_WINDOW_MS - 1000);
    const res = await setupRoute.POST(post("/api/auth/setup", { username: "admin", password: "correct horse battery" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/timed out/);
    accounts.resetAuthState();
  });

  test("creates the admin (argon2id, lowercased) and signs it in", async () => {
    const res = await setupRoute.POST(post("/api/auth/setup", { username: "Admin", password: "correct horse battery" }));
    expect(res.status).toBe(200);
    expect(await cookieUser(res)).toBe("admin");
    const u = usersDao.findByUsername("admin")!;
    expect(u.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(u.passwordHash).not.toContain("correct horse");
  });

  test("cannot run twice", async () => {
    const res = await setupRoute.POST(post("/api/auth/setup", { username: "eve", password: "another password" }));
    expect(res.status).toBe(409);
    expect((await (await setupRoute.GET()).json()).data.needsSetup).toBe(false);
  });
});

describe("sign-in", () => {
  test("right password → HttpOnly session for that user; case-insensitive username", async () => {
    const res = await loginRoute.POST(post("/api/auth/login", { username: "ADMIN", password: "correct horse battery" }));
    expect(res.status).toBe(200);
    const cookie = (res.headers.get("set-cookie") ?? "").toLowerCase();
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("httponly");
    expect(cookie).toContain("samesite=lax");
    expect(cookie).not.toContain("secure");
    expect(await cookieUser(res)).toBe("admin");
    expect(usersDao.findByUsername("admin")!.lastLoginAt).not.toBeNull();
  });

  test("Secure cookie behind HTTPS", async () => {
    const res = await loginRoute.POST(
      post("/api/auth/login", { username: "admin", password: "correct horse battery" }, { "x-forwarded-proto": "https", "x-forwarded-host": "argus.lan" }),
    );
    expect((res.headers.get("set-cookie") ?? "").toLowerCase()).toContain("secure");
  });

  test("wrong password and unknown user get the same 401, no cookie, and are audited", async () => {
    const a = await loginRoute.POST(post("/api/auth/login", { username: "admin", password: "nope-nope-nope" }));
    const b = await loginRoute.POST(post("/api/auth/login", { username: "ghost", password: "nope-nope-nope" }));
    for (const r of [a, b]) {
      expect(r.status).toBe(401);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    expect((await a.json()).error.message).toBe((await b.json()).error.message);
    expect(auditDao.list().some((x) => x.action === "auth.login" && x.outcome === "error")).toBe(true);
  });

  test("locks a username after 5 failures, even for the right password", async () => {
    accounts.resetAuthState();
    for (let i = 0; i < 5; i++) await loginRoute.POST(post("/api/auth/login", { username: "admin", password: "wrong-password!" }));
    const locked = await loginRoute.POST(post("/api/auth/login", { username: "admin", password: "correct horse battery" }));
    expect(locked.status).toBe(401);
    expect((await locked.json()).error.message).toMatch(/Too many failed attempts/);
    accounts.resetAuthState();
  });
});

describe("account management", () => {
  test("me returns the proxy-provided identity", async () => {
    const b = await (await meRoute.GET(new Request("http://x", { headers: { "x-argus-user": "admin" } }))).json();
    expect(b.data.username).toBe("admin");
  });

  test("change password needs the current one; then only the new one works", async () => {
    const asAdmin = { "x-argus-user": "admin" };
    const bad = await passwordRoute.POST(post("/api/auth/password", { currentPassword: "wrong-password!", newPassword: "brand new password" }, asAdmin));
    expect(bad.status).toBe(401);
    const short = await passwordRoute.POST(post("/api/auth/password", { currentPassword: "correct horse battery", newPassword: "short" }, asAdmin));
    expect(short.status).toBe(400);
    const okRes = await passwordRoute.POST(post("/api/auth/password", { currentPassword: "correct horse battery", newPassword: "brand new password" }, asAdmin));
    expect(okRes.status).toBe(200);
    expect((await loginRoute.POST(post("/api/auth/login", { username: "admin", password: "correct horse battery" }))).status).toBe(401);
    expect((await loginRoute.POST(post("/api/auth/login", { username: "admin", password: "brand new password" }))).status).toBe(200);
  });

  test("the machine key identity cannot change a password", async () => {
    const res = await passwordRoute.POST(post("/api/auth/password", { currentPassword: "x", newPassword: "y".repeat(12) }, { "x-argus-user": "api-key" }));
    expect(res.status).toBe(401);
  });

  test("host reset creates or updates an account", async () => {
    expect(await accounts.resetPassword("ops", "recovered password 1")).toEqual({ created: true });
    expect(await accounts.resetPassword("admin", "recovered password 2")).toEqual({ created: false });
    expect((await loginRoute.POST(post("/api/auth/login", { username: "admin", password: "recovered password 2" }))).status).toBe(200);
  });

  test("logout expires the cookie", async () => {
    const cookie = ((await logoutRoute.POST()).headers.get("set-cookie") ?? "").toLowerCase();
    expect(cookie).toContain(`${SESSION_COOKIE}=;`);
    expect(cookie).toContain("max-age=0");
  });
});
