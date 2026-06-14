import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
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

// webpack rewrites __non_webpack_require__ to the real runtime require (Bun's,
// which resolves bun:sqlite) and does NOT parse its argument. In non-webpack
// contexts (bun test, the migrate CLI) it's undefined, so fall back to
// createRequire based on cwd (the project root, where node_modules lives).
declare const __non_webpack_require__: ((id: string) => unknown) | undefined;

function runtimeRequire(id: string): unknown {
  if (typeof __non_webpack_require__ === "function") return __non_webpack_require__(id);
  return createRequire(join(process.cwd(), "package.json"))(id);
}

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
  const { Database } = runtimeRequire(["bun", "sqlite"].join(":")) as typeof import("bun:sqlite");
  const { drizzle } = runtimeRequire(["drizzle-orm", "bun-sqlite"].join("/")) as typeof import("drizzle-orm/bun-sqlite");

  sqlite = new Database(path, { create: true });
  // Durability + concurrency baseline.
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  // Performance tuning (safe under WAL). NORMAL skips an fsync per commit yet
  // stays corruption-safe in WAL mode; temp tables/indices live in RAM; a 16 MiB
  // page cache and 256 MiB mmap cut read I/O; autocheckpoint caps WAL growth.
  // See docs/spec-backend-efficiency.md (AC-DB1).
  if (path !== ":memory:") {
    sqlite.exec("PRAGMA synchronous = NORMAL;");
    sqlite.exec("PRAGMA mmap_size = 268435456;"); // 256 MiB
  }
  sqlite.exec("PRAGMA temp_store = MEMORY;");
  sqlite.exec("PRAGMA cache_size = -16000;"); // ~16 MiB (negative = KiB)
  sqlite.exec("PRAGMA wal_autocheckpoint = 1000;");

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
  // Let SQLite refresh query-planner stats before the handle goes away (AC-DB4).
  // Best-effort: a half-open/closed handle must not throw on shutdown.
  try {
    sqlite?.exec("PRAGMA optimize;");
  } catch {
    // ignore — connection may already be unusable during shutdown
  }
  sqlite?.close();
  sqlite = null;
  db = null;
}
