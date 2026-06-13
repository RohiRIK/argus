import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-graph-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { acquireToken, clearTokenCache } = await import("../src/services/graph/auth");
const { GraphAuthError, GraphApiError } = await import("../src/lib/errors");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

const creds = { tenantId: "t", clientId: "c", clientSecret: "s" };
const noSleep = async () => {};

function tokenResponse(token: string) {
  return new Response(JSON.stringify({ access_token: token, expires_in: 3600 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => clearTokenCache());

describe("acquireToken (AC-5)", () => {
  test("acquires a token via client-credentials", async () => {
    let calls = 0;
    const token = await acquireToken({
      creds,
      fetchImpl: async () => {
        calls++;
        return tokenResponse("tok-1");
      },
    });
    expect(token).toBe("tok-1");
    expect(calls).toBe(1);
  });

  test("caches the token across calls", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return tokenResponse("cached");
    };
    await acquireToken({ creds, fetchImpl });
    await acquireToken({ creds, fetchImpl });
    expect(calls).toBe(1); // second call served from cache
  });

  test("forceRefresh bypasses the cache", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return tokenResponse(`tok-${calls}`);
    };
    await acquireToken({ creds, fetchImpl });
    const second = await acquireToken({ creds, fetchImpl, forceRefresh: true });
    expect(calls).toBe(2);
    expect(second).toBe("tok-2");
  });

  test("retries on 5xx then fails after 3 attempts", async () => {
    let calls = 0;
    await expect(
      acquireToken({
        creds,
        sleep: noSleep,
        fetchImpl: async () => {
          calls++;
          return new Response("err", { status: 503 });
        },
      }),
    ).rejects.toBeInstanceOf(GraphApiError);
    expect(calls).toBe(3);
  });

  test("does not retry on 400 (bad request)", async () => {
    let calls = 0;
    await expect(
      acquireToken({
        creds,
        sleep: noSleep,
        fetchImpl: async () => {
          calls++;
          return new Response("bad", { status: 400 });
        },
      }),
    ).rejects.toBeInstanceOf(GraphApiError);
    expect(calls).toBe(1);
  });

  test("throws GraphAuthError when vault has no credentials", async () => {
    await expect(acquireToken({ fetchImpl: async () => tokenResponse("x") })).rejects.toBeInstanceOf(
      GraphAuthError,
    );
  });
});
