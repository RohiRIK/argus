import { usersDao, normalizeUsername } from "@/db/dao/users";
import type { User } from "@/db/schema";
import { ConflictError, UnauthorizedError, ValidationError } from "@/lib/errors";

/**
 * Operator accounts: username + password (argon2id via Bun.password).
 *
 * - First-run setup: while no account exists, the sign-in page offers "create
 *   the admin account". To stop a stranger from claiming a fresh install, that
 *   is only open for SETUP_WINDOW_MS after Argus starts; restart Argus to
 *   reopen it, or create the account on the host with `bun run auth:reset-password`.
 * - Lockout: 5 failed sign-ins for a username lock it for 15 minutes.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const SETUP_WINDOW_MS = 30 * 60_000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const USERNAME_RE = /^[a-z0-9][a-z0-9._@-]{2,63}$/u;

interface AuthState {
  bootedAt: number;
  failures: Map<string, { count: number; lockedUntil: number }>;
}
const g = globalThis as unknown as { __argusAuth?: AuthState };
const state: AuthState = (g.__argusAuth ??= { bootedAt: Date.now(), failures: new Map() });

export function validateUsername(raw: string): string {
  const u = normalizeUsername(raw);
  if (!USERNAME_RE.test(u)) {
    throw new ValidationError("Invalid username", {
      username: "3–64 characters: letters, digits, dot, dash, underscore or @",
    });
  }
  return u;
}

export function validatePassword(pw: string, field = "password"): void {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError("Password too short", { [field]: `At least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (pw.length > 256) throw new ValidationError("Password too long", { [field]: "At most 256 characters" });
}

export function hashPassword(pw: string): Promise<string> {
  return Bun.password.hash(pw, { algorithm: "argon2id" });
}

export function setupStatus(now: number = Date.now()): { needsSetup: boolean; setupOpen: boolean } {
  const needsSetup = usersDao.count() === 0;
  return { needsSetup, setupOpen: needsSetup && now - state.bootedAt < SETUP_WINDOW_MS };
}

/** Create the first admin account (only while none exists and the setup window is open). */
export async function createFirstUser(username: string, password: string, now: number = Date.now()): Promise<User> {
  const s = setupStatus(now);
  if (!s.needsSetup) throw new ConflictError("An account already exists — sign in instead");
  if (!s.setupOpen) {
    throw new ValidationError(
      "First-time setup has timed out. Restart Argus and create the account within 30 minutes, or run `bun run auth:reset-password <username>` on the host.",
    );
  }
  const u = validateUsername(username);
  validatePassword(password);
  return usersDao.create(u, await hashPassword(password));
}

// A real argon2id hash so unknown usernames cost the same as wrong passwords.
let dummyHash: Promise<string> | null = null;

export async function verifyLogin(username: string, password: string, now: number = Date.now()): Promise<User> {
  const key = normalizeUsername(username);
  const f = state.failures.get(key);
  if (f && f.lockedUntil > now) {
    const mins = Math.ceil((f.lockedUntil - now) / 60_000);
    throw new UnauthorizedError(`Too many failed attempts — try again in ${mins} minute(s)`);
  }
  const user = usersDao.findByUsername(key);
  dummyHash ??= hashPassword("argus-dummy-password");
  const ok = await Bun.password.verify(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) {
    const count = (f?.count ?? 0) + 1;
    state.failures.set(key, { count, lockedUntil: count >= MAX_FAILURES ? now + LOCK_MS : 0 });
    throw new UnauthorizedError("Username or password is incorrect");
  }
  state.failures.delete(key);
  usersDao.touchLogin(user.id);
  return user;
}

export async function changePassword(username: string, current: string, next: string): Promise<void> {
  const user = await verifyLogin(username, current);
  validatePassword(next, "newPassword");
  usersDao.setPassword(user.id, await hashPassword(next));
}

/** Host-side recovery: set (or create) an account's password. */
export async function resetPassword(username: string, password: string): Promise<{ created: boolean }> {
  const u = validateUsername(username);
  validatePassword(password);
  const hash = await hashPassword(password);
  const existing = usersDao.findByUsername(u);
  if (existing) {
    usersDao.setPassword(existing.id, hash);
    state.failures.delete(u);
    return { created: false };
  }
  usersDao.create(u, hash);
  return { created: true };
}

/** Tests only. */
export function resetAuthState(bootedAt: number = Date.now()): void {
  state.bootedAt = bootedAt;
  state.failures.clear();
}
