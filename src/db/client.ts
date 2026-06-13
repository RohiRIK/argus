import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getEnv } from "@/config/env";
import * as schema from "./schema";
// Type-only imports — erased at compile. Both `drizzle-orm/bun-sqlite` (its
// driver.js does a top-level `import from "bun:sqlite"`) and the Bun builtin are
// loaded lazily via createRequire() in getDb(), so NO bun:sqlite reference ever
// enters the webpack graph (Next's Node build worker can't resolve the Bun
// scheme). The app runs under Bun at runtime, which provides both.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { Database as BunDatabase } from "bun:sqlite";

export type DB = BunSQLiteDatabase<typeof schema>;

const requireBun = createRequire(import.meta.url);

let sqlite: BunDatabase | null = null;
let db: DB | null = null;

/**
 * Lazily open a single SQLite connection with WAL mode and FK enforcement,
 * wrapped in a typed Drizzle instance. Reused across the process (NFR-6).
 */
export function getDb(): DB {
  if (db) return db;

  const path = getEnv().ARGUS_DB_PATH;
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  // Specifiers built at runtime so webpack's static parser can't see them and
  // try to resolve the Bun scheme (drizzle's driver imports "bun:sqlite") at
  // build time. Both resolve at runtime under Bun.
  const { Database } = requireBun(["bun", "sqlite"].join(":")) as typeof import("bun:sqlite");
  const { drizzle } = requireBun(["drizzle-orm", "bun-sqlite"].join("/")) as typeof import("drizzle-orm/bun-sqlite");

  sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  db = drizzle(sqlite, { schema });
  return db;
}

/** Raw connection escape hatch (PRAGMA checks, health probe). */
export function getRawDb(): BunDatabase {
  if (!sqlite) getDb();
  return sqlite as BunDatabase;
}

/** Close the connection (tests / shutdown). */
export function closeDb(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
}
