import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-mw-api-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const listRoute = await import("../src/app/api/maintenance-windows/route");
const itemRoute = await import("../src/app/api/maintenance-windows/[id]/route");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const reqJson = (method: string, body?: unknown) =>
  new Request("http://t/api/maintenance-windows", {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

describe("maintenance windows API", () => {
  test("creates recurring & one-off windows, lists, toggles, and deletes", async () => {
    const res1 = await listRoute.POST(
      reqJson("POST", {
        name: "Sunday Patch",
        kind: "recurring",
        dayOfWeek: 0,
        startMinute: 120,
        endMinute: 240,
      }),
    );
    expect(res1.status).toBe(200);
    const created = (await res1.json()).data;
    expect(created.name).toBe("Sunday Patch");
    expect(created.enabled).toBe(true);

    const res2 = await listRoute.POST(
      reqJson("POST", {
        name: "Tenant Cutover",
        kind: "oneoff",
        startsAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-07-01T04:00:00.000Z",
      }),
    );
    expect(res2.status).toBe(200);

    const listed = await (await listRoute.GET()).json();
    expect(listed.success).toBe(true);
    expect(listed.meta.total).toBe(2);

    const got = await (await itemRoute.GET(new Request("http://t"), { params: Promise.resolve({ id: created.id }) })).json();
    expect(got.data.id).toBe(created.id);

    const toggled = await itemRoute.PUT(
      reqJson("PUT", { enabled: false }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(toggled.status).toBe(200);
    expect((await toggled.json()).data.enabled).toBe(false);

    const del = await itemRoute.DELETE(new Request("http://t"), { params: Promise.resolve({ id: created.id }) });
    expect(del.status).toBe(200);

    const missing = await itemRoute.GET(new Request("http://t"), { params: Promise.resolve({ id: created.id }) });
    expect(missing.status).toBe(404);
  });

  test("rejects invalid window with 400", async () => {
    const bad = await listRoute.POST(
      reqJson("POST", {
        name: "Wraparound",
        kind: "recurring",
        dayOfWeek: 1,
        startMinute: 300,
        endMinute: 120,
      }),
    );
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("ValidationError");
  });
});
