import { Client, type AuthenticationProvider } from "@microsoft/microsoft-graph-client";
import { withRetry } from "@/lib/retry";
import { GraphApiError } from "@/lib/errors";
import { acquireToken } from "./auth";

/** Auth provider that hands the Graph SDK a fresh app-only token. */
class VaultAuthProvider implements AuthenticationProvider {
  async getAccessToken(): Promise<string> {
    return acquireToken();
  }
}

/** Build a Graph SDK client backed by the encrypted-vault credentials. */
export function createGraphClient(): Client {
  return Client.initWithMiddleware({ authProvider: new VaultAuthProvider() });
}

// Reused across requests (AC-G1): building the middleware chain per call is
// wasteful, and the auth provider already refreshes the cached token itself.
let sharedClient: Client | null = null;
/** The reused client, created on first use (AC-G1). */
export function getSharedGraphClient(): Client {
  if (!sharedClient) {
    sharedClient = createGraphClient();
    factoryCalls++;
  }
  return sharedClient;
}
const getGraphClient = getSharedGraphClient;

/** Drop the shared client (credential rotation / tests). */
export function resetGraphClient(): void {
  sharedClient = null;
}

/** Count of times the real client factory has run (AC-G1 reuse assertion). */
let factoryCalls = 0;
export function graphClientFactoryCalls(): number {
  return factoryCalls;
}

/** Inject a fake client (tests only) so transport logic runs without the SDK. */
export function __setGraphClientForTests(client: unknown): void {
  sharedClient = client as Client;
}

/** Hard cap on pages followed per request — guards against runaway paging. */
const MAX_PAGES = 50;

export interface GraphPage<T> {
  value: T[];
  latencyMs: number;
  /** True when MAX_PAGES was hit and results may be truncated. */
  truncated?: boolean;
}

/** Graph error shape after a `@odata.nextLink` page or a failed request. */
interface GraphListResponse<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

/**
 * Pull a `Retry-After` hint (seconds) off an unknown Graph error in whatever
 * shape the SDK surfaces it, returning milliseconds. Pure + unit-tested so the
 * throttling contract (AC-G4) doesn't depend on the live SDK.
 */
export function retryAfterMsFromError(err: unknown): number | undefined {
  const e = err as {
    retryAfterMs?: unknown;
    headers?: { get?: (k: string) => string | null } | Record<string, unknown>;
  };
  if (typeof e?.retryAfterMs === "number" && e.retryAfterMs >= 0) return e.retryAfterMs;

  const h = e?.headers;
  let raw: unknown;
  if (h && typeof (h as { get?: unknown }).get === "function") {
    raw = (h as { get: (k: string) => string | null }).get("retry-after");
  } else if (h && typeof h === "object") {
    const rec = h as Record<string, unknown>;
    raw = rec["retry-after"] ?? rec["Retry-After"];
  }
  const sec = Number(raw);
  return Number.isFinite(sec) && sec >= 0 ? sec * 1000 : undefined;
}

/**
 * Transport seam used by report definitions. The real implementation calls the
 * SDK with retry + pagination; tests inject a fake. Returns the concatenated
 * `value` arrays plus total measured latency (PRD: Graph API latency tracking).
 */
export interface GraphTransport {
  get<T = unknown>(path: string): Promise<GraphPage<T>>;
  /** JSON `$batch` (≤20 requests/chunk). Optional; reports may not use it. */
  batch?(requests: GraphBatchRequest[]): Promise<GraphBatchResponse[]>;
}

export interface GraphBatchRequest {
  id: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}
export interface GraphBatchResponse {
  id: string;
  status: number;
  body?: unknown;
}

const BATCH_LIMIT = 20;

export const liveGraphTransport: GraphTransport = {
  async get<T>(path: string): Promise<GraphPage<T>> {
    const client = getGraphClient();
    const started = performance.now();
    const value: T[] = [];
    let nextUrl: string | undefined = path;
    let pages = 0;
    let truncated = false;

    while (nextUrl) {
      if (pages >= MAX_PAGES) {
        truncated = true;
        // eslint-disable-next-line no-console
        console.warn(`[argus] Graph paging hit ${MAX_PAGES}-page cap for ${path}; results truncated`);
        break;
      }
      const url: string = nextUrl;
      const res = await withRetry(
        async () => {
          try {
            return (await client.api(url).get()) as GraphListResponse<T>;
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            const gErr = new GraphApiError(`Graph request failed: ${url}`, {
              graphStatus: status,
              cause: err,
            });
            const ra = retryAfterMsFromError(err);
            if (ra !== undefined) (gErr as { retryAfterMs?: number }).retryAfterMs = ra;
            throw gErr;
          }
        },
      );
      if (res.value?.length) value.push(...res.value);
      nextUrl = res["@odata.nextLink"];
      pages++;
    }

    return { value, latencyMs: Math.round(performance.now() - started), truncated };
  },

  async batch(requests: GraphBatchRequest[]): Promise<GraphBatchResponse[]> {
    const client = getGraphClient();
    const out: GraphBatchResponse[] = [];
    for (let i = 0; i < requests.length; i += BATCH_LIMIT) {
      const chunk = requests.slice(i, i + BATCH_LIMIT);
      const res = await withRetry(async () => {
        try {
          return (await client.api("/$batch").post({ requests: chunk })) as {
            responses?: GraphBatchResponse[];
          };
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          const gErr = new GraphApiError("Graph $batch failed", { graphStatus: status, cause: err });
          const ra = retryAfterMsFromError(err);
          if (ra !== undefined) (gErr as { retryAfterMs?: number }).retryAfterMs = ra;
          throw gErr;
        }
      });
      if (res.responses?.length) out.push(...res.responses);
    }
    return out;
  },
};
