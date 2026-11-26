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
    exoStatus?: number;
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
  let exoCreatedMailbox = false;
  let assignedExoRole = false;
  let revokedExoRole = false;
  let revokedExoAppRole = false;
  let capturedAnchor = "";
  let capturedCmdlet = "";

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
      const bodyStr = String(init?.body ?? "");
      if (bodyStr.includes("client_credentials") && bodyStr.includes("outlook.office365.com")) {
        return jsonRes({ access_token: "exo-app-token", expires_in: 3600 });
      }
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
        value: [
          {
            id: TENANT_ID,
            displayName: "Contoso Corp",
            verifiedDomains: [
              { name: "contoso.com", isDefault: true },
              { name: "contoso.onmicrosoft.com", isInitial: true },
            ],
          },
        ],
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
    if (url.includes("/v1.0/servicePrincipals") && url.includes("00000002-0000-0ff1-ce00-000000000000")) {
      return jsonRes({
        value: [{ id: "exo-sp-id", appRoles: [{ id: "exo-manage-role-id", value: "Exchange.ManageAsApp" }] }],
      });
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
      const parsed = init?.body ? (JSON.parse(String(init.body)) as { resourceId?: string }) : {};
      const id = parsed.resourceId === "exo-sp-id" ? "exo-app-assign-1" : `assign-${grantedCount}`;
      return jsonRes({ id }, 201);
    }
    if (url.includes("/appRoleAssignments/exo-app-assign-1") && method === "DELETE") {
      revokedExoAppRole = true;
      return jsonRes({}, 204);
    }
    if (url.endsWith("/v1.0/roleManagement/directory/roleAssignments") && method === "POST") {
      assignedExoRole = true;
      return jsonRes({ id: "exo-dir-role-1" }, 201);
    }
    if (url.endsWith("/v1.0/roleManagement/directory/roleAssignments/exo-dir-role-1") && method === "DELETE") {
      revokedExoRole = true;
      return jsonRes({}, 204);
    }
    if (url.includes(`outlook.office365.com/adminapi/beta/${TENANT_ID}/InvokeCommand`) && method === "POST") {
      const headersObj = (init?.headers ?? {}) as Record<string, string>;
      capturedAnchor = headersObj["X-AnchorMailbox"] ?? "";
      capturedCmdlet = String(init?.body ?? "");
      const status = opts.exoStatus ?? 200;
      if (status >= 400) {
        return jsonRes({ error: { message: "Forbidden by Exchange RBAC" } }, status);
      }
      exoCreatedMailbox = true;
      return jsonRes({ value: [{ PrimarySmtpAddress: "argus@contoso.com" }] }, 200);
    }
    throw new Error(`Unexpected fetch ${method} ${url}`);
  }) as typeof fetch;

  return {
    fetchImpl,
    stats: () => ({
      createdApp,
      patchedApp,
      grantedCount,
      createdGroups,
      addedMembers,
      exoCreatedMailbox,
      assignedExoRole,
      revokedExoRole,
      revokedExoAppRole,
      capturedAnchor,
      capturedCmdlet,
    }),
  };
}

describe("One-click Azure provisioner", () => {
  test("create mode: polls pending, runs 9 steps, auto-creates Exchange Shared Mailbox, and cleans up temp roles", async () => {
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
    // H2: "Manage Entra groups" is off by default, so Quick Setup creates local groups only.
    expect(done.result?.provisionedGroups.every((g) => !g.entraLinked)).toBe(true);
    expect(done.result?.dedicatedMailboxAddress).toBe("argus@contoso.com");
    expect(done.result?.dedicatedMailboxExists).toBe(true);
    expect(done.result?.mailboxCreated).toBe(true);
    expect(done.result?.mailbox).toBe("argus@contoso.com");
    expect(mock.stats().createdApp).toBe(true);
    expect(mock.stats().createdGroups).toBe(0);
    expect(mock.stats().addedMembers).toBe(0);
    expect(mock.stats().exoCreatedMailbox).toBe(true);
    expect(mock.stats().assignedExoRole).toBe(true);
    expect(mock.stats().revokedExoRole).toBe(true);
    expect(mock.stats().revokedExoAppRole).toBe(true);
    expect(mock.stats().capturedAnchor).toContain("contoso.onmicrosoft.com");
    expect(mock.stats().capturedCmdlet).toContain("New-Mailbox");
    expect(mock.stats().capturedCmdlet).toContain("argus@contoso.com");
    expect(vaultService.authMode()).toBe("certificate");
    expect(vaultService.get("clientId")).toBe(APP_ID);
    expect(vaultService.get("mailbox")).toBe("argus@contoso.com");
  });

  test("falls back gracefully to admin mailbox when Exchange InvokeCommand returns 403 and still revokes temp roles", async () => {
    const mock = makeMockFetch({ mode: "create", exoStatus: 403 });
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
          auth: { ok: true, latencyMs: 10 },
          permissions: { ok: true, readable: true, granted: requiredScopes(), missing: [] },
          mailbox: { ok: true },
        },
      }),
    });
    expect(done.phase).toBe("succeeded");
    expect(done.result?.mailboxCreated).toBe(false);
    expect(done.result?.dedicatedMailboxExists).toBe(false);
    expect(done.result?.mailbox).toBe("admin@contoso.com");
    expect(mock.stats().exoCreatedMailbox).toBe(false);
    expect(mock.stats().revokedExoRole).toBe(true);
    expect(mock.stats().revokedExoAppRole).toBe(true);
  });

  test("auto-selects existing dedicated argus@domain mailbox without invoking Exchange Admin API", async () => {
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
    expect(done.result?.mailboxCreated).toBe(false);
    expect(done.result?.mailbox).toBe("argus@contoso.com");
    expect(done.result?.sharedMailboxScript).toBeUndefined();
    expect(mock.stats().exoCreatedMailbox).toBe(false);
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
