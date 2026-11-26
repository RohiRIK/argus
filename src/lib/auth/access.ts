/**
 * Operator access gate (plan H1).
 *
 * Operators sign in with a username and password (users table, argon2id).
 * A successful sign-in issues an HMAC-signed session cookie that names the
 * user; this module verifies it without touching the database so it can run
 * in `src/proxy.ts`. The signing key is derived from ARGUS_MASTER_KEY, so no
 * extra secret is needed; rotating the master key ends every session.
 *
 * A machine access key (also derived from the master key) is still accepted
 * as `Authorization: Bearer` for scripts and CI smoke checks. It is not shown
 * in the UI.
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
const TOKEN_VERSION = "v2";
/** Identity reported for requests authenticated with the machine access key. */
export const API_KEY_USER = "api-key";

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

function encodeUser(username: string): string {
  return toBase64Url(enc.encode(username).buffer as ArrayBuffer);
}

function decodeUser(b64: string): string | null {
  try {
    const bin = atob(b64.replace(/-/gu, "+").replace(/_/gu, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Issue a signed, expiring session token: `v2.<expiresAtMs>.<user b64url>.<sig>`. */
export async function createSessionToken(
  masterKeyHex: string,
  username: string,
  now: number = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = `${TOKEN_VERSION}.${expiresAt}.${encodeUser(username)}`;
  const sig = toBase64Url(await hmac(await sessionKey(masterKeyHex), payload));
  return { token: `${payload}.${sig}`, expiresAt };
}

/** The username in a valid, unexpired session token, or null. */
export async function readSessionToken(
  masterKeyHex: string,
  token: string | undefined | null,
  now: number = Date.now(),
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  const expected = toBase64Url(await hmac(await sessionKey(masterKeyHex), `${parts[0]}.${parts[1]}.${parts[2]}`));
  if (!timingSafeEqual(expected, parts[3] ?? "")) return null;
  return decodeUser(parts[2] ?? "");
}

export async function verifySessionToken(
  masterKeyHex: string,
  token: string | undefined | null,
  now: number = Date.now(),
): Promise<boolean> {
  return (await readSessionToken(masterKeyHex, token, now)) !== null;
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
 * Who is making this request: the signed-in username (session cookie), the
 * machine identity for `Authorization: Bearer <access key>`, or null. When the
 * gate is off every request is "anonymous".
 */
export async function authenticate(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  if (authMode(env) === "off") return "anonymous";
  const master = env.ARGUS_MASTER_KEY;
  if (!master || !/^[0-9a-fA-F]{64}$/u.test(master)) return null;

  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    return (await verifyAccessKey(master, authz.slice(7))) ? API_KEY_USER : null;
  }
  return readSessionToken(master, readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

export async function isAuthenticated(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  return (await authenticate(req, env)) !== null;
}

/** Header the proxy sets with the authenticated identity (client-sent values are dropped). */
export const USER_HEADER = "x-argus-user";
/** Header the proxy sets with that identity's role (client-sent values are dropped). */
export const ROLE_HEADER = "x-argus-role";

/** Paths reachable without a session. Keep this list intentionally tiny. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/health" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/setup" ||
    pathname === "/api/auth/providers" ||
    pathname === "/api/auth/microsoft/start" ||
    pathname === "/api/auth/microsoft/callback" ||
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
