import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-conn-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { testConnection, requiredScopes } = await import("../src/services/graph/connection-test");
const { settingsDao } = await import("../src/db/dao/settings");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const okToken = async () => ({});

/** Fake Graph client that reports `granted` as the app's assigned scopes. */
function fakeClient(opts: { granted?: string[]; throwStatus?: number; noSp?: boolean } = {}) {
  const granted = opts.granted ?? [];
  const roles = granted.map((n, i) => ({ id: `role-${i}`, value: n }));
  const assignments = roles.map((r) => ({ appRoleId: r.id, resourceId: "graph-res" }));
  const resolve = (path: string) => {
    if (opts.throwStatus) {
      const e = new Error("graph error") as Error & { statusCode: number };
      e.statusCode = opts.throwStatus;
      throw e;
    }
    if (path === "/servicePrincipals") return { value: opts.noSp ? [] : [{ id: "argus-sp" }] };
    if (path === "/servicePrincipals/argus-sp/appRoleAssignments") return { value: assignments };
    if (path === "/servicePrincipals/graph-res") return { appRoles: roles };
    return {};
  };
  return {
    api: (path: string) => ({
      filter: () => ({ select: () => ({ get: async () => resolve(path) }) }),
      select: () => ({ get: async () => resolve(path) }),
    }),
  } as unknown as NonNullable<Parameters<typeof testConnection>[0]>["client"];
}

describe("testConnection (DI, no tenant)", () => {
  test("auth failure → ok:false, auth error, permissions unreadable; persists 'error'", async () => {
    const r = await testConnection({ acquireToken: async () => { throw new Error("bad creds"); }, clientId: "c", mailbox: "m@x" });
    expect(r.ok).toBe(false);
    expect(r.steps.auth.ok).toBe(false);
    expect(r.steps.auth.error).toContain("bad creds");
    expect(r.steps.permissions.readable).toBe(false);
    expect(settingsDao.get().permissionStatus).toBe("error");
  });

  test("probe 403 → readable:false, all required missing, status 'missing' (consent pending, not false-empty)", async () => {
    const r = await testConnection({ acquireToken: okToken, client: fakeClient({ throwStatus: 403 }), clientId: "c", mailbox: "m@x" });
    expect(r.steps.permissions.readable).toBe(false);
    expect(r.steps.permissions.missing).toEqual(requiredScopes());
    expect(r.steps.permissions.error).toContain("Cannot read granted permissions");
    expect(r.ok).toBe(false);
    expect(settingsDao.get().permissionStatus).toBe("missing");
  });

  test("all scopes granted + mailbox → ok:true, readable, no missing, status 'ok'", async () => {
    const r = await testConnection({ acquireToken: okToken, client: fakeClient({ granted: requiredScopes() }), clientId: "c", mailbox: "shared@x" });
    expect(r.steps.permissions.readable).toBe(true);
    expect(r.steps.permissions.missing).toEqual([]);
    expect(r.steps.mailbox.ok).toBe(true);
    expect(r.ok).toBe(true);
    expect(settingsDao.get().permissionStatus).toBe("ok");
  });

  test("partial grant → readable, computes the gap, ok:false", async () => {
    const granted = requiredScopes().filter((s) => s !== "Mail.Send");
    const r = await testConnection({ acquireToken: okToken, client: fakeClient({ granted }), clientId: "c", mailbox: "shared@x" });
    expect(r.steps.permissions.readable).toBe(true);
    expect(r.steps.permissions.missing).toEqual(["Mail.Send"]);
    expect(r.ok).toBe(false);
  });

  test("mailbox unset → ok:false even when all permissions granted", async () => {
    const r = await testConnection({ acquireToken: okToken, client: fakeClient({ granted: requiredScopes() }), clientId: "c", mailbox: "" });
    expect(r.steps.permissions.ok).toBe(true);
    expect(r.steps.mailbox.ok).toBe(false);
    expect(r.ok).toBe(false);
  });
});
