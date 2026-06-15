import { expect, test, describe } from "bun:test";
import { filterJobs, displayStatus, ALL, type FilterableJob } from "../src/lib/job-filter";

const job = (over: Partial<FilterableJob>): FilterableJob => ({
  name: "Daily Sign-ins",
  reportType: "sign-in-anomalies",
  status: "active",
  tags: [],
  lastRun: { status: "success" },
  ...over,
});

const jobs: FilterableJob[] = [
  job({ name: "Daily Sign-ins", reportType: "sign-in-anomalies", tags: ["security"], lastRun: { status: "success" } }),
  job({ name: "Weekly Risky Users", reportType: "risky-users", tags: ["security", "weekly"], lastRun: { status: "failed" } }),
  job({ name: "Mailbox Quota", reportType: "mailbox-quota", status: "disabled", tags: [], lastRun: { status: "success" } }),
  job({ name: "New Guests", reportType: "guest-accounts", tags: [], lastRun: null }),
];

const base = { query: "", status: ALL, reportType: ALL, tags: [] as string[] };

describe("displayStatus", () => {
  test("disabled job reads disabled regardless of last run", () => {
    expect(displayStatus(job({ status: "disabled", lastRun: { status: "success" } }))).toBe("disabled");
  });
  test("active job uses last run status", () => {
    expect(displayStatus(job({ status: "active", lastRun: { status: "warning" } }))).toBe("warning");
  });
  test("never-run active job reads disabled", () => {
    expect(displayStatus(job({ status: "active", lastRun: null }))).toBe("disabled");
  });
});

describe("filterJobs", () => {
  test("no filters returns all", () => {
    expect(filterJobs(jobs, base)).toHaveLength(4);
  });
  test("query matches job name case-insensitively", () => {
    const r = filterJobs(jobs, { ...base, query: "risky" });
    expect(r.map((j) => j.name)).toEqual(["Weekly Risky Users"]);
  });
  test("query trims whitespace", () => {
    expect(filterJobs(jobs, { ...base, query: "  mailbox  " })).toHaveLength(1);
  });
  test("status filter uses display status", () => {
    expect(filterJobs(jobs, { ...base, status: "failed" }).map((j) => j.name)).toEqual(["Weekly Risky Users"]);
    expect(filterJobs(jobs, { ...base, status: "disabled" }).map((j) => j.name).sort()).toEqual(["Mailbox Quota", "New Guests"]);
  });
  test("report-type filter is exact", () => {
    expect(filterJobs(jobs, { ...base, reportType: "mailbox-quota" })).toHaveLength(1);
  });
  test("tag filter requires all selected tags", () => {
    expect(filterJobs(jobs, { ...base, tags: ["security"] })).toHaveLength(2);
    expect(filterJobs(jobs, { ...base, tags: ["security", "weekly"] }).map((j) => j.name)).toEqual(["Weekly Risky Users"]);
  });
  test("filters compose (AND)", () => {
    const r = filterJobs(jobs, { ...base, query: "weekly", status: "failed", reportType: "risky-users", tags: ["security"] });
    expect(r.map((j) => j.name)).toEqual(["Weekly Risky Users"]);
  });
});
