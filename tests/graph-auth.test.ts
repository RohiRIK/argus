import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-graph-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { acquireToken, clearTokenCache } = await import("../src/services/graph/auth");
const { generateSelfSignedCert } = await import("../src/services/graph/cert");
const vaultRoute = await import("../src/app/api/vault/route");
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

  test("coalesces concurrent token requests into a single HTTP call", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchImpl = async () => {
      calls++;
      await gate;
      return tokenResponse("shared-tok");
    };

    const p1 = acquireToken({ creds, fetchImpl });
    const p2 = acquireToken({ creds, fetchImpl });
    const p3 = acquireToken({ creds, fetchImpl });
    release();

    const tokens = await Promise.all([p1, p2, p3]);
    expect(tokens).toEqual(["shared-tok", "shared-tok", "shared-tok"]);
    expect(calls).toBe(1);
  });

  test("PUT /api/vault credential rotation invalidates the cached token", async () => {
    let calls = 0;
    await acquireToken({
      creds,
      fetchImpl: async () => {
        calls++;
        return tokenResponse(`tok-${calls}`);
      },
    });
    expect(calls).toBe(1);

    const putRes = await vaultRoute.PUT(
      new Request("http://t/api/vault", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientSecret: "new-secret" }),
      }),
    );
    expect(putRes.status).toBe(200);

    const rotated = await acquireToken({
      creds,
      fetchImpl: async () => {
        calls++;
        return tokenResponse(`tok-${calls}`);
      },
    });
    expect(rotated).toBe("tok-2");
    expect(calls).toBe(2);
  });

  test("acquires a token via RS256 certificate client_assertion", async () => {
    const cert = generateSelfSignedCert({ commonName: "Auth Test" });
    let capturedBody = "";
    const tok = await acquireToken({
      creds: {
        tenantId: "11111111-1111-1111-1111-111111111111",
        clientId: "22222222-2222-2222-2222-222222222222",
        privateKeyPem: cert.privateKeyPem,
        x5t: cert.x5t,
      },
      fetchImpl: async (_url, init) => {
        capturedBody = String(init?.body ?? "");
        return tokenResponse("cert-tok");
      },
    });
    expect(tok).toBe("cert-tok");
    const params = new URLSearchParams(capturedBody);
    expect(params.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    expect(params.get("client_assertion")?.split(".")).toHaveLength(3);
  });

  test("parses Entra AADSTS error description and correlation_id", async () => {
    let err: unknown;
    try {
      await acquireToken({
        creds,
        sleep: noSleep,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              error: "invalid_client",
              error_codes: [7000215],
              error_description: "AADSTS7000215: Invalid client secret provided.",
              correlation_id: "corr-7000215",
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          ),
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GraphApiError);
    expect((err as Error).message).toContain("Invalid client secret");
    expect((err as { requestId?: string }).requestId).toBe("corr-7000215");
  });
});
