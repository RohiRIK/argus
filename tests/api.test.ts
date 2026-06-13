import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-api-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const jobsRoute = await import("../src/app/api/jobs/route");
const catalogRoute = await import("../src/app/api/catalog/route");
const settingsRoute = await import("../src/app/api/settings/route");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const post = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /api/jobs", () => {
  test("returns empty list initially", async () => {
    const body = await (await jobsRoute.GET()).json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });
});

describe("POST /api/jobs", () => {
  test("creates a valid job", async () => {
    const res = await jobsRoute.POST(
      post("http://test/api/jobs", {
        name: "Sign-in anomalies",
        reportType: "sign-in-anomalies",
        scheduleType: "preset",
        schedulePreset: "daily",
        recipients: ["admin@contoso.com"],
      }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBeTruthy();
    expect(body.data.status).toBe("active");
  });

  test("rejects invalid input with 400 + field errors", async () => {
    const res = await jobsRoute.POST(
      post("http://test/api/jobs", { reportType: "x", scheduleType: "preset" }), // missing name + preset
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("ValidationError");
    expect(body.error.fields).toBeDefined();
  });

  test("rejects bad cron expression", async () => {
    const res = await jobsRoute.POST(
      post("http://test/api/jobs", {
        name: "bad cron",
        reportType: "sign-in-anomalies",
        scheduleType: "cron",
        cronExpression: "not a cron",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/catalog", () => {
  test("lists the sign-in anomalies report", async () => {
    const body = await (await catalogRoute.GET()).json();
    expect(body.success).toBe(true);
    expect(body.data.some((r: { id: string }) => r.id === "sign-in-anomalies")).toBe(true);
  });
});

describe("settings", () => {
  test("GET returns singleton; PUT updates language", async () => {
    const got = await (await settingsRoute.GET()).json();
    expect(got.data.id).toBe("singleton");
    const put = await settingsRoute.PUT(post("http://test/api/settings", { language: "he" }));
    const body = await put.json();
    expect(body.data.language).toBe("he");
  });
});
