import { createHash, randomBytes } from "node:crypto";
import { settingsDao } from "@/db/dao/settings";
import { usersDao, normalizeUsername } from "@/db/dao/users";
import { auditDao } from "@/db/dao/audit";
import type { EntraSignInConfig, User } from "@/db/schema";
import { vaultService } from "@/services/vault/vault";
import { acquireToken } from "@/services/graph/auth";
import { signClientAssertion } from "@/services/graph/cert";
import { highestRole, type Role, ROLES } from "@/lib/auth/roles";
import { UnauthorizedError } from "@/lib/errors";

/**
 * "Sign in with Microsoft" (OpenID Connect, authorization code + PKCE) against the
 * tenant's existing Argus app registration. The role comes from Entra group
 * membership, checked with the app's own Graph permission at every sign-in:
 * an admin maps one security group per role on the Users page, and the
 * highest matching role wins. No matching group → no access.
 *
 * The ID token is received directly from the token endpoint over TLS (back channel),
 * so per OIDC Core §3.1.3.7 its claims are validated (issuer, audience, tenant,
 * nonce, expiry) without a JWKS signature check.
 */

export { SIGNIN_CALLBACK_PATH } from "@/lib/auth/paths";
import { SIGNIN_CALLBACK_PATH } from "@/lib/auth/paths";
export const OIDC_COOKIE = "argus_oidc";
export const OIDC_COOKIE_MAX_AGE = 10 * 60;
const SCOPES = "openid profile email";

type FetchLike = typeof fetch;

export interface SignInAvailability {
  enabled: boolean;
  /** Ready to show the button: enabled, app connected and at least one group mapped. */
  available: boolean;
  reason?: string;
}

export function signInConfig(): EntraSignInConfig {
  return settingsDao.get().entraSignIn;
}

export function signInAvailability(): SignInAvailability {
  const cfg = signInConfig();
  if (!cfg.enabled) return { enabled: false, available: false, reason: "Microsoft sign-in is turned off." };
  if (!vaultService.get("tenantId") || !vaultService.get("clientId")) {
    return { enabled: true, available: false, reason: "Connect Microsoft 365 first." };
  }
  if (!ROLES.some((r) => cfg.groups[r])) {
    return { enabled: true, available: false, reason: "Map at least one Entra group to a role." };
  }
  return { enabled: true, available: true };
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** One sign-in attempt's secrets, kept in a short-lived httpOnly cookie. */
export interface OidcAttempt {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

export function newAttempt(next: string): OidcAttempt {
  return { state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), next };
}

export function encodeAttempt(a: OidcAttempt): string {
  return Buffer.from(JSON.stringify(a), "utf8").toString("base64url");
}

export function decodeAttempt(raw: string | undefined): OidcAttempt | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<OidcAttempt>;
    if (typeof v.state === "string" && typeof v.nonce === "string" && typeof v.verifier === "string" && typeof v.next === "string") {
      return v as OidcAttempt;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function authorizeUrl(a: OidcAttempt, redirectUri: string): string {
  const tenantId = vaultService.get("tenantId") ?? "";
  const clientId = vaultService.get("clientId") ?? "";
  const challenge = b64url(createHash("sha256").update(a.verifier).digest());
  const qs = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state: a.state,
    nonce: a.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${qs}`;
}

/** Exchange the code (with the PKCE verifier) for an ID token, authenticating as the Argus app. */
export async function exchangeCodeForIdToken(
  code: string,
  verifier: string,
  redirectUri: string,
  deps: { fetch?: FetchLike } = {},
): Promise<string> {
  const f = deps.fetch ?? fetch;
  const tenantId = vaultService.get("tenantId") ?? "";
  const clientId = vaultService.get("clientId") ?? "";
  const privateKeyPem = vaultService.get("clientPrivateKey");
  const x5t = vaultService.get("certThumbprintX5t");
  const clientSecret = vaultService.get("clientSecret");
  const params: Record<string, string> = {
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: SCOPES,
  };
  if (privateKeyPem && x5t) {
    params.client_assertion_type = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
    params.client_assertion = signClientAssertion({ tenantId, clientId, privateKeyPem, x5t });
  } else if (clientSecret) {
    params.client_secret = clientSecret;
  }
  const res = await f(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error_description?: string; error?: string };
  if (!res.ok || !json.id_token) {
    throw new UnauthorizedError(`Microsoft sign-in failed: ${json.error_description?.split("\r\n")[0] ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json.id_token;
}

export interface EntraClaims {
  oid: string;
  tid: string;
  username: string;
  name: string | null;
  email: string | null;
}

/** Validate the back-channel ID token's claims and pull out who signed in. */
export function parseIdToken(
  idToken: string,
  expected: { tenantId: string; clientId: string; nonce: string; now?: number },
): EntraClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new UnauthorizedError("Microsoft sign-in returned an invalid token.");
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new UnauthorizedError("Microsoft sign-in returned an invalid token.");
  }
  const now = Math.floor((expected.now ?? Date.now()) / 1000);
  const skew = 300;
  const tid = String(c.tid ?? "");
  const fail = (why: string) => new UnauthorizedError(`Microsoft sign-in was rejected (${why}).`);
  if (c.iss !== `https://login.microsoftonline.com/${expected.tenantId}/v2.0`) throw fail("issuer");
  if (c.aud !== expected.clientId) throw fail("audience");
  if (tid !== expected.tenantId) throw fail("tenant");
  if (c.nonce !== expected.nonce) throw fail("nonce");
  if (typeof c.exp !== "number" || c.exp + skew < now) throw fail("expired");
  if (typeof c.nbf === "number" && c.nbf - skew > now) throw fail("not yet valid");
  const oid = typeof c.oid === "string" ? c.oid : "";
  const upn = typeof c.preferred_username === "string" ? c.preferred_username : "";
  if (!oid || !upn) throw fail("missing user id");
  return {
    oid,
    tid,
    username: normalizeUsername(upn),
    name: typeof c.name === "string" ? c.name : null,
    email: typeof c.email === "string" ? c.email : upn.includes("@") ? upn : null,
  };
}

/** The user's role from Entra group membership (transitive), or null when in no mapped group. */
export async function roleFromGroups(
  oid: string,
  cfg: EntraSignInConfig,
  deps: { fetch?: FetchLike; token?: () => Promise<string> } = {},
): Promise<Role | null> {
  const byGroup = new Map<string, Role>();
  for (const r of ROLES) {
    const g = cfg.groups[r];
    if (g?.id) byGroup.set(g.id, r);
  }
  if (byGroup.size === 0) return null;
  const f = deps.fetch ?? fetch;
  const token = await (deps.token ?? (() => acquireToken()))();
  const res = await f(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(oid)}/checkMemberGroups`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ groupIds: [...byGroup.keys()] }),
  });
  const json = (await res.json().catch(() => ({}))) as { value?: string[]; error?: { message?: string } };
  if (!res.ok) throw new UnauthorizedError(`Couldn't check your Entra groups: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return highestRole((json.value ?? []).map((id) => byGroup.get(id)).filter((r): r is Role => Boolean(r)));
}

/**
 * Create or refresh the Argus account for a Microsoft user. The role is reset from
 * groups on every sign-in. A local account with the same name is never taken over.
 */
export function upsertEntraUser(claims: EntraClaims, role: Role): User {
  const existing = usersDao.findByEntraOid(claims.oid);
  if (existing) {
    if (existing.disabledAt) throw new UnauthorizedError("Your Argus account is disabled. Ask an Argus admin.");
    const updated = usersDao.update(existing.id, {
      role,
      displayName: claims.name,
      email: claims.email,
      username: claims.username,
    })!;
    usersDao.touchLogin(updated.id);
    if (existing.role !== role) {
      auditDao.record({
        action: "user.role_change",
        outcome: "success",
        detail: { username: updated.username, actor: "entra-groups", from: existing.role, to: role },
      });
    }
    return updated;
  }
  if (usersDao.findByUsername(claims.username)) {
    throw new UnauthorizedError(`A local Argus account already uses "${claims.username}". Ask an admin to rename or remove it.`);
  }
  const created = usersDao.create(claims.username, "", {
    role,
    authSource: "entra",
    entraOid: claims.oid,
    displayName: claims.name,
    email: claims.email,
  });
  usersDao.touchLogin(created.id);
  auditDao.record({ action: "user.create", outcome: "success", detail: { username: created.username, actor: "entra-groups", role } });
  return created;
}
