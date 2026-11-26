import { describe, test, expect } from "bun:test";
import {
  automationRunOutcome,
  automationRunHref,
  automationWorkItem,
  countByKind,
  executionHref,
  filterWorkItems,
  kindSplitLabel,
  logEntryHref,
  reportWorkItem,
  type WorkItem,
} from "../src/lib/work-items";
import { ALL, jobLifecycle, lastOutcome } from "../src/lib/job-filter";

const now = new Date("2026-06-01T00:00:00Z");
const schedule = { scheduleSummary: "Daily", nextRun: "tomorrow", nextRunAt: null };

const policy = (over: Partial<Parameters<typeof automationWorkItem>[0]> = {}) => ({
  id: "p1",
  name: "Disable stale guests",
  description: "",
  automationType: "stale-guest-cleanup",
  mode: "audit" as const,
  status: "active" as const,
  tags: ["guests"],
  snoozedUntil: null,
  ...over,
});

const job = (over: Partial<Parameters<typeof reportWorkItem>[0]> = {}) => ({
  id: "j1",
  name: "Risky users",
  description: "",
  reportType: "risky-users",
  status: "active" as const,
  tags: null,
  snoozedUntil: null,
  ...over,
});

const filter = { query: "", status: ALL, reportType: ALL, tags: [] as string[] };

describe("automationRunOutcome", () => {
  test("maps every automation run status onto the shared outcome vocabulary", () => {
    expect(automationRunOutcome("success")).toBe("success");
    expect(automationRunOutcome("drift_detected")).toBe("drift");
    expect(automationRunOutcome("warning")).toBe("warning");
    expect(automationRunOutcome("failed")).toBe("failed");
    expect(automationRunOutcome("halted")).toBe("halted");
    expect(automationRunOutcome("interrupted")).toBe("interrupted");
    expect(automationRunOutcome("something-new")).toBe("never");
  });
});

describe("reportWorkItem", () => {
  test("keeps job fields and links the last run to its execution", () => {
    const item = reportWorkItem(job(), [
      { id: "e2", status: "failed", startedAt: "2026-05-31T00:00:00Z" },
      { id: "e1", status: "success", startedAt: "2026-05-30T00:00:00Z" },
    ], schedule);
    expect(item.kind).toBe("report");
    expect(item.mode).toBeNull();
    expect(item.tags).toEqual([]);
    expect(item.lastRun).toEqual({ id: "e2", status: "failed", startedAt: "2026-05-31T00:00:00Z" });
    expect(item.recent).toEqual(["failed", "success"]);
    expect(item.lastRunHref).toBe("/executions/e2");
    expect(item.manageHref).toBe("/jobs/j1/edit");
  });

  test("never-run job has no last run link", () => {
    const item = reportWorkItem(job(), [], schedule);
    expect(item.lastRun).toBeNull();
    expect(item.lastRunHref).toBeNull();
    expect(lastOutcome(item)).toBe("never");
  });
});

describe("automationWorkItem", () => {
  test("maps run outcomes, mode, catalog label and run link", () => {
    const item = automationWorkItem(
      policy({ mode: "enforce" }),
      [
        { id: "r2", status: "drift_detected", startedAt: "2026-05-31T00:00:00Z" },
        { id: "r1", status: "halted", startedAt: "2026-05-30T00:00:00Z" },
      ],
      schedule,
      "Stale guest cleanup",
    );
    expect(item.kind).toBe("automation");
    expect(item.mode).toBe("enforce");
    expect(item.reportType).toBe("Stale guest cleanup");
    expect(item.lastRun?.status).toBe("drift");
    expect(lastOutcome(item)).toBe("drift");
    expect(item.recent).toEqual(["drift", "halted"]);
    expect(item.lastRunHref).toBe("/automations/runs/r2");
    expect(item.manageHref).toBe("/automations");
  });

  test("falls back to the automation id when the catalog entry is unknown", () => {
    expect(automationWorkItem(policy(), [], schedule).reportType).toBe("stale-guest-cleanup");
  });

  test("state follows policy status and snooze like jobs", () => {
    expect(jobLifecycle(automationWorkItem(policy({ status: "disabled" }), [], schedule), now)).toBe("paused");
    expect(
      jobLifecycle(automationWorkItem(policy({ snoozedUntil: "2026-06-02T00:00:00Z" }), [], schedule), now),
    ).toBe("snoozed");
    expect(jobLifecycle(automationWorkItem(policy(), [], schedule), now)).toBe("active");
  });
});

describe("filterWorkItems", () => {
  const items: WorkItem[] = [
    reportWorkItem(job(), [{ id: "e1", status: "failed", startedAt: "2026-05-31T00:00:00Z" }], schedule),
    reportWorkItem(job({ id: "j2", name: "Mailbox usage", status: "disabled" }), [], schedule),
    automationWorkItem(policy(), [{ id: "r1", status: "failed", startedAt: "2026-05-31T00:00:00Z" }], schedule),
    automationWorkItem(
      policy({ id: "p2", name: "MFA gaps", status: "disabled" }),
      [{ id: "r2", status: "drift_detected", startedAt: "2026-05-31T00:00:00Z" }],
      schedule,
    ),
  ];
  const ids = (list: WorkItem[]) => list.map((i) => i.id);

  test("type filter splits reports from automations", () => {
    expect(ids(filterWorkItems(items, { ...filter, kind: ALL }, now))).toEqual(["j1", "j2", "p1", "p2"]);
    expect(ids(filterWorkItems(items, { ...filter, kind: "report" }, now))).toEqual(["j1", "j2"]);
    expect(ids(filterWorkItems(items, { ...filter, kind: "automation" }, now))).toEqual(["p1", "p2"]);
  });

  test("state and outcome filters apply to both kinds", () => {
    expect(ids(filterWorkItems(items, { ...filter, lifecycle: "paused" }, now))).toEqual(["j2", "p2"]);
    expect(ids(filterWorkItems(items, { ...filter, outcome: "failed" }, now))).toEqual(["j1", "p1"]);
    expect(ids(filterWorkItems(items, { ...filter, outcome: "drift" }, now))).toEqual(["p2"]);
    expect(ids(filterWorkItems(items, { ...filter, kind: "automation", outcome: "failed" }, now))).toEqual(["p1"]);
  });

  test("counts per kind and the split label", () => {
    const counts = countByKind(items);
    expect(counts).toEqual({ report: 2, automation: 2 });
    expect(kindSplitLabel(counts)).toBe("2 reports · 2 automations");
    expect(kindSplitLabel({ report: 1, automation: 0 })).toBe("1 report · 0 automations");
  });
});

describe("links", () => {
  test("log lines link to their execution or automation run", () => {
    expect(logEntryHref({ source: "report", executionId: "e1", runId: null })).toBe("/executions/e1");
    expect(logEntryHref({ source: "automation", executionId: null, runId: "r1" })).toBe("/automations/runs/r1");
    expect(logEntryHref({ source: "automation", executionId: null, runId: null })).toBeNull();
  });

  test("ids are URL-encoded", () => {
    expect(executionHref("a/b")).toBe("/executions/a%2Fb");
    expect(automationRunHref("a b")).toBe("/automations/runs/a%20b");
  });
});
