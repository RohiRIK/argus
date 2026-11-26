import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-runc-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { runJob } = await import("../src/services/executor");
const { jobsDao } = await import("../src/db/dao/jobs");
const { executionsDao } = await import("../src/db/dao/executions");
const { recipientGroupsDao } = await import("../src/db/dao/recipient-groups");
const { settingsDao } = await import("../src/db/dao/settings");
const { integrationsDao } = await import("../src/db/dao/integrations");
const { auditDao } = await import("../src/db/dao/audit");
const { vaultService } = await import("../src/services/vault/vault");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
const readiness = await import("../src/services/job-readiness");
const { reconcileInterruptedRuns } = await import("../src/services/scheduler");
const quickEnable = await import("../src/app/api/catalog/quick-enable/route");
const jobsRoute = await import("../src/app/api/jobs/route");
const jobRoute = await import("../src/app/api/jobs/[id]/route");
const starterPack = await import("../src/app/api/onboarding/starter-pack/route");
import type { EmailTransport, EmailMessage } from "../src/services/dispatch/email";
import type { GraphTransport } from "../src/services/graph/client";

beforeAll(() => {
  runMigrations();
  vaultService.set("mailbox", "alerts@contoso.com");
});
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const transport: GraphTransport = {
  get: async () => ({
    value: [{ id: "s1", userPrincipalName: "u@contoso.com", ipAddress: "1.2.3.4", status: { errorCode: 50126, failureReason: "x" } }] as never[],
    latencyMs: 5,
  }),
};
function mail() {
  const sent: EmailMessage[] = [];
  const transport: EmailTransport = { send: async (m) => void sent.push(m) };
  return { sent, transport };
}
const job = (over: Partial<Parameters<typeof jobsDao.create>[0]> = {}) =>
  jobsDao.create({
    name: "Contract job",
    reportType: "sign-in-anomalies",
    scheduleType: "preset",
    schedulePreset: "daily",
    recipients: ["admin@contoso.com"],
    conditionalRules: { mode: "always" },
    ...over,
  });
const resolveRecipients = async (o: { directRecipients: string[] }) => ({
  emails: o.directRecipients,
  groupBreakdown: [],
  warnings: [],
});

describe("H4 activation contract", () => {
  test("no recipients anywhere → blocker; compute-only → none; group with members → none", () => {
    expect(readiness.jobBlockers({ recipients: [], recipientGroupIds: [] })[0]?.code).toBe("no_recipients");
    expect(readiness.jobBlockers({ recipients: [], recipientGroupIds: [], deliveryMode: "none" })).toEqual([]);
    const g = recipientGroupsDao.create({
      name: "Has members",
      description: "",
      entraGroupId: null,
      entraDisplayName: null,
      managedByArgus: false,
      staticMembers: ["soc@contoso.com"],
      cachedEntraMembers: [],
      lastSyncedAt: null,
      lastSyncError: null,
    });
    expect(readiness.jobBlockers({ recipients: [], recipientGroupIds: [g.id] })).toEqual([]);
    const empty = recipientGroupsDao.create({
      name: "Empty group",
      description: "",
      entraGroupId: null,
      entraDisplayName: null,
      managedByArgus: false,
      staticMembers: [],
      cachedEntraMembers: [],
      lastSyncedAt: null,
      lastSyncError: null,
    });
    expect(readiness.jobBlockers({ recipients: [], recipientGroupIds: [empty.id] })[0]?.code).toBe("no_recipients");
  });

  test("global recipients count when the job has none of its own", () => {
    settingsDao.update({ globalRecipients: ["global@contoso.com"] });
    expect(readiness.jobBlockers({ recipients: [], recipientGroupIds: [] })).toEqual([]);
    settingsDao.update({ globalRecipients: [] });
  });

  test("quick-enable, starter pack, editor create and update all pause undeliverable jobs", async () => {
    const qe = await (await quickEnable.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ reportType: "risky-users" }) }))).json();
    expect(qe.data.status).toBe("disabled");
    expect(qe.data.blockers[0].repairHref).toBe(`/jobs/${qe.data.id}/edit`);

    const sp = await (await starterPack.POST()).json();
    expect(sp.data.pausedCount).toBe(sp.data.createdCount);
    expect(sp.data.jobs.every((j: { status: string }) => j.status === "disabled")).toBe(true);

    const base = { name: "Editor job", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily" };
    const created = await (await jobsRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify(base) }))).json();
    expect(created.data.status).toBe("disabled");
    expect(created.data.blockers).toHaveLength(1);

    const computeOnly = await (
      await jobsRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...base, name: "C", deliveryMode: "none" }) }))
    ).json();
    expect(computeOnly.data.status).toBe("active");
    expect(computeOnly.data.blockers).toEqual([]);

    const ctx = { params: Promise.resolve({ id: created.data.id }) };
    const stillBlocked = await (await jobRoute.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ status: "active" }) }), ctx)).json();
    expect(stillBlocked.data.status).toBe("disabled");
    const fixed = await (
      await jobRoute.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ status: "active", recipients: ["a@contoso.com"] }) }), ctx)
    ).json();
    expect(fixed.data.status).toBe("active");
    expect(fixed.data.blockers).toEqual([]);
  });
});

describe("H3 shared delivery preflight", () => {
  test("blocked when Mail.Send is unverified or no sender; same answer for every trigger", async () => {
    settingsDao.update({ permissionStatus: "missing" });
    expect(readiness.deliveryPreflight().canDeliver).toBe(false);

    const j = job();
    for (const trigger of ["scheduled", "manual"] as const) {
      const m = mail();
      const e = await runJob(j, { transport, email: m.transport, trigger, resolveRecipients });
      expect(e.status).toBe("warning");
      expect(e.suppressionReason).toMatch(/^blocked: Mail.Send/);
      expect(e.trigger).toBe(trigger);
      expect(e.deliveryStatus).toBe("not_attempted");
      expect(m.sent).toHaveLength(0);
    }
  });

  test("uses the verified capability report when present", () => {
    integrationsDao.upsert("microsoft365", {
      name: "Microsoft 365",
      status: "connected",
      config: { capabilities: { readable: true, deliver: { ok: true, missing: [] } } },
    });
    expect(readiness.deliveryPreflight().canDeliver).toBe(true);
  });

  test("scheduled and manual runs of an active job both send; delivery is 'accepted'", async () => {
    const j = job();
    for (const trigger of ["scheduled", "manual"] as const) {
      const m = mail();
      const e = await runJob(j, { transport, email: m.transport, trigger, resolveRecipients });
      expect(e.emailSent).toBe(true);
      expect(e.deliveryStatus).toBe("accepted");
      expect(m.sent).toHaveLength(1);
    }
  });

  test("Run Now on a paused job is a diagnostic: runs, never emails", async () => {
    const j = job({ status: "disabled" });
    const m = mail();
    const e = await runJob(j, { transport, email: m.transport, trigger: "manual", deliver: false, resolveRecipients });
    expect(e.status).toBe("success");
    expect(e.emailSent).toBe(false);
    expect(e.suppressionReason).toMatch(/paused job/);
    expect(m.sent).toHaveLength(0);
  });

  test("compute-only job succeeds without email", async () => {
    const j = job({ recipients: [], deliveryMode: "none" });
    const m = mail();
    const e = await runJob(j, { transport, email: m.transport, resolveRecipients });
    expect(e.status).toBe("success");
    expect(e.emailSent).toBe(false);
    expect(m.sent).toHaveLength(0);
  });

  test("a send that throws records delivery 'failed'", async () => {
    const j = job();
    const e = await runJob(j, {
      transport,
      email: { send: async () => { throw new Error("sendMail failed (503)"); } },
      resolveRecipients,
    });
    expect(e.status).toBe("failed");
    expect(e.deliveryStatus).toBe("failed");
  });
});

describe("H5 interrupted runs", () => {
  test("runs left open before boot become interrupted with unknown delivery; trends ignore them", () => {
    const j = job();
    const done = executionsDao.create({ jobId: j.id, status: "success", startedAt: "2020-01-01T00:00:00.000Z", endedAt: "2020-01-01T00:01:00.000Z", recordsProcessed: 7 });
    const stuck = executionsDao.create({ jobId: j.id, status: "warning", startedAt: "2020-01-02T00:00:00.000Z" });
    const current = executionsDao.create({ jobId: j.id, status: "warning", startedAt: new Date(Date.now() + 60_000).toISOString() });

    expect(reconcileInterruptedRuns()).toBeGreaterThanOrEqual(1);
    const after = executionsDao.findById(stuck.id)!;
    expect(after.status).toBe("interrupted");
    expect(after.deliveryStatus).toBe("unknown");
    expect(after.endedAt).not.toBeNull();
    expect(executionsDao.findById(current.id)!.endedAt).toBeNull();
    expect(executionsDao.latestCountForJob(j.id, current.id)).toBe(done.recordsProcessed);
    expect(auditDao.list().some((a) => a.action === "run.interrupted")).toBe(true);
    // Idempotent: a second pass finds nothing new.
    expect(reconcileInterruptedRuns()).toBe(0);
  });
});
