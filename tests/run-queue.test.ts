import { describe, test, expect, beforeEach } from "bun:test";
import type { Job, Execution } from "../src/db/schema";

process.env.ARGUS_MAX_CONCURRENT_RUNS = "4";

const { enqueueRun, activeRunCount, resetRunQueue } = await import("../src/services/run-queue");

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const job = (id: string) => ({ id }) as Job;
const fakeExec = {} as Execution;

beforeEach(() => resetRunQueue());

describe("run queue (AC-S3)", () => {
  test("never exceeds the concurrency cap", async () => {
    let peak = 0;
    const run = async (): Promise<Execution> => {
      peak = Math.max(peak, activeRunCount());
      await delay(15);
      return fakeExec;
    };
    const jobs = Array.from({ length: 10 }, (_, i) => job(`j${i}`));
    const results = await Promise.all(jobs.map((j) => enqueueRun(j, undefined, run)));

    expect(results.every((r) => r.ran)).toBe(true);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(0);
    expect(activeRunCount()).toBe(0); // fully drained
  });

  test("a job already in flight is not started again (per-job lock)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = async (): Promise<Execution> => {
      await gate;
      return fakeExec;
    };
    const j = job("dup");
    const first = enqueueRun(j, undefined, run); // holds the lock
    const second = await enqueueRun(j, undefined, run); // rejected while first pending

    expect(second.ran).toBe(false);
    expect(second.reason).toBe("already running");

    release();
    expect((await first).ran).toBe(true);

    // lock released → the same job can run again
    const third = await enqueueRun(j, undefined, async () => fakeExec);
    expect(third.ran).toBe(true);
  });

  test("distinct jobs run in parallel up to the cap", async () => {
    const order: string[] = [];
    const run = (id: string) => async (): Promise<Execution> => {
      order.push(id);
      await delay(5);
      return fakeExec;
    };
    await Promise.all([
      enqueueRun(job("a"), undefined, run("a")),
      enqueueRun(job("b"), undefined, run("b")),
    ]);
    expect(order.sort()).toEqual(["a", "b"]);
  });
});
