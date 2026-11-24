import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-prov-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { startDeploySession, pollDeploySession } = await import("../src/services/graph/provisioner");
const { requiredScopes } = await import("../src/services/graph/connection-test");
const { vaultService } = await import("../src/services/vault/vault");
const { integrationsDao } = await import("../src/db/dao/integrations");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const APP_ID = "22222222-2222-2222-2222-222222222222";

function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function makeMockFetch(
  opts: {
    mode?: "create" | "upgrade";
    denyLogin?: boolean;
    existingMailboxes?: Array<{ displayName: string; mail: string }>;
  } = {},
) {
  const scopes = requiredScopes();
  const appRoles = scopes.map((value, i) => ({ id: `role-${i}`, value }));
  let tokenPolls = 0;
  let patchedApp = false;
  let createdApp = false;
  let grantedCount = 0;
  let createdGroups = 0;
  let addedMembers = 0;

  const fetchImpl: typeof fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/devicecode")) {
      return jsonRes({
        device_code: "dev-code-1",
        user_code: "ABCD-1234",
        verification_uri: "https://microsoft.com/devicelogin",
        expires_in: 900,
        interval: 1,
      });
    }
    if (url.endsWith("/token")) {
      tokenPolls++;
      if (opts.denyLogin) {
        return jsonRes({ error: "access_denied", error_description: "Admin cancelled", correlation_id: "corr-login-1" }, 400);
      }
      if (tokenPolls === 1) {
        return jsonRes({ error: "authorization_pending" }, 400);
      }
      return jsonRes({ access_token: "admin-delegated-token", expires_in: 3600 });
    }
    if (url.includes("/v1.0/organization")) {
      return jsonRes({
        value: [{ id: TENANT_ID, displayName: "Contoso Corp", verifiedDomains: [{ name: "contoso.com", isDefault: true }] }],
      });
    }
    if (url.includes("/v1.0/me")) {
      return jsonRes({
        id: "admin-user-1",
        displayName: "Global Admin",
        mail: "admin@contoso.com",
        userPrincipalName: "admin@contoso.com",
      });
    }
    if (url.includes("/v1.0/users")) {
      return jsonRes({
        value: opts.existingMailboxes ?? [{ displayName: "Alerts", mail: "alerts@contoso.com" }],
      });
    }
    if (url.includes("/v1.0/groups") && url.includes("/members/$ref") && method === "POST") {
      addedMembers++;
      return jsonRes({}, 204);
    }
    if (url.includes("/v1.0/groups") && method === "GET") {
      return jsonRes({ value: [] });
    }
    if (url.endsWith("/v1.0/groups") && method === "POST") {
      createdGroups++;
      const parsed = init?.body ? (JSON.parse(String(init.body)) as { displayName?: string; description?: string }) : {};
      return jsonRes({
        id: `entra-group-${createdGroups}`,
        displayName: parsed.displayName ?? `Group ${createdGroups}`,
        description: parsed.description ?? "",
      }, 201);
    }
    if (url.includes("/v1.0/servicePrincipals") && url.includes("00000003-0000-0000-c000-000000000000")) {
      return jsonRes({ value: [{ id: "graph-sp-id", appRoles }] });
    }
    if (url.includes("/v1.0/servicePrincipals") && url.includes(APP_ID) && method === "GET") {
      return jsonRes({ value: [{ id: "argus-sp-id" }] });
    }
    if (url.endsWith("/v1.0/applications") && method === "POST") {
      createdApp = true;
      return jsonRes({ id: "app-obj-1", appId: APP_ID, displayName: "Argus M365" }, 201);
    }
    if (url.includes("/v1.0/applications?") && method === "GET") {
      return jsonRes({ value: [{ id: "app-obj-existing", appId: APP_ID, displayName: "Argus Existing", keyCredentials: [], requiredResourceAccess: [] }] });
    }
    if (url.includes("/v1.0/applications/app-obj-existing") && method === "PATCH") {
      patchedApp = true;
      return jsonRes({}, 204);
    }
    if (url.endsWith("/appRoleAssignments") && method === "POST") {
      grantedCount++;
      return jsonRes({ id: `assign-${grantedCount}` }, 201);
    }
    throw new Error(`Unexpected fetch ${method} ${url}`);
  }) as typeof fetch;

  return {
    fetchImpl,
    stats: () => ({ createdApp, patchedApp, grantedCount, createdGroups, addedMembers }),
  };
}

describe("One-click Azure provisioner", () => {
  test("create mode: polls pending, runs 9 steps (incl. groups + mailbox), stores encrypted cert in vault", async () => {
    const mock = makeMockFetch({ mode: "create" });
    const session = await startDeploySession(
      { mode: "create", origin: "https://argus.contoso.com" },
      { fetch: mock.fetchImpl },
    );
    expect(session.phase).toBe("awaiting_login");
    expect(session.deviceCode?.userCode).toBe("ABCD-1234");
    expect(session.steps).toHaveLength(9);

    // Poll 1: authorization_pending
    const pending = await pollDeploySession(session.id, { fetch: mock.fetchImpl });
    expect(pending.phase).toBe("awaiting_login");

    // Poll 2: token granted -> runs pipeline to succeeded
    const done = await pollDeploySession(session.id, {
      fetch: mock.fetchImpl,
      sleep: async () => {},
      waitForPipeline: true,
      testConnection: async () => {
        integrationsDao.upsert("microsoft365", {
          status: "connected",
          config: { tenantDisplayName: "Contoso Corp", primaryDomain: "contoso.com" },
        });
        return {
          ok: true,
          authMode: "certificate",
          steps: {
            auth: { ok: true, latencyMs: 12 },
            permissions: { ok: true, readable: true, granted: requiredScopes(), missing: [] },
            mailbox: { ok: true },
          },
        };
      },
    });

    expect(done.phase).toBe("succeeded");
    expect(done.steps.every((s) => s.status === "done")).toBe(true);
    expect(done.result?.tenantDisplayName).toBe("Contoso Corp");
    expect(done.result?.primaryDomain).toBe("contoso.com");
    expect(done.result?.clientId).toBe(APP_ID);
    expect(done.result?.grantedCount).toBe(requiredScopes().length);
    expect(done.result?.provisionedGroups).toHaveLength(3);
    expect(done.result?.provisionedGroups.every((g) => g.entraLinked)).toBe(true);
    expect(done.result?.dedicatedMailboxAddress).toBe("argus@contoso.com");
    expect(done.result?.dedicatedMailboxExists).toBe(false);
    expect(done.result?.sharedMailboxScript).toContain("New-Mailbox -Shared");
    expect(done.result?.sharedMailboxScript).toContain(APP_ID);
    expect(mock.stats().createdApp).toBe(true);
    expect(mock.stats().createdGroups).toBe(3);
    expect(mock.stats().addedMembers).toBe(3);
    expect(vaultService.authMode()).toBe("certificate");
    expect(vaultService.get("clientId")).toBe(APP_ID);
    expect(vaultService.get("mailbox")).toBe("admin@contoso.com");
  });

  test("auto-selects existing dedicated argus@domain mailbox without generating Exchange script", async () => {
    const mock = makeMockFetch({
      mode: "create",
      existingMailboxes: [
        { displayName: "Argus Reports", mail: "argus@contoso.com" },
        { displayName: "Alerts", mail: "alerts@contoso.com" },
      ],
    });
    const session = await startDeploySession(
      { mode: "create", origin: "https://argus.contoso.com" },
      { fetch: mock.fetchImpl },
    );
    await pollDeploySession(session.id, { fetch: mock.fetchImpl });
    const done = await pollDeploySession(session.id, {
      fetch: mock.fetchImpl,
      sleep: async () => {},
      waitForPipeline: true,
      testConnection: async () => ({
        ok: true,
        authMode: "certificate",
        steps: {
          auth: { ok: true, latencyMs: 8 },
          permissions: { ok: true, readable: true, granted: requiredScopes(), missing: [] },
          mailbox: { ok: true },
        },
      }),
    });
    expect(done.phase).toBe("succeeded");
    expect(done.result?.dedicatedMailboxExists).toBe(true);
    expect(done.result?.mailbox).toBe("argus@contoso.com");
    expect(done.result?.sharedMailboxScript).toBeUndefined();
    expect(vaultService.get("mailbox")).toBe("argus@contoso.com");
  });

  test("upgrade mode: patches existing app with certificate", async () => {
    const mock = makeMockFetch({ mode: "upgrade" });
    const session = await startDeploySession({ mode: "upgrade", mailbox: "alerts@contoso.com" }, { fetch: mock.fetchImpl });
    await pollDeploySession(session.id, { fetch: mock.fetchImpl }); // pending
    const done = await pollDeploySession(session.id, {
      fetch: mock.fetchImpl,
      sleep: async () => {},
      waitForPipeline: true,
      testConnection: async () => ({
        ok: true,
        authMode: "certificate",
        steps: {
          auth: { ok: true, latencyMs: 5 },
          permissions: { ok: true, readable: true, granted: requiredScopes(), missing: [] },
          mailbox: { ok: true },
        },
      }),
    });
    expect(done.phase).toBe("succeeded");
    expect(mock.stats().patchedApp).toBe(true);
    expect(vaultService.get("mailbox")).toBe("alerts@contoso.com");
  });

  test("login failure captures correlationId cleanly", async () => {
    const mock = makeMockFetch({ denyLogin: true });
    const session = await startDeploySession({ mode: "create" }, { fetch: mock.fetchImpl });
    const failed = await pollDeploySession(session.id, { fetch: mock.fetchImpl });
    expect(failed.phase).toBe("failed");
    expect(failed.correlationId).toBe("corr-login-1");
    expect(failed.steps.find((s) => s.id === "login")?.status).toBe("error");
  });
});
