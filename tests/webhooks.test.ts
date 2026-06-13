import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-wh-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { integrationsDao } = await import("../src/db/dao/integrations");
const { webhooksDao } = await import("../src/db/dao/webhooks");
const { jobsDao } = await import("../src/db/dao/jobs");
const { runJob } = await import("../src/services/executor");
const { dispatchWebhooks } = await import("../src/services/dispatch/webhook");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
import type { GraphTransport } from "../src/services/graph/client";
import type { WebhookPayload, WebhookTarget } from "../src/services/dispatch/webhook";

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const transport = (rows: unknown[]): GraphTransport => ({
  get: async () => ({ value: rows as never[], latencyMs: 1 }),
});

describe("integrations + webhooks DAOs", () => {
  test("upsert integration and add webhook", () => {
    const intg = integrationsDao.upsert("microsoft365", { name: "Microsoft 365", status: "connected" });
    expect(intg.provider).toBe("microsoft365");
    expect(integrationsDao.upsert("microsoft365", { status: "error" }).status).toBe("error"); // update path

    const wh = webhooksDao.create({ integrationId: intg.id, name: "Slack", url: "https://example.com/hook" });
    expect(wh.enabled).toBe(true);
    expect(webhooksDao.enabledTargets().some((t) => t.id === wh.id)).toBe(true);

    webhooksDao.recordDelivery(wh.id, "success");
    expect(webhooksDao.findById(wh.id)?.lastDeliveryStatus).toBe("success");
  });
});

describe("dispatchWebhooks", () => {
  test("delivers to enabled targets, reports per-URL result", async () => {
    const calls: string[] = [];
    const targets: WebhookTarget[] = [
      { id: "a", name: "ok", url: "https://x/a", enabled: true, includeFullHtml: true },
      { id: "b", name: "bad", url: "https://x/b", enabled: true, includeFullHtml: false },
    ];
    const payload: WebhookPayload = {
      executionId: "e", jobId: "j", jobName: "n", suppressionReason: "r",
      timestamp: "t", recordsProcessed: 0, baselineSnapshot: null, metadata: {}, fullHtml: "<p>x</p>",
    };
    const results = await dispatchWebhooks(targets, payload, {
      sleep: async () => {},
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(null, { status: String(url).endsWith("/b") ? 500 : 200 });
      },
    });
    expect(results.find((r) => r.webhookId === "a")?.status).toBe("success");
    expect(results.find((r) => r.webhookId === "b")?.status).toBe("failed");
    expect(calls.filter((u) => u.endsWith("/b")).length).toBe(3); // 3 retries
  });
});

describe("executor → webhook on suppression", () => {
  test("suppressed job dispatches webhooks with full HTML", async () => {
    const intg = integrationsDao.upsert("m365", { status: "connected" });
    webhooksDao.create({ integrationId: intg.id, name: "siem", url: "https://x/siem" });

    const job = jobsDao.create({
      name: "wh job",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
      conditionalRules: { mode: "count_gt", threshold: 9999 },
    });

    let captured: WebhookPayload | null = null;
    const exec = await runJob(job, {
      transport: transport([{ id: "1", userPrincipalName: "u@x", status: { errorCode: 1 } }]),
      canSendEmail: true,
      dispatchWebhooks: async (_t, payload) => {
        captured = payload;
        return [{ webhookId: "siem", status: "success" }];
      },
    });

    expect(exec.status).toBe("suppressed");
    expect(exec.webhookDelivered).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.fullHtml).toContain("Daily Sign-in Anomalies");
  });
});
