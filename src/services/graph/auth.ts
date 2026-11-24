import { withRetry } from "@/lib/retry";
import { GraphAuthError, GraphApiError } from "@/lib/errors";
import { vaultService } from "@/services/vault/vault";
import { signClientAssertion } from "./cert";

const SCOPE = "https://graph.microsoft.com/.default";
const EXPIRY_SKEW_MS = 60_000; // refresh a minute early

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export type Credentials =
  | {
      tenantId: string;
      clientId: string;
      clientSecret: string;
      privateKeyPem?: never;
      x5t?: never;
    }
  | {
      tenantId: string;
      clientId: string;
      privateKeyPem: string;
      x5t: string;
      clientSecret?: string;
    };

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cache: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

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
  const tenantId = vaultService.get("tenantId")?.trim();
  const clientId = vaultService.get("clientId")?.trim();
  const privateKeyPem = vaultService.get("clientPrivateKey");
  const x5t = vaultService.get("certThumbprintX5t");
  const clientSecret = vaultService.get("clientSecret");

  if (!tenantId || !clientId) {
    throw new GraphAuthError("Entra ID credentials are not configured in the vault");
  }
  if (privateKeyPem && x5t) {
    return { tenantId, clientId, privateKeyPem, x5t, clientSecret };
  }
  if (!clientSecret) {
    throw new GraphAuthError("Entra ID credentials are not configured in the vault");
  }
  return { tenantId, clientId, clientSecret };
}

const AADSTS_HINTS: Array<[string, string]> = [
  ["7000215", "Invalid client secret — copy the secret Value (not the Secret ID) or deploy with a certificate."],
  ["7000222", "Client secret expired — rotate the secret or upgrade to X.509 certificate auth."],
  ["700016", "App registration not found in this tenant — verify the Client ID."],
  ["90002", "Tenant not found — verify the Entra ID Tenant ID."],
  ["700027", "Certificate mismatch — public key on Entra App Registration does not match the vault private key."],
];

async function buildTokenError(res: Response): Promise<GraphApiError> {
  const headerReqId = res.headers.get("x-ms-request-id") ?? undefined;
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    error_description?: string;
    error_codes?: number[];
    correlation_id?: string;
    trace_id?: string;
  } | null;

  const requestId = body?.correlation_id ?? headerReqId ?? body?.trace_id;
  const codeMatch = AADSTS_HINTS.find(([code]) =>
    body?.error_codes?.some((c) => String(c) === code) || body?.error_description?.includes(`AADSTS${code}`),
  );
  const firstLine = body?.error_description?.split(/\r?\n/)[0]?.trim();
  const message = codeMatch
    ? `${codeMatch[1]} (${firstLine ?? `HTTP ${res.status}`})`
    : firstLine
      ? `Entra token request failed (${res.status}): ${firstLine}`
      : `Token endpoint returned ${res.status}`;

  const err = new GraphApiError(message, { graphStatus: res.status, requestId });
  const retryAfterSec = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfterSec) && retryAfterSec >= 0) {
    (err as { retryAfterMs?: number }).retryAfterMs = retryAfterSec * 1000;
  }
  return err;
}

/** Acquire an app-only Graph token via certificate assertion or client secret, with caching + single-flight + retry. */
export async function acquireToken(options: AcquireOptions = {}): Promise<string> {
  const now = options.now ?? Date.now;
  if (!options.forceRefresh) {
    if (cache && cache.expiresAt > now() + EXPIRY_SKEW_MS) {
      return cache.token;
    }
    if (inFlight) return inFlight;
  }

  const p = (async () => {
    const creds = options.creds ?? credsFromVault();
    const fetchImpl = options.fetchImpl ?? fetch;
    const url = `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`;

    const result = await withRetry(
      async () => {
        const params: Record<string, string> = {
          client_id: creds.clientId,
          scope: SCOPE,
          grant_type: "client_credentials",
        };
        if ("privateKeyPem" in creds && creds.privateKeyPem && creds.x5t) {
          params.client_assertion_type = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
          params.client_assertion = signClientAssertion({
            tenantId: creds.tenantId,
            clientId: creds.clientId,
            privateKeyPem: creds.privateKeyPem,
            x5t: creds.x5t,
            nowSec: Math.floor(now() / 1000),
          });
        } else if (creds.clientSecret) {
          params.client_secret = creds.clientSecret;
        }
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(params),
        });
        if (!res.ok) {
          throw await buildTokenError(res);
        }
        return (await res.json()) as TokenResponse;
      },
      { sleep: options.sleep },
    );

    cache = { token: result.access_token, expiresAt: now() + result.expires_in * 1000 };
    return cache.token;
  })().finally(() => {
    if (inFlight === p) inFlight = null;
  });

  if (!options.forceRefresh) inFlight = p;
  return p;
}

/** Clear the cached token (tests, secret rotation, disconnect). */
export function clearTokenCache(): void {
  cache = null;
  inFlight = null;
}
