import { withRetry } from "@/lib/retry";
import { GraphAuthError, GraphApiError } from "@/lib/errors";
import { vaultService } from "@/services/vault/vault";

const SCOPE = "https://graph.microsoft.com/.default";
const EXPIRY_SKEW_MS = 60_000; // refresh a minute early

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface Credentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cache: CachedToken | null = null;

/** Minimal fetch shape — avoids Bun's `typeof fetch` (which requires `preconnect`). */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface AcquireOptions {
  /** Inject creds directly (tests); defaults to the encrypted vault. */
  creds?: Credentials;
  /** Injectable fetch (tests). */
  fetchImpl?: FetchLike;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Bypass the in-memory cache. */
  forceRefresh?: boolean;
  /** Forwarded to withRetry (tests pass a no-op sleep). */
  sleep?: (ms: number) => Promise<void>;
}

function credsFromVault(): Credentials {
  const tenantId = vaultService.get("tenantId");
  const clientId = vaultService.get("clientId");
  const clientSecret = vaultService.get("clientSecret");
  if (!tenantId || !clientId || !clientSecret) {
    throw new GraphAuthError("Entra ID credentials are not configured in the vault");
  }
  return { tenantId, clientId, clientSecret };
}

/** Acquire an app-only Graph token via client-credentials, with caching + retry. */
export async function acquireToken(options: AcquireOptions = {}): Promise<string> {
  const now = options.now ?? Date.now;
  if (!options.forceRefresh && cache && cache.expiresAt > now() + EXPIRY_SKEW_MS) {
    return cache.token;
  }

  const creds = options.creds ?? credsFromVault();
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`;

  const result = await withRetry(
    async () => {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          scope: SCOPE,
          grant_type: "client_credentials",
        }),
      });
      if (!res.ok) {
        const err = new GraphApiError(`Token endpoint returned ${res.status}`, {
          graphStatus: res.status,
        });
        const retryAfterSec = Number(res.headers.get("retry-after"));
        if (Number.isFinite(retryAfterSec) && retryAfterSec >= 0) {
          (err as { retryAfterMs?: number }).retryAfterMs = retryAfterSec * 1000;
        }
        throw err;
      }
      return (await res.json()) as TokenResponse;
    },
    { sleep: options.sleep },
  );

  cache = { token: result.access_token, expiresAt: now() + result.expires_in * 1000 };
  return cache.token;
}

/** Clear the cached token (tests, secret rotation, disconnect). */
export function clearTokenCache(): void {
  cache = null;
}
