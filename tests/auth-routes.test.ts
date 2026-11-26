import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const MASTER = "c".repeat(64);
const prevMaster = process.env.ARGUS_MASTER_KEY;
const prevMode = process.env.ARGUS_AUTH_MODE;

const loginRoute = await import("../src/app/api/auth/login/route");
const logoutRoute = await import("../src/app/api/auth/logout/route");
const { deriveAccessKey, verifySessionToken, SESSION_COOKIE } = await import("../src/lib/auth/access");

function loginReq(body: unknown, url = "http://localhost:8100/api/auth/login", headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  process.env.ARGUS_MASTER_KEY = MASTER;
  delete process.env.ARGUS_AUTH_MODE;
});

afterAll(() => {
  if (prevMaster === undefined) delete process.env.ARGUS_MASTER_KEY;
  else process.env.ARGUS_MASTER_KEY = prevMaster;
  if (prevMode === undefined) delete process.env.ARGUS_AUTH_MODE;
  else process.env.ARGUS_AUTH_MODE = prevMode;
});

describe("POST /api/auth/login", () => {
  test("sets an HttpOnly session cookie for the right key", async () => {
    const res = await loginRoute.POST(loginReq({ accessKey: await deriveAccessKey(MASTER) }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie.toLowerCase()).not.toContain("secure");
    const token = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
    expect(await verifySessionToken(MASTER, token)).toBe(true);
  });

  test("marks the cookie Secure behind an HTTPS proxy", async () => {
    const res = await loginRoute.POST(
      loginReq({ accessKey: await deriveAccessKey(MASTER) }, undefined, {
        "x-forwarded-host": "argus.example.com",
        "x-forwarded-proto": "https",
      }),
    );
    expect((res.headers.get("set-cookie") ?? "").toLowerCase()).toContain("secure");
  });

  test("rejects a wrong key with 401 and no cookie", async () => {
    const res = await loginRoute.POST(loginReq({ accessKey: "argus_nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = await res.json();
    expect(body.error.code).toBe("UnauthorizedError");
    expect(JSON.stringify(body)).not.toContain(MASTER);
  });

  test("rejects a missing key with 400", async () => {
    const res = await loginRoute.POST(loginReq({}));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/logout", () => {
  test("expires the session cookie", async () => {
    const res = await logoutRoute.POST();
    const cookie = (res.headers.get("set-cookie") ?? "").toLowerCase();
    expect(cookie).toContain(`${SESSION_COOKIE}=;`);
    expect(cookie).toContain("max-age=0");
  });
});
