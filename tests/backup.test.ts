import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-backup-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { exportBackup, importBackup, previewImport } = await import("../src/services/backup");
const { jobsDao } = await import("../src/db/dao/jobs");
const { maintenanceWindowsDao } = await import("../src/db/dao/maintenance-windows");
const { settingsDao } = await import("../src/db/dao/settings");
const { runMigrations } = await import("../src/db/migrate");
const { stopScheduler } = await import("../src/services/scheduler");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  stopScheduler();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("backup (P5)", () => {
  test("export excludes vault secrets", () => {
    const b = exportBackup();
    expect(b.version).toBe(1);
    expect(JSON.stringify(b)).not.toContain("clientSecret");
    expect((b as unknown as Record<string, unknown>).vault).toBeUndefined();
  });

  test("import round-trips a job", () => {
    const job = jobsDao.create({
      name: "BK Job",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
    });
    const snapshot = exportBackup();
    jobsDao.delete(job.id);
    expect(jobsDao.findById(job.id)).toBeUndefined();

    const res = importBackup(snapshot);
    expect(res.jobs).toBeGreaterThanOrEqual(1);
    expect(jobsDao.findById(job.id)?.name).toBe("BK Job");
  });

  test("rejects a malformed payload without writing", () => {
    expect(() => importBackup({ version: 2 })).toThrow();
    expect(() => importBackup({ version: 1, jobs: "nope", templates: [] })).toThrow();
  });

  test("round-trips maintenance windows and alerting settings", () => {
    settingsDao.update({ alertThreshold: 3, suppressEmptyReports: false });
    const win = maintenanceWindowsDao.create({
      name: "Weekly Patch",
      kind: "recurring",
      dayOfWeek: 0,
      startMinute: 60,
      endMinute: 120,
      enabled: true,
    });

    const snapshot = exportBackup();
    expect(snapshot.maintenanceWindows?.some((w) => w.id === win.id)).toBe(true);
    expect(snapshot.settings.alertThreshold).toBe(3);
    expect(snapshot.settings.suppressEmptyReports).toBe(false);

    maintenanceWindowsDao.delete(win.id);
    settingsDao.update({ alertThreshold: 0, suppressEmptyReports: true });

    const res = importBackup(snapshot);
    expect(res.maintenanceWindows).toBeGreaterThanOrEqual(1);
    expect(maintenanceWindowsDao.findById(win.id)?.name).toBe("Weekly Patch");
    expect(settingsDao.get().alertThreshold).toBe(3);
    expect(settingsDao.get().suppressEmptyReports).toBe(false);
  });

  test("rolls back atomically if an imported maintenance window is invalid", () => {
    const beforeJobs = jobsDao.findAll().length;
    expect(() =>
      importBackup({
        version: 1,
        exportedAt: new Date().toISOString(),
        jobs: [
          {
            id: "rollback-job-1",
            name: "Should Roll Back",
            description: "",
            reportType: "sign-in-anomalies",
            params: {},
            scheduleType: "preset",
            schedulePreset: "daily",
            cronExpression: null,
            templateId: null,
            recipients: [],
            recipientGroupIds: [],
            conditionalRules: { mode: "always" },
            tags: [],
            status: "active",
            snoozedUntil: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        templates: [],
        maintenanceWindows: [
          {
            id: "bad-win-1",
            name: "Bad",
            kind: "recurring",
            dayOfWeek: 0,
            startMinute: 400,
            endMinute: 100, // invalid wrap
            startsAt: null,
            endsAt: null,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        settings: exportBackup().settings,
      }),
    ).toThrow();
    expect(jobsDao.findAll().length).toBe(beforeJobs);
    expect(jobsDao.findById("rollback-job-1")).toBeUndefined();
  });
});

describe("backup import safety (H6)", () => {
  const spyDeps = () => {
    const calls = { add: [] as string[], remove: [] as string[], reschedule: 0 };
    return {
      calls,
      deps: {
        addOrReplaceJob: (id: string) => {
          calls.add.push(id);
          return true;
        },
        removeJob: (id: string) => {
          calls.remove.push(id);
        },
        rescheduleAll: () => {
          calls.reschedule++;
        },
      },
    };
  };

  function bundleWithActiveJob(id: string, over: Record<string, unknown> = {}) {
    const base = exportBackup();
    const now = new Date().toISOString();
    return {
      ...base,
      jobs: [
        {
          id,
          name: `Imported ${id}`,
          description: "",
          reportType: "sign-in-anomalies",
          params: {},
          scheduleType: "preset" as const,
          schedulePreset: "daily",
          cronExpression: null,
          templateId: null as string | null,
          recipients: [] as string[],
          recipientGroupIds: [] as string[],
          conditionalRules: { mode: "always" as const },
          tags: [] as string[],
          status: "active" as "active" | "disabled",
          snoozedUntil: null as string | null,
          createdAt: now,
          updatedAt: now,
          ...over,
        },
      ],
    };
  }

  test("preview writes nothing and reports plan + integration context", () => {
    const bundle = bundleWithActiveJob("h6-preview-job", { templateId: "tpl-does-not-exist", recipientGroupIds: ["grp-missing"] });
    bundle.settings = { ...bundle.settings, timezone: "Asia/Jerusalem" };
    const jobsBefore = jobsDao.findAll().length;
    const settingsBefore = JSON.stringify(settingsDao.get());

    const p = previewImport(bundle);

    expect(jobsDao.findById("h6-preview-job")).toBeUndefined();
    expect(jobsDao.findAll().length).toBe(jobsBefore);
    expect(JSON.stringify(settingsDao.get())).toBe(settingsBefore);

    const item = p.jobs.items.find((j) => j.id === "h6-preview-job");
    expect(item?.action).toBe("create");
    expect(item?.scheduled).toBe(true);
    expect(item?.bundleStatus).toBe("active");
    expect(item?.importedStatus).toBe("disabled");
    expect(p.jobs.scheduled).toBeGreaterThanOrEqual(1);
    expect(p.settingsChanges).toContain("timezone");
    expect(p.missingReferences).toContainEqual({
      ownerId: "h6-preview-job",
      ownerName: "Imported h6-preview-job",
      kind: "template",
      refId: "tpl-does-not-exist",
    });
    expect(p.missingReferences.some((m) => m.kind === "recipientGroup" && m.refId === "grp-missing")).toBe(true);
    expect(p.integration.provider).toBe("microsoft365");
    expect(p.integration.connected).toBe(false);
    expect(JSON.stringify(p)).not.toContain("clientSecret");
  });

  test("preview rejects a malformed payload", () => {
    expect(() => previewImport({ version: 9 })).toThrow();
  });

  test("import lands every job paused and never registers it with the scheduler", () => {
    const existing = jobsDao.create({
      name: "Existing active",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
    });
    const bundle = bundleWithActiveJob("h6-new-job");
    bundle.jobs.push({ ...existing, status: "active" } as (typeof bundle.jobs)[number]);
    const { calls, deps } = spyDeps();

    const res = importBackup(bundle, {}, deps);

    expect(res.jobs).toBe(2);
    expect(res.pausedJobs).toBe(2);
    expect(jobsDao.findById("h6-new-job")?.status).toBe("disabled");
    expect(jobsDao.findById(existing.id)?.status).toBe("disabled");
    expect(calls.add).toEqual([]);
    expect(calls.reschedule).toBe(0);
    // Overwritten jobs drop any live timer.
    expect(calls.remove.sort()).toEqual(["h6-new-job", existing.id].sort());
  });

  test("activate opt-in keeps bundle-active jobs active and schedules them", () => {
    const bundle = bundleWithActiveJob("h6-activate-job");
    const { calls, deps } = spyDeps();
    const res = importBackup(bundle, { activate: true }, deps);
    expect(res.pausedJobs).toBe(0);
    expect(jobsDao.findById("h6-activate-job")?.status).toBe("active");
    expect(calls.add).toEqual(["h6-activate-job"]);
  });

  test("import preserves target settings the bundle does not carry or leaves empty", () => {
    settingsDao.update({
      fromAddress: "reports@target.example",
      replyTo: "ops@target.example",
      adminContacts: ["admin@target.example"],
      retentionDays: 45,
      timezone: "UTC",
    });
    const bundle = bundleWithActiveJob("h6-settings-job");
    bundle.settings = {
      // Only a subset is carried; empty/null values must not clear the target.
      fromAddress: null,
      adminContacts: [],
      alertThreshold: 5,
    } as unknown as typeof bundle.settings;
    const { calls, deps } = spyDeps();

    importBackup(bundle, {}, deps);

    const s = settingsDao.get();
    expect(s.fromAddress).toBe("reports@target.example");
    expect(s.replyTo).toBe("ops@target.example");
    expect(s.adminContacts).toEqual(["admin@target.example"]);
    expect(s.retentionDays).toBe(45);
    expect(s.timezone).toBe("UTC");
    expect(s.alertThreshold).toBe(5);
    expect(calls.reschedule).toBe(0);
  });

  test("import ignores non-importable settings keys", () => {
    const before = settingsDao.get().masterKeyHash;
    const bundle = bundleWithActiveJob("h6-ignore-job");
    bundle.settings = { ...bundle.settings, masterKeyHash: "evil", permissionStatus: "ok" } as unknown as typeof bundle.settings;
    importBackup(bundle, {}, spyDeps().deps);
    expect(settingsDao.get().masterKeyHash).toBe(before);
  });

  test("import with a missing template is rejected without writing", () => {
    const bundle = bundleWithActiveJob("h6-missing-tpl", { templateId: "nope-template" });
    expect(() => importBackup(bundle, {}, spyDeps().deps)).toThrow(/missing template/);
    expect(jobsDao.findById("h6-missing-tpl")).toBeUndefined();
  });

  test("POST /api/backup?mode=preview returns a preview and writes nothing", async () => {
    const { POST } = await import("../src/app/api/backup/route");
    const bundle = bundleWithActiveJob("h6-route-job");
    const res = await POST(
      new Request("http://localhost/api/backup?mode=preview", { method: "POST", body: JSON.stringify(bundle) }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.preview.jobs.items[0].importedStatus).toBe("disabled");
    expect(jobsDao.findById("h6-route-job")).toBeUndefined();

    const bad = await POST(new Request("http://localhost/api/backup?mode=bogus", { method: "POST", body: "{}" }));
    expect(bad.status).toBe(400);
  });
});
