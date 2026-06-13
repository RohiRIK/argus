import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getEnv } from "@/config/env";
import * as schema from "./schema";

export type DB = BunSQLiteDatabase<typeof schema>;

let sqlite: Database | null = null;
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

  sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  db = drizzle(sqlite, { schema });
  return db;
}

/** Raw connection escape hatch (PRAGMA checks, health probe). */
export function getRawDb(): Database {
  if (!sqlite) getDb();
  return sqlite as Database;
}

/** Close the connection (tests / shutdown). */
export function closeDb(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
}
