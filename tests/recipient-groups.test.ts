import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GroupGraphClientLike } from "../src/services/graph/groups";

const dir = mkdtempSync(join(tmpdir(), "argus-groups-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");
const { recipientGroupsDao } = await import("../src/db/dao/recipient-groups");
const { jobsDao } = await import("../src/db/dao/jobs");
const { settingsDao } = await import("../src/db/dao/settings");
const {
  createEntraSecurityGroup,
  fetchEntraGroupMembers,
  addEntraGroupMember,
  resolveJobRecipients,
} = await import("../src/services/graph/groups");
const { runJob } = await import("../src/services/executor");
const { PUT: putGroupMembers } = await import("../src/app/api/recipient-groups/[id]/members/route");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("recipient groups DAO, Graph sync & executor integration", () => {
  test("createEntraSecurityGroup posts security-enabled group and maps 403 cleanly", async () => {
    let postedBody: Record<string, unknown> | undefined;
    const okClient: GroupGraphClientLike = {
      api(path) {
        return {
          select() { return this; },
          filter() { return this; },
          top() { return this; },
          async get() { return {}; },
          async delete() { return {}; },
          async post(body) {
            if (path === "/groups") postedBody = body as Record<string, unknown>;
            return { id: "entra-grp-1", displayName: "Argus - SecOps", securityEnabled: true };
          },
        };
      },
    };
    const created = await createEntraSecurityGroup(
      { displayName: "Argus - SecOps", description: "SOC" },
      { client: okClient, directoryWrites: true },
    );
    expect(created.id).toBe("entra-grp-1");
    expect(postedBody?.securityEnabled).toBe(true);
    expect(postedBody?.mailEnabled).toBe(false);

    const deniedClient: GroupGraphClientLike = {
      api() {
        return {
          select() { return this; },
          filter() { return this; },
          top() { return this; },
          async get() { return {}; },
          async delete() { return {}; },
          async post() {
            throw Object.assign(new Error("Authorization_RequestDenied"), { statusCode: 403 });
          },
        };
      },
    };
    await expect(
      createEntraSecurityGroup({ displayName: "Fail" }, { client: deniedClient, directoryWrites: true }),
    ).rejects.toThrow(/Group\.ReadWrite\.All/);
  });

  test("fetchEntraGroupMembers follows pagination & deduplicates, addEntraGroupMember ignores duplicate 400", async () => {
    const pagedClient: GroupGraphClientLike = {
      api(path) {
        return {
          select() { return this; },
          filter() { return this; },
          top() { return this; },
          async post() {
            throw Object.assign(new Error("added object references already exist"), { statusCode: 400 });
          },
          async delete() { return {}; },
          async get() {
            if (path === "/next-page") {
              return {
                value: [
                  { id: "u2", displayName: "Bob", mail: "bob@contoso.com" },
                  { id: "u1-dup", displayName: "Alice", mail: "ALICE@contoso.com" },
                ],
              };
            }
            return {
              value: [{ id: "u1", displayName: "Alice", mail: "alice@contoso.com" }],
              "@odata.nextLink": "/next-page",
            };
          },
        };
      },
    };

    const members = await fetchEntraGroupMembers("entra-grp-1", { client: pagedClient, directoryWrites: true });
    expect(members.map((m) => m.email)).toEqual(["alice@contoso.com", "bob@contoso.com"]);
    await addEntraGroupMember("entra-grp-1", "u1", { client: pagedClient, directoryWrites: true });
  });

  test("resolveJobRecipients merges direct + groups, falls back on global, and degrades to cache on Graph error", async () => {
    const g = recipientGroupsDao.create({
      name: "SOC Team",
      description: "Test",
      entraGroupId: "entra-soc",
      entraDisplayName: "SOC Team",
      managedByArgus: true,
      staticMembers: ["oncall@contoso.com", "alice@contoso.com"],
      cachedEntraMembers: [{ id: "u1", displayName: "Alice", email: "alice@contoso.com", source: "entra" }],
    });

    const failingClient: GroupGraphClientLike = {
      api() {
        return {
          select() { return this; },
          filter() { return this; },
          top() { return this; },
          async post() { return {}; },
          async delete() { return {}; },
          async get() {
            throw Object.assign(new Error("Transient Graph failure"), { statusCode: 503 });
          },
        };
      },
    };

    const jobScoped = await resolveJobRecipients(
      {
        directRecipients: ["direct@contoso.com"],
        groupIds: [g.id],
        globalRecipients: ["global@contoso.com"],
        globalGroupIds: [],
        syncLive: true,
      },
      { client: failingClient },
    );
    expect(jobScoped.emails).toEqual(["direct@contoso.com", "alice@contoso.com", "oncall@contoso.com"]);
    expect(jobScoped.warnings[0]).toContain("using cached members");

    const globalFallback = await resolveJobRecipients({
      directRecipients: [],
      groupIds: [],
      globalRecipients: [],
      globalGroupIds: [g.id],
      syncLive: false,
    });
    expect(globalFallback.emails).toEqual(["alice@contoso.com", "oncall@contoso.com"]);

    // Delete cascades out of referencing jobs & settings.
    const job = jobsDao.create({
      name: "Group Cleanup Job",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
      recipientGroupIds: [g.id],
    });
    settingsDao.update({ globalRecipientGroupIds: [g.id] });
    recipientGroupsDao.delete(g.id);
    expect(jobsDao.findById(job.id)?.recipientGroupIds).toEqual([]);
    expect(settingsDao.get().globalRecipientGroupIds).toEqual([]);
  });

  test("executor delivers report emails to recipients expanded from attached groups", async () => {
    const g = recipientGroupsDao.create({
      name: "IAM Group",
      description: "",
      staticMembers: ["iam1@contoso.com", "iam2@contoso.com"],
      cachedEntraMembers: [],
    });
    const job = jobsDao.create({
      name: "Exec Group Job",
      reportType: "sign-in-anomalies",
      scheduleType: "preset",
      schedulePreset: "daily",
      recipients: [],
      recipientGroupIds: [g.id],
    });

    const deliveredTo: string[][] = [];
    const exec = await runJob(job, {
      canSendEmail: true,
      transport: {
        async get<T = unknown>() {
          return {
            value: [{ userPrincipalName: "bob@contoso.com", status: { errorCode: 50126 } }] as T[],
            latencyMs: 5,
          };
        },
        async batch() {
          return [];
        },
      },
      email: {
        async send(m) {
          deliveredTo.push(m.to);
        },
      },
    });
    expect(exec.status).toBe("success");
    expect(deliveredTo).toEqual([["iam1@contoso.com", "iam2@contoso.com"]]);
  });

  test("PUT /api/recipient-groups/:id/members batches static additions and removals in a single save", async () => {
    const g = recipientGroupsDao.create({
      name: "Batch Static Group",
      description: "",
      staticMembers: ["keep@contoso.com", "old@contoso.com"],
      cachedEntraMembers: [],
    });

    const req = new Request(`http://localhost/api/recipient-groups/${g.id}/members`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        addStaticEmails: ["new1@contoso.com", "NEW1@contoso.com", "new2@contoso.com", "keep@contoso.com"],
        removeStaticEmails: ["OLD@contoso.com"],
      }),
    });
    const res = await putGroupMembers(req, { params: Promise.resolve({ id: g.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { resolvedEmails: string[]; memberCount: number; staticMembers: string[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.staticMembers).toEqual(["keep@contoso.com", "new1@contoso.com", "new2@contoso.com"]);
    expect(body.data.resolvedEmails).toEqual(["keep@contoso.com", "new1@contoso.com", "new2@contoso.com"]);
    expect(body.data.memberCount).toBe(3);
  });
});
