import { eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { users, type User } from "../schema";

const nowIso = () => new Date().toISOString();

/** Usernames are stored lowercased so sign-in is case-insensitive. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const usersDao = {
  count(): number {
    return getDb().select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0;
  },

  findByUsername(username: string): User | undefined {
    return getDb().select().from(users).where(eq(users.username, normalizeUsername(username))).get();
  },

  create(username: string, passwordHash: string): User {
    return getDb()
      .insert(users)
      .values({ id: crypto.randomUUID(), username: normalizeUsername(username), passwordHash })
      .returning()
      .get();
  },

  setPassword(id: string, passwordHash: string): User | undefined {
    return getDb().update(users).set({ passwordHash, updatedAt: nowIso() }).where(eq(users.id, id)).returning().get();
  },

  touchLogin(id: string): void {
    getDb().update(users).set({ lastLoginAt: nowIso() }).where(eq(users.id, id)).run();
  },

  list(): Array<Pick<User, "id" | "username" | "createdAt" | "lastLoginAt">> {
    return getDb()
      .select({ id: users.id, username: users.username, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt })
      .from(users)
      .all();
  },
};
