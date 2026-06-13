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

export interface GraphPage<T> {
  value: T[];
  latencyMs: number;
}

/**
 * Transport seam used by report definitions. The real implementation calls the
 * SDK with retry; tests inject a fake. Returns the `value` array plus measured
 * latency (PRD: Graph API latency tracking).
 */
export interface GraphTransport {
  get<T = unknown>(path: string): Promise<GraphPage<T>>;
}

export const liveGraphTransport: GraphTransport = {
  async get<T>(path: string): Promise<GraphPage<T>> {
    const client = createGraphClient();
    return withRetry(async () => {
      const started = performance.now();
      try {
        const res = (await client.api(path).get()) as { value?: T[] };
        return { value: res.value ?? [], latencyMs: Math.round(performance.now() - started) };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        throw new GraphApiError(`Graph request failed: ${path}`, { graphStatus: status, cause: err });
      }
    });
  },
};
