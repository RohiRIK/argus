import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-caps-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
const { settingsDao } = await import("../src/db/dao/settings");
const { auditDao } = await import("../src/db/dao/audit");
const caps = await import("../src/services/graph/capabilities");
const { requiredScopes, testConnection } = await import("../src/services/graph/connection-test");
const { createEntraSecurityGroup, addEntraGroupMember, bootstrapDefaultRecipientGroups } = await import(
  "../src/services/graph/groups"
);
const { deployScopes } = await import("../src/services/graph/provisioner");
const capsRoute = await import("../src/app/api/integrations/[provider]/capabilities/route");
const permsRoute = await import("../src/app/api/integrations/[provider]/required-permissions/route");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const ctx = { params: Promise.resolve({ provider: "microsoft365" }) };

describe("scopes per capability", () => {
  test("default request excludes Group.ReadWrite.All; opt-in adds it", () => {
    const def = caps.scopesFor({ directoryWrites: false });
    expect(def).toContain("Mail.Send");
    expect(def).not.toContain("Group.ReadWrite.All");
    expect(caps.scopesFor({ directoryWrites: true })).toContain("Group.ReadWrite.All");
    expect(caps.readScopes()).not.toContain("Mail.Send");
    expect(caps.readScopes().length).toBeGreaterThan(5);
  });

  test("stored opt-in drives requiredScopes and the Quick Setup sign-in scopes", () => {
    expect(caps.directoryWritesEnabled()).toBe(false);
    expect(requiredScopes()).not.toContain("Group.ReadWrite.All");
    expect(deployScopes(false)).not.toContain("Group.ReadWrite.All");
    caps.setDirectoryWrites(true);
    expect(requiredScopes()).toContain("Group.ReadWrite.All");
    expect(deployScopes(true)).toContain("Group.ReadWrite.All");
    caps.setDirectoryWrites(false);
  });
});

describe("effectiveSender", () => {
  test("Settings From address wins over the vault mailbox", () => {
    expect(caps.effectiveSender({ fromAddress: "from@x.com" }, "vault@x.com")).toEqual({
      address: "from@x.com",
      source: "settings",
    });
    expect(caps.effectiveSender({ fromAddress: " " }, "vault@x.com")).toEqual({ address: "vault@x.com", source: "vault" });
    expect(caps.effectiveSender({ fromAddress: null }, null)).toEqual({ address: null, source: "none" });
  });
});

describe("evaluateCapabilities", () => {
  const sender = { address: "a@x.com", source: "vault" as const };

  test("read and deliver are judged independently", () => {
    const all = caps.scopesFor({ directoryWrites: false });
    const r = caps.evaluateCapabilities({ granted: all.filter((s) => s !== "Mail.Send"), directoryWrites: false, sender });
    expect(r.read.ok).toBe(true);
    expect(r.deliver.ok).toBe(false);
    expect(r.deliver.missing).toEqual(["Mail.Send"]);
    expect(r.directoryWrite).toEqual({ enabled: false, ok: true, missing: [] });
  });

  test("no sender means delivery is not ready even with Mail.Send", () => {
    const r = caps.evaluateCapabilities({
      granted: caps.scopesFor({ directoryWrites: false }),
      directoryWrites: false,
      sender: { address: null, source: "none" },
    });
    expect(r.read.ok).toBe(true);
    expect(r.deliver.ok).toBe(false);
  });

  test("unreadable grants mean unknown, never ready", () => {
    const r = caps.evaluateCapabilities({ granted: null, directoryWrites: true, sender });
    expect(r.readable).toBe(false);
    expect(r.read.ok).toBe(false);
    expect(r.deliver.ok).toBe(false);
    expect(r.directoryWrite.ok).toBe(false);
  });
});

describe("directory writes are opt-in", () => {
  const client = {
    api: () => ({
      post: async () => ({ id: "g1", displayName: "G" }),
      delete: async () => undefined,
    }),
  } as never;

  test("group create and membership changes refuse without opt-in", async () => {
    expect(createEntraSecurityGroup({ displayName: "G" }, { client })).rejects.toThrow(/Directory writes are off/);
    expect(addEntraGroupMember("g1", "u1", { client })).rejects.toThrow(/Directory writes are off/);
    const ok = await createEntraSecurityGroup({ displayName: "G" }, { client, directoryWrites: true });
    expect(ok.id).toBe("g1");
  });

  test("standard groups are created locally, without any Graph call, when off", async () => {
    let calls = 0;
    const spy = { api: () => { calls++; return { post: async () => ({ id: "x" }) }; } } as never;
    const res = await bootstrapDefaultRecipientGroups({ client: spy, directoryWrites: false });
    expect(calls).toBe(0);
    expect(res.created.every((g) => g.entraGroupId === null)).toBe(true);
    expect(res.warnings[0]).toMatch(/Directory writes are off/);
  });
});

describe("capability routes", () => {
  test("PUT toggles the opt-in and audits it; GET and required-permissions reflect it", async () => {
    const put = await capsRoute.PUT(
      new Request("http://x", { method: "PUT", body: JSON.stringify({ directoryWrites: true }) }),
      ctx,
    );
    expect(put.status).toBe(200);
    expect(caps.directoryWritesEnabled()).toBe(true);
    expect(auditDao.list().some((a) => a.action === "capability.directory_writes")).toBe(true);

    const perms = await (await permsRoute.GET(new Request("http://x"), ctx)).json();
    expect(perms.data.directoryWrites).toBe(true);
    expect(perms.data.groups.directoryWrite).toEqual(["Group.ReadWrite.All"]);
    expect(perms.data.scopes).toContain("Group.ReadWrite.All");

    await capsRoute.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ directoryWrites: false }) }), ctx);
    const get = await (await capsRoute.GET(new Request("http://x"), ctx)).json();
    expect(get.data.directoryWrites).toBe(false);
    expect(get.data.groups.directoryWrite).toEqual([]);
  });

  test("rejects a non-boolean body", async () => {
    const res = await capsRoute.PUT(
      new Request("http://x", { method: "PUT", body: JSON.stringify({ directoryWrites: "yes" }) }),
      ctx,
    );
    expect(res.status).toBe(400);
  });
});

describe("connection test verifies the delivery sender", () => {
  test("reports the Settings From address as the effective sender", async () => {
    settingsDao.update({ fromAddress: "reports@contoso.com" });
    const granted = caps.scopesFor({ directoryWrites: false });
    const roles = granted.map((n, i) => ({ id: `r${i}`, value: n }));
    const client = {
      api: (path: string) => ({
        filter: () => ({ select: () => ({ get: async () => ({ value: [{ id: "sp", displayName: "Argus" }] }) }) }),
        select: () => ({
          get: async () => {
            if (path.endsWith("/appRoleAssignments")) return { value: roles.map((r) => ({ appRoleId: r.id, resourceId: "res" })) };
            if (path.startsWith("/servicePrincipals/res")) return { appRoles: roles };
            return { value: [] };
          },
        }),
      }),
    };
    const r = await testConnection({ acquireToken: async () => ({}), client: client as never, clientId: "c", mailbox: "vault@contoso.com" });
    expect(r.steps.mailbox.address).toBe("reports@contoso.com");
    expect(r.steps.mailbox.source).toBe("settings");
    expect(r.capabilities?.read.ok).toBe(true);
    expect(r.capabilities?.deliver.ok).toBe(true);
    expect(r.capabilities?.directoryWrite.enabled).toBe(false);
    expect(r.ok).toBe(true);
    settingsDao.update({ fromAddress: null });
  });
});
