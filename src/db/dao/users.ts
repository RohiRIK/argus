import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import { users, type User, type UserRole } from "../schema";

const nowIso = () => new Date().toISOString();

/** Usernames are stored lowercased so sign-in is case-insensitive. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Safe-to-show user fields (never the password hash). */
export type UserSummary = Omit<User, "passwordHash">;

export interface NewUserOptions {
  role?: UserRole;
  authSource?: User["authSource"];
  entraOid?: string | null;
  displayName?: string | null;
  email?: string | null;
  invitedAt?: string | null;
}

const summaryColumns = {
  id: users.id,
  username: users.username,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  lastLoginAt: users.lastLoginAt,
  role: users.role,
  disabledAt: users.disabledAt,
  authSource: users.authSource,
  entraOid: users.entraOid,
  displayName: users.displayName,
  email: users.email,
  invitedAt: users.invitedAt,
};

export const usersDao = {
  count(): number {
    return getDb().select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0;
  },

  /**
   * Admins that can actually sign in (enabled, and not a pending Microsoft invitation):
   * the last one must never be removed, disabled or demoted.
   */
  countActiveAdmins(): number {
    return (
      getDb()
        .select({ n: sql<number>`count(*)` })
        .from(users)
        .where(
          and(
            eq(users.role, "admin"),
            isNull(users.disabledAt),
            or(eq(users.authSource, "local"), isNotNull(users.lastLoginAt)),
          ),
        )
        .get()?.n ?? 0
    );
  },

  findByUsername(username: string): User | undefined {
    return getDb().select().from(users).where(eq(users.username, normalizeUsername(username))).get();
  },

  findById(id: string): User | undefined {
    return getDb().select().from(users).where(eq(users.id, id)).get();
  },

  findByEntraOid(oid: string): User | undefined {
    return getDb().select().from(users).where(eq(users.entraOid, oid)).get();
  },

  create(username: string, passwordHash: string, opts: NewUserOptions = {}): User {
    return getDb()
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        username: normalizeUsername(username),
        passwordHash,
        role: opts.role ?? "admin",
        authSource: opts.authSource ?? "local",
        entraOid: opts.entraOid ?? null,
        displayName: opts.displayName ?? null,
        email: opts.email ?? null,
        invitedAt: opts.invitedAt ?? null,
      })
      .returning()
      .get();
  },

  update(
    id: string,
    patch: Partial<Pick<User, "role" | "disabledAt" | "displayName" | "email" | "username" | "invitedAt">>,
  ): User | undefined {
    return getDb()
      .update(users)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(users.id, id))
      .returning()
      .get();
  },

  setPassword(id: string, passwordHash: string): User | undefined {
    return getDb().update(users).set({ passwordHash, updatedAt: nowIso() }).where(eq(users.id, id)).returning().get();
  },

  touchLogin(id: string): void {
    getDb().update(users).set({ lastLoginAt: nowIso() }).where(eq(users.id, id)).run();
  },

  delete(id: string): void {
    getDb().delete(users).where(eq(users.id, id)).run();
  },

  list(): UserSummary[] {
    return getDb().select(summaryColumns).from(users).orderBy(users.username).all();
  },
};
