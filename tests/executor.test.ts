import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-exec-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { runJob } = await import("../src/services/executor");
const { jobsDao } = await import("../src/db/dao/jobs");
const { logsDao } = await import("../src/db/dao/executions");
const { baselinesDao } = await import("../src/db/dao/baselines");
const { executionRowsDao } = await import("../src/db/dao/execution-rows");
const { maintenanceWindowsDao } = await import("../src/db/dao/maintenance-windows");
const { vaultService } = await import("../src/services/vault/vault");
const { settingsDao } = await import("../src/db/dao/settings");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
const { GraphApiError } = await import("../src/lib/errors");
import type { GraphTransport } from "../src/services/graph/client";
import type { EmailTransport, EmailMessage } from "../src/services/dispatch/email";

beforeAll(() => {
  runMigrations();
  vaultService.set("mailbox", "alerts@contoso.com");
});
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const failedSignIns = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    userPrincipalName: `user${i}@contoso.com`,
    ipAddress: "1.2.3.4",
    status: { errorCode: 50126, failureReason: "Invalid credentials" },
  }));

// Failed sign-ins for a specific set of user ids — lets a test control which
// row identities (user|app|reason) appear, to exercise the row-level diff.
const failedSignInsFor = (ids: number[]) =>
  ids.map((i) => ({
    id: `s${i}`,
    userPrincipalName: `user${i}@contoso.com`,
    ipAddress: "1.2.3.4",
    status: { errorCode: 50126, failureReason: "Invalid credentials" },
  }));

function transportWith(rows: unknown[]): GraphTransport {
  return { get: async () => ({ value: rows as never[], latencyMs: 12 }) };
}

function capturingEmail(): { transport: EmailTransport; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { transport: { send: async (m) => void sent.push(m) }, sent };
}

function makeJob(overrides: Partial<Parameters<typeof jobsDao.create>[0]> = {}) {
  return jobsDao.create({
    name: "Sign-in test",
    reportType: "sign-in-anomalies",
    scheduleType: "preset",
    schedulePreset: "daily",
    recipients: ["admin@contoso.com"],
    conditionalRules: { mode: "always" },
    ...overrides,
  });
}

describe("runJob", () => {
  test("success path sends email and persists output (AC-6)", async () => {
    const job = makeJob();
    const email = capturingEmail();
    const exec = await runJob(job, {
      transport: transportWith(failedSignIns(7)),
      email: email.transport,
      canSendEmail: true,
    });
    expect(exec.status).toBe("success");
    expect(exec.emailSent).toBe(true);
    expect(exec.recordsProcessed).toBe(7);
    expect(exec.outputHtml).toContain("Daily Sign-in Anomalies");
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].from).toBe("alerts@contoso.com");
    expect(logsDao.forExecution(exec.id).some((l) => l.message.includes("Email sent"))).toBe(true);
  });

  test("suppresses when condition not met (no email)", async () => {
    const job = makeJob({ conditionalRules: { mode: "count_gt", threshold: 9999 } });
    const email = capturingEmail();
    const exec = await runJob(job, {
      transport: transportWith(failedSignIns(3)),
      email: email.transport,
      canSendEmail: true,
    });
    expect(exec.status).toBe("suppressed");
    expect(exec.emailSent).toBe(false);
    expect(exec.suppressionReason).toContain("below threshold");
    expect(email.sent).toHaveLength(0);
  });

  test("read-only mode skips email when mailbox unvalidated", async () => {
    const job = makeJob();
    const email = capturingEmail();
    const exec = await runJob(job, {
      transport: transportWith(failedSignIns(2)),
      email: email.transport,
      canSendEmail: false,
    });
    expect(exec.status).toBe("warning");
    expect(exec.emailSent).toBe(false);
    expect(email.sent).toHaveLength(0);
  });

  test("empty report (0 items) is suppressed, not emailed (default)", async () => {
    settingsDao.update({ suppressEmptyReports: true });
    const job = makeJob({ conditionalRules: { mode: "always" } });
    const email = capturingEmail();
    const exec = await runJob(job, { transport: transportWith([]), email: email.transport, canSendEmail: true });
    expect(exec.status).toBe("suppressed");
    expect(exec.suppressionReason).toContain("empty report");
    expect(exec.emailSent).toBe(false);
    expect(email.sent).toHaveLength(0);
  });

  test("empty report IS emailed when suppression is off", async () => {
    settingsDao.update({ suppressEmptyReports: false });
    const job = makeJob({ conditionalRules: { mode: "always" } });
    const email = capturingEmail();
    const exec = await runJob(job, { transport: transportWith([]), email: email.transport, canSendEmail: true });
    expect(exec.status).toBe("success");
    expect(exec.emailSent).toBe(true);
    settingsDao.update({ suppressEmptyReports: true }); // restore default
  });

  test("no recipients (job + global both empty) → warning, no send (#3)", async () => {
    const job = makeJob({ recipients: [] });
    const email = capturingEmail();
    const exec = await runJob(job, {
      transport: transportWith(failedSignIns(5)),
      email: email.transport,
      canSendEmail: true,
    });
    expect(exec.status).toBe("warning");
    expect(exec.suppressionReason).toBe("no recipients configured");
    expect(exec.emailSent).toBe(false);
    expect(email.sent).toHaveLength(0);
  });

  test("failed fetch ends as failed with error captured", async () => {
    const job = makeJob();
    const exec = await runJob(job, {
      transport: { get: async () => {
        throw new GraphApiError("boom", { graphStatus: 500 });
      } },
      email: capturingEmail().transport,
      canSendEmail: true,
    });
    expect(exec.status).toBe("failed");
    expect(exec.errorMessage).toContain("boom");
  });

  test("prunes baselines at most once per day across back-to-back runs (AC-S4)", async () => {
    const job = makeJob();
    // Jump well past the last prune so the first run is eligible, the second is not.
    const future = new Date(Date.now() + 10 * 86_400_000);
    const deps = {
      transport: transportWith(failedSignIns(1)),
      email: capturingEmail().transport,
      canSendEmail: true,
      now: () => future,
    };
    const spy = spyOn(baselinesDao, "prune");
    spy.mockClear();
    await runJob(job, deps);
    await runJob(job, deps);
    expect(spy.mock.calls.length).toBe(1);
    spy.mockRestore();
  });

  test("emails admins when a job hits the consecutive-failure threshold (F8)", async () => {
    settingsDao.update({ adminContacts: ["ops@contoso.com"], alertThreshold: 1 });
    const job = makeJob({ name: "Flaky job" });
    const email = capturingEmail();
    const exec = await runJob(job, {
      transport: { get: async () => { throw new GraphApiError("kaboom", { graphStatus: 500 }); } },
      email: email.transport,
      canSendEmail: true,
    });
    expect(exec.status).toBe("failed");
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toEqual(["ops@contoso.com"]);
    expect(email.sent[0].subject).toContain("Flaky job");
    expect(email.sent[0].subject).toContain("1×");
    settingsDao.update({ adminContacts: [], alertThreshold: 0 }); // reset for isolation
  });

  // spec-history-and-diff: row-level new_items. Same job across runs so each run's
  // snapshot is the next run's prior. canSendEmail off so we observe send/suppress
  // via status without needing a mailbox.
  test("new_items swap case sends even though the count is unchanged (regression)", async () => {
    const job = makeJob({ name: "Diff swap", conditionalRules: { mode: "new_items" } });
    const email = capturingEmail();
    // Run 1: users {0,1,2} — first run, all 3 are new → sends.
    const r1 = await runJob(job, { transport: transportWith(failedSignInsFor([0, 1, 2])), email: email.transport, canSendEmail: true });
    expect(r1.status).toBe("success");
    expect(r1.recordsProcessed).toBe(3);
    // Run 2: users {1,2,3} — count still 3, but user3 is new and user0 left.
    // Old count-delta logic computed newItemCount = max(0, 3-3) = 0 → would suppress.
    const r2 = await runJob(job, { transport: transportWith(failedSignInsFor([1, 2, 3])), email: email.transport, canSendEmail: true });
    expect(r2.recordsProcessed).toBe(3);
    expect(r2.status).toBe("success");
    expect(logsDao.forExecution(r2.id).some((l) => l.message.includes("1 added, 1 removed"))).toBe(true);
  });

  test("new_items suppresses when the identical row set repeats", async () => {
    const job = makeJob({ name: "Diff stable", conditionalRules: { mode: "new_items" } });
    const email = capturingEmail();
    await runJob(job, { transport: transportWith(failedSignInsFor([10, 11])), email: email.transport, canSendEmail: true });
    // Same identities again → 0 added → suppressed.
    const r2 = await runJob(job, { transport: transportWith(failedSignInsFor([10, 11])), email: email.transport, canSendEmail: true });
    expect(r2.status).toBe("suppressed");
    expect(r2.suppressionReason).toContain("no new items");
  });

  test("prunes execution-row snapshots on the same daily cadence", async () => {
    const job = makeJob({ name: "Diff prune", conditionalRules: { mode: "always" } });
    const future = new Date(Date.now() + 20 * 86_400_000);
    const deps = { transport: transportWith(failedSignInsFor([20])), email: capturingEmail().transport, canSendEmail: true, now: () => future };
    const spy = spyOn(executionRowsDao, "prune");
    spy.mockClear();
    await runJob(job, deps);
    await runJob(job, deps);
    expect(spy.mock.calls.length).toBe(1);
    spy.mockRestore();
  });

  test("anomaly condition sends when count deviates from baseline", async () => {
    const job = makeJob({ conditionalRules: { mode: "anomaly" } });
    // Seed a low, stable baseline history.
    for (const v of [2, 3, 2, 3, 2]) baselinesDao.record(job.id, "count", v);
    const email = capturingEmail();
    const exec = await runJob(job, {
      transport: transportWith(failedSignIns(80)), // far above baseline
      email: email.transport,
      canSendEmail: true,
    });
    expect(exec.status).toBe("success");
    expect(exec.outputHtml).toContain("Anomaly detected");
    expect(email.sent).toHaveLength(1);
  });

  // spec-alerting: metric_delta on the primary count. The first run records a
  // baseline (suppressed); a later run that drops by ≥ delta alerts.
  test("metric_delta alerts when the metric drops past the threshold", async () => {
    const job = makeJob({ name: "Delta drop", conditionalRules: { mode: "metric_delta", metric: "count", direction: "drop", delta: 5 } });
    const email = capturingEmail();
    // Run 1: count 10 — no prior, baseline recorded, suppressed.
    const r1 = await runJob(job, { transport: transportWith(failedSignInsFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), email: email.transport, canSendEmail: true });
    expect(r1.status).toBe("suppressed");
    expect(r1.suppressionReason).toContain("baseline");
    // Run 2: count 4 — dropped 6 (≥5) → alert.
    const r2 = await runJob(job, { transport: transportWith(failedSignInsFor([1, 2, 3, 4])), email: email.transport, canSendEmail: true });
    expect(r2.status).toBe("success");
    expect(r2.emailSent).toBe(true);
    // Run 3: count 3 — dropped only 1 (<5) → suppressed.
    const r3 = await runJob(job, { transport: transportWith(failedSignInsFor([1, 2, 3])), email: email.transport, canSendEmail: true });
    expect(r3.status).toBe("suppressed");
    expect(r3.suppressionReason).toContain("under drop threshold");
  });

  // spec-alerting: a maintenance window mutes the send but the run still executes
  // and persists as suppressed (forensic record, AC6).
  test("maintenance window mutes the send but the run still persists", async () => {
    const now = Date.now();
    const win = maintenanceWindowsDao.create({
      name: "Migration", kind: "oneoff",
      startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(),
    });
    const job = makeJob({ name: "Muted job", conditionalRules: { mode: "always" } });
    const email = capturingEmail();
    const exec = await runJob(job, { transport: transportWith(failedSignInsFor([1, 2, 3])), email: email.transport, canSendEmail: true });
    expect(exec.status).toBe("suppressed");
    expect(exec.suppressionReason).toContain("maintenance window");
    expect(exec.emailSent).toBe(false);
    expect(email.sent).toHaveLength(0);
    expect(exec.recordsProcessed).toBe(3); // ran, computed, persisted — not skipped
    maintenanceWindowsDao.delete(win.id); // isolation
  });
});
