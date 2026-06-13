import { isRetryable } from "./errors";

export interface RetryOptions {
  /** Total attempts including the first (default 3 → 1 try + 2 retries). */
  attempts?: number;
  /** Base backoff in ms; doubles each attempt (default 500). */
  baseMs?: number;
  /** Backoff ceiling in ms (default 30_000). */
  maxMs?: number;
  /** Add random jitter up to baseMs (default true). */
  jitter?: boolean;
  /** Decide whether an error is worth retrying (default: ArgusError.retryable). */
  shouldRetry?: (err: unknown) => boolean;
  /** Observe each retry (logging). */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/** Honors an explicit retry-after hint carried on the error. */
function retryAfterMs(err: unknown): number | undefined {
  const ms = (err as { retryAfterMs?: unknown })?.retryAfterMs;
  return typeof ms === "number" && ms >= 0 ? ms : undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn` with exponential backoff (spec §7, NFR-5). Retries only when
 * `shouldRetry` is true and attempts remain; otherwise rethrows the last error.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseMs = 500,
    maxMs = 30_000,
    jitter = true,
    shouldRetry = isRetryable,
    onRetry,
    sleep = defaultSleep,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const exhausted = attempt >= attempts;
      if (exhausted || !shouldRetry(err)) throw err;

      const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delay = retryAfterMs(err) ?? backoff + (jitter ? Math.random() * baseMs : 0);
      onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  // Unreachable (loop either returns or throws), but satisfies the type checker.
  throw lastError;
}
