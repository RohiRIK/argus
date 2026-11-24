import { withRetry } from "@/lib/retry";
import { ArgusError, DispatchError } from "@/lib/errors";
import type { FetchLike } from "@/services/graph/auth";

export interface WebhookTarget {
  id: string;
  name: string;
  url: string;
  secret?: string | null;
  enabled: boolean;
  includeFullHtml: boolean;
}

export interface WebhookPayload {
  executionId: string;
  jobId: string;
  jobName: string;
  suppressionReason: string;
  timestamp: string;
  recordsProcessed: number;
  baselineSnapshot: Record<string, number> | null;
  metadata: Record<string, unknown>;
  fullHtml?: string;
}

export interface WebhookResult {
  webhookId: string;
  status: "success" | "failed";
  error?: string;
}

export interface WebhookDeps {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt HTTP timeout in ms (default 15_000; 0 disables). */
  timeoutMs?: number;
}

const DEFAULT_WEBHOOK_TIMEOUT_MS = 15_000;

/**
 * Deliver a suppressed-execution payload to all enabled webhooks. Each URL is
 * retried independently (3× backoff); one failure does not block the others
 * (graceful degradation, PRD §4.4). Returns a per-URL result list.
 */
export async function dispatchWebhooks(
  targets: WebhookTarget[],
  payload: WebhookPayload,
  deps: WebhookDeps = {},
): Promise<WebhookResult[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  const enabled = targets.filter((t) => t.enabled);

  return Promise.all(
    enabled.map(async (target): Promise<WebhookResult> => {
      const body = JSON.stringify({
        ...payload,
        fullHtml: target.includeFullHtml ? payload.fullHtml : undefined,
      });
      try {
        await withRetry(
          async () => {
            let res: Response;
            try {
              res = await fetchImpl(target.url, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  ...(target.secret ? { "x-argus-secret": target.secret } : {}),
                },
                body,
                ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
              });
            } catch (err) {
              if (err instanceof ArgusError) throw err;
              throw new DispatchError(
                `webhook ${target.name} request failed: ${err instanceof Error ? err.message : String(err)}`,
                { retryable: true, cause: err },
              );
            }
            if (!res.ok) {
              const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
              const raSec = Number(res.headers.get("retry-after"));
              const retryAfterMs = Number.isFinite(raSec) && raSec >= 0 ? raSec * 1000 : undefined;
              throw new DispatchError(`webhook ${target.name} returned ${res.status}`, {
                retryable,
                retryAfterMs,
              });
            }
          },
          { sleep: deps.sleep },
        );
        return { webhookId: target.id, status: "success" };
      } catch (err) {
        return {
          webhookId: target.id,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}
