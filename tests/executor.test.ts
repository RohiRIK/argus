import { describe, test, expect, beforeAll, afterAll } from "bun:test";
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
const { vaultService } = await import("../src/services/vault/vault");
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
});
