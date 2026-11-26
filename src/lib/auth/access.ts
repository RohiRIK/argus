/**
 * Operator access gate (plan H1).
 *
 * Argus keeps exactly one secret in the environment: ARGUS_MASTER_KEY. The
 * operator access key and the session-signing key are both derived from it
 * with HMAC-SHA256 under distinct labels, so enabling the gate adds no new
 * secret to `.env`. Rotating the master key rotates the access key and
 * invalidates every session.
 *
 * Uses Web Crypto only (no node:crypto, no DB) so it is safe to import from
 * `src/proxy.ts` as well as route handlers and the CLI script.
 */

export const SESSION_COOKIE = "argus_session";
/** Sessions last 12 hours; the operator signs in again after that. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ACCESS_KEY_PREFIX = "argus_";

const ACCESS_LABEL = "argus:access-key:v1";
const SESSION_LABEL = "argus:session:v1";
const TOKEN_VERSION = "v1";

export type AuthMode = "access-key" | "off";

const enc = new TextEncoder();

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

async function hmac(keyBytes: Uint8Array, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return crypto.subtle.sign("HMAC", key, enc.encode(message));
}

/** Length-independent-of-content comparison for equal-length strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function assertMasterKey(masterKeyHex: string): void {
  if (!/^[0-9a-fA-F]{64}$/u.test(masterKeyHex)) {
    throw new Error("ARGUS_MASTER_KEY must be 64 hex characters");
  }
}

/** The operator access key shown by `bun run auth:access-key`. */
export async function deriveAccessKey(masterKeyHex: string): Promise<string> {
  assertMasterKey(masterKeyHex);
  return ACCESS_KEY_PREFIX + toBase64Url(await hmac(hexToBytes(masterKeyHex), ACCESS_LABEL));
}

async function sessionKey(masterKeyHex: string): Promise<Uint8Array> {
  assertMasterKey(masterKeyHex);
  return new Uint8Array(await hmac(hexToBytes(masterKeyHex), SESSION_LABEL));
}

export async function verifyAccessKey(masterKeyHex: string, candidate: string): Promise<boolean> {
  const expected = await deriveAccessKey(masterKeyHex);
  return timingSafeEqual(expected, candidate.trim());
}

/** Issue a signed, expiring session token: `v1.<expiresAtMs>.<sig>`. */
export async function createSessionToken(
  masterKeyHex: string,
  now: number = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = `${TOKEN_VERSION}.${expiresAt}`;
  const sig = toBase64Url(await hmac(await sessionKey(masterKeyHex), payload));
  return { token: `${payload}.${sig}`, expiresAt };
}

export async function verifySessionToken(
  masterKeyHex: string,
  token: string | undefined | null,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  const expected = toBase64Url(await hmac(await sessionKey(masterKeyHex), `${parts[0]}.${parts[1]}`));
  return timingSafeEqual(expected, parts[2] ?? "");
}

/** Read the gate mode from the environment. Anything but an explicit "off" means on. */
export function authMode(env: Record<string, string | undefined> = process.env): AuthMode {
  return env.ARGUS_AUTH_MODE === "off" ? "off" : "access-key";
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

/**
 * True when the request carries a valid session cookie or an
 * `Authorization: Bearer <access key>` header (for scripts and smoke checks).
 * Always true when the gate is off.
 */
export async function isAuthenticated(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (authMode(env) === "off") return true;
  const master = env.ARGUS_MASTER_KEY;
  if (!master || !/^[0-9a-fA-F]{64}$/u.test(master)) return false;

  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    return verifyAccessKey(master, authz.slice(7));
  }
  return verifySessionToken(master, readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

/** Paths reachable without a session. Keep this list intentionally tiny. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/health" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/icon.svg" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/_next/")
  );
}

/** Only allow same-site relative redirects after login (no `//host` or schemes). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  if (next.startsWith("/login") || next.startsWith("/api/")) return "/dashboard";
  return next;
}
