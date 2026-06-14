import { getEnv } from "@/config/env";
import { runJob, type ExecutorDeps } from "@/services/executor";
import type { Job, Execution } from "@/db/schema";

/**
 * Bounded run queue for scheduled executions (spec AC-S3).
 *
 * Two guarantees:
 *  - **Concurrency cap** — at most ARGUS_MAX_CONCURRENT_RUNS jobs run at once;
 *    excess acquirers wait in FIFO order. Stops a fire-time burst (e.g. every
 *    "daily" job at 08:00) from hammering Graph and getting throttled.
 *  - **Per-job lock** — a job already in flight is not started again; the second
 *    attempt is skipped with a reason rather than overlapping itself.
 *
 * Process-global so HMR / repeated imports share one limiter.
 */
interface QueueState {
  active: number;
  waiters: Array<() => void>;
  inFlight: Set<string>;
}
const g = globalThis as unknown as { __argusRunQueue?: QueueState };
const state: QueueState = (g.__argusRunQueue ??= { active: 0, waiters: [], inFlight: new Set() });

function maxConcurrent(): number {
  return getEnv().ARGUS_MAX_CONCURRENT_RUNS;
}

function acquire(): Promise<void> {
  if (state.active < maxConcurrent()) {
    state.active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    state.waiters.push(() => {
      state.active++;
      resolve();
    });
  });
}

function release(): void {
  state.active--;
  const next = state.waiters.shift();
  if (next) next();
}

/** Run `fn` while holding a concurrency slot (queues if the cap is reached). */
export async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

export interface EnqueueResult {
  ran: boolean;
  reason?: string;
  execution?: Execution;
}

/**
 * Enqueue a job run under the per-job lock + concurrency cap. `run` is injectable
 * for tests; production uses the real executor.
 */
export async function enqueueRun(
  job: Job,
  deps?: ExecutorDeps,
  run: (job: Job, deps?: ExecutorDeps) => Promise<Execution> = runJob,
): Promise<EnqueueResult> {
  if (state.inFlight.has(job.id)) {
    return { ran: false, reason: "already running" };
  }
  state.inFlight.add(job.id);
  try {
    const execution = await withConcurrencyLimit(() => run(job, deps));
    return { ran: true, execution };
  } finally {
    state.inFlight.delete(job.id);
  }
}

/** Current number of in-flight runs (observability / tests). */
export function activeRunCount(): number {
  return state.active;
}

/** Reset the queue (tests only). */
export function resetRunQueue(): void {
  state.active = 0;
  state.waiters.length = 0;
  state.inFlight.clear();
}
