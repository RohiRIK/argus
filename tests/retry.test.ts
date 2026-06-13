import { describe, test, expect } from "bun:test";
import { withRetry } from "../src/lib/retry";
import { GraphApiError, ValidationError } from "../src/lib/errors";

const noSleep = async () => {};

describe("withRetry (NFR-5)", () => {
  test("returns on first success without retrying", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries a retryable error then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new GraphApiError("503", { graphStatus: 503 });
        return "recovered";
      },
      { sleep: noSleep },
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  test("exhausts exactly `attempts` times then throws (3 by default)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new GraphApiError("500", { graphStatus: 500 });
        },
        { sleep: noSleep },
      ),
    ).rejects.toBeInstanceOf(GraphApiError);
    expect(calls).toBe(3);
  });

  test("does not retry a non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new ValidationError("bad");
        },
        { sleep: noSleep },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toBe(1);
  });

  test("backoff increases per attempt (exponential)", async () => {
    const delays: number[] = [];
    await withRetry(
      async () => {
        throw new GraphApiError("500", { graphStatus: 500 });
      },
      {
        attempts: 4,
        baseMs: 100,
        jitter: false,
        sleep: noSleep,
        onRetry: (_e, _a, delay) => delays.push(delay),
      },
    ).catch(() => {});
    expect(delays).toEqual([100, 200, 400]); // 2^0, 2^1, 2^2 * base
  });

  test("honors retryAfterMs hint on the error", async () => {
    const delays: number[] = [];
    await withRetry(
      async () => {
        const err = new GraphApiError("429", { graphStatus: 429 });
        (err as { retryAfterMs?: number }).retryAfterMs = 7000;
        throw err;
      },
      { baseMs: 100, jitter: false, sleep: noSleep, onRetry: (_e, _a, d) => delays.push(d) },
    ).catch(() => {});
    expect(delays.every((d) => d === 7000)).toBe(true);
  });
});
