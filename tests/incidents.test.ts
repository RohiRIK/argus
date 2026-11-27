import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-inc-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { runJob } = await import("../src/services/executor");
const { jobsDao } = await import("../src/db/dao/jobs");
const { settingsDao } = await import("../src/db/dao/settings");
const { alertIncidentsDao } = await import("../src/db/dao/alert-incidents");
const { vaultService } = await import("../src/services/vault/vault");
const { backoffMs, ALERT_COOLDOWN_MS } = await import("../src/services/dispatch/incidents");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
import type { EmailMessage, EmailTransport } from "../src/services/dispatch/email";
import type { GraphTransport } from "../src/services/graph/client";

beforeAll(() => {
  runMigrations();
  vaultService.set("mailbox", "alerts@contoso.com");
  settingsDao.update({ alertThreshold: 2, adminContacts: ["admin@contoso.com"] });
});
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const failing: GraphTransport = { get: async () => { throw new Error("Graph 500"); } };
const working: GraphTransport = { get: async () => ({ value: [] as never[], latencyMs: 1 }) };

function mailbox(opts: { fail?: boolean } = {}) {
  const sent: EmailMessage[] = [];
  const transport: EmailTransport = {
    send: async (m) => {
      if (opts.fail) throw new Error("sendMail failed (503)");
      sent.push(m);
    },
  };
  return { sent, transport };
}

let clock = new Date("2026-01-01T00:00:00Z").getTime();
const at = (ms: number) => () => new Date(ms);
const mkJob = (name: string) =>
  jobsDao.create({ name, reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily", recipients: ["a@contoso.com"] });

async function run(jobId: string, transport: GraphTransport, mail: ReturnType<typeof mailbox>, advanceMs = 60_000) {
  clock += advanceMs;
  return runJob(jobsDao.findById(jobId)!, { transport, email: mail.transport, now: at(clock), canSendEmail: true });
}

describe("failure-alert incidents (H7)", () => {
  test("one alert per streak: opens at the threshold, silent for later failures, closes on recovery", async () => {
    const job = mkJob("Streak job");
    const mail = mailbox();
    await run(job.id, failing, mail);
    expect(mail.sent).toHaveLength(0);
    await run(job.id, failing, mail);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toEqual(["admin@contoso.com"]);
    for (let i = 0; i < 4; i++) await run(job.id, failing, mail);
    expect(mail.sent).toHaveLength(1);
    const open = alertIncidentsDao.openForJob(job.id)!;
    expect(open.notifyStatus).toBe("accepted");
    expect(open.failureCount).toBe(6);

    await run(job.id, working, mail);
    expect(alertIncidentsDao.openForJob(job.id)).toBeUndefined();
  });

  test("a failed alert send is recorded and retried with backoff, not counted as delivered", async () => {
    const job = mkJob("Retry job");
    const broken = mailbox({ fail: true });
    await run(job.id, failing, broken);
    await run(job.id, failing, broken);
    let inc = alertIncidentsDao.openForJob(job.id)!;
    expect(inc.notifyStatus).toBe("failed");
    expect(inc.notifyAttempts).toBe(1);
    expect(inc.lastError).toMatch(/503/);
    expect(new Date(inc.nextAttemptAt!).getTime() - new Date(inc.lastAttemptAt!).getTime()).toBe(backoffMs(1));

    const fixed = mailbox();
    await run(job.id, failing, fixed, 60_000); // before backoff: no retry
    expect(fixed.sent).toHaveLength(0);
    await run(job.id, failing, fixed, backoffMs(1)); // after backoff: retried and accepted
    expect(fixed.sent).toHaveLength(1);
    inc = alertIncidentsDao.openForJob(job.id)!;
    expect(inc.notifyStatus).toBe("accepted");
    expect(inc.notifyAttempts).toBe(2);
  });

  test("a new streak inside the cooldown is recorded but not emailed", async () => {
    const job = mkJob("Flapping job");
    const mail = mailbox();
    await run(job.id, failing, mail);
    await run(job.id, failing, mail);
    expect(mail.sent).toHaveLength(1);
    await run(job.id, working, mail);
    await run(job.id, failing, mail);
    await run(job.id, failing, mail);
    expect(mail.sent).toHaveLength(1);
    expect(alertIncidentsDao.openForJob(job.id)!.notifyStatus).toBe("suppressed");

    await run(job.id, working, mail);
    await run(job.id, failing, mail, ALERT_COOLDOWN_MS);
    await run(job.id, failing, mail);
    expect(mail.sent).toHaveLength(2);
  });

  test("backoff grows and is capped", () => {
    expect(backoffMs(1)).toBe(5 * 60_000);
    expect(backoffMs(2)).toBe(10 * 60_000);
    expect(backoffMs(20)).toBe(6 * 60 * 60_000);
  });
});
