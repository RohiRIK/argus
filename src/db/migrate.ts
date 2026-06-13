import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { getDb, closeDb } from "./client";

/**
 * Apply all generated Drizzle migrations from ./drizzle. Run via
 * `bun run db:migrate` on container start, or directly in tests/seed scripts.
 */
export function runMigrations(folder = "./drizzle"): void {
  migrate(getDb(), { migrationsFolder: folder });
}

if (import.meta.main) {
  try {
    runMigrations();
    // eslint-disable-next-line no-console
    console.log("[argus] migrations applied");
  } catch (err) {
    console.error("[argus] migration failed:", err);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
