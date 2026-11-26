import { describe, test, expect } from "bun:test";
import { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  authMode,
  createSessionToken,
  deriveAccessKey,
  isAuthenticated,
  isPublicPath,
  safeNextPath,
  verifyAccessKey,
  verifySessionToken,
} from "../src/lib/auth/access";

const MASTER = "a".repeat(64);
const OTHER = "b".repeat(64);
const env = { ARGUS_MASTER_KEY: MASTER } as Record<string, string | undefined>;

describe("access key", () => {
  test("is deterministic per master key and prefixed", async () => {
    const k1 = await deriveAccessKey(MASTER);
    expect(k1).toBe(await deriveAccessKey(MASTER));
    expect(k1.startsWith("argus_")).toBe(true);
    expect(k1.length).toBe("argus_".length + 43);
    expect(k1).not.toBe(await deriveAccessKey(OTHER));
    expect(k1).not.toContain(MASTER);
  });

  test("verifies only the matching key", async () => {
    const k = await deriveAccessKey(MASTER);
    expect(await verifyAccessKey(MASTER, k)).toBe(true);
    expect(await verifyAccessKey(MASTER, ` ${k}\n`)).toBe(true);
    expect(await verifyAccessKey(MASTER, k.slice(0, -1) + "x")).toBe(false);
    expect(await verifyAccessKey(MASTER, await deriveAccessKey(OTHER))).toBe(false);
    expect(await verifyAccessKey(MASTER, "")).toBe(false);
  });

  test("rejects a malformed master key", async () => {
    expect(deriveAccessKey("short")).rejects.toThrow();
  });
});

describe("session token", () => {
  test("round-trips and expires", async () => {
    const now = 1_700_000_000_000;
    const { token, expiresAt } = await createSessionToken(MASTER, now);
    expect(expiresAt).toBe(now + SESSION_TTL_MS);
    expect(await verifySessionToken(MASTER, token, now + 1000)).toBe(true);
    expect(await verifySessionToken(MASTER, token, expiresAt)).toBe(false);
    expect(await verifySessionToken(OTHER, token, now)).toBe(false);
  });

  test("rejects tampering", async () => {
    const now = Date.now();
    const { token } = await createSessionToken(MASTER, now);
    const [v, exp, sig] = token.split(".");
    const extended = `${v}.${Number(exp) + SESSION_TTL_MS}.${sig}`;
    expect(await verifySessionToken(MASTER, extended, now)).toBe(false);
    expect(await verifySessionToken(MASTER, `v2.${exp}.${sig}`, now)).toBe(false);
    expect(await verifySessionToken(MASTER, "garbage", now)).toBe(false);
    expect(await verifySessionToken(MASTER, undefined, now)).toBe(false);
  });
});

describe("isAuthenticated", () => {
  test("accepts a session cookie or a bearer access key", async () => {
    const { token } = await createSessionToken(MASTER);
    const cookieReq = new Request("http://x/api/jobs", {
      headers: { cookie: `theme=dark; ${SESSION_COOKIE}=${token}` },
    });
    expect(await isAuthenticated(cookieReq, env)).toBe(true);

    const bearer = new Request("http://x/api/jobs", {
      headers: { authorization: `Bearer ${await deriveAccessKey(MASTER)}` },
    });
    expect(await isAuthenticated(bearer, env)).toBe(true);
  });

  test("denies anonymous, wrong keys, and a missing master key", async () => {
    expect(await isAuthenticated(new Request("http://x/"), env)).toBe(false);
    const wrong = new Request("http://x/", {
      headers: { authorization: `Bearer ${await deriveAccessKey(OTHER)}` },
    });
    expect(await isAuthenticated(wrong, env)).toBe(false);
    const { token } = await createSessionToken(MASTER);
    const req = new Request("http://x/", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(await isAuthenticated(req, {})).toBe(false);
  });

  test("ARGUS_AUTH_MODE=off allows everything; anything else keeps the gate on", async () => {
    expect(authMode({ ARGUS_AUTH_MODE: "off" })).toBe("off");
    expect(authMode({})).toBe("access-key");
    expect(authMode({ ARGUS_AUTH_MODE: "OFF" })).toBe("access-key");
    expect(await isAuthenticated(new Request("http://x/"), { ARGUS_AUTH_MODE: "off" })).toBe(true);
  });
});

describe("paths", () => {
  test("public paths are only login, health and static assets", () => {
    for (const p of ["/login", "/api/health", "/api/auth/login", "/api/auth/logout", "/_next/static/x.js"]) {
      expect(isPublicPath(p)).toBe(true);
    }
    for (const p of ["/", "/dashboard", "/api/jobs", "/api/vault", "/api/healthz", "/login/x", "/api/backup"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  test("safeNextPath blocks open redirects", () => {
    expect(safeNextPath("/jobs/1?x=2")).toBe("/jobs/1?x=2");
    for (const bad of [null, "", "https://evil.test", "//evil.test", "/\\evil.test", "/login", "/api/vault"]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});

describe("proxy", () => {
  test("401 for anonymous API, redirect for pages, pass-through when signed in", async () => {
    const prev = { ...process.env };
    process.env.ARGUS_MASTER_KEY = MASTER;
    delete process.env.ARGUS_AUTH_MODE;
    try {
      const { proxy } = await import("../src/proxy");
      const api = await proxy(new NextRequest("http://localhost:8100/api/jobs"));
      expect(api.status).toBe(401);
      expect((await api.json()).error.code).toBe("UnauthorizedError");

      const page = await proxy(new NextRequest("http://localhost:8100/jobs/abc?tab=runs"));
      expect(page.status).toBe(307);
      const loc = new URL(page.headers.get("location") ?? "");
      expect(loc.pathname).toBe("/login");
      expect(loc.searchParams.get("next")).toBe("/jobs/abc?tab=runs");

      const health = await proxy(new NextRequest("http://localhost:8100/api/health"));
      expect(health.headers.get("x-middleware-next")).toBe("1");

      const { token } = await createSessionToken(MASTER);
      const signedIn = await proxy(
        new NextRequest("http://localhost:8100/api/jobs", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
      );
      expect(signedIn.headers.get("x-middleware-next")).toBe("1");
    } finally {
      process.env = prev;
    }
  });
});
