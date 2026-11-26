/**
 * Set (or create) an operator account's password from the Argus host.
 *
 *   bun run auth:reset-password <username>            # prints a new random password
 *   docker exec argus bun run auth:reset-password admin
 *
 * Use it to recover a forgotten password, or to create the first account when
 * the first-run window on the sign-in page has closed.
 */
import { randomBytes } from "node:crypto";
import { runMigrations } from "../src/db/migrate";
import { closeDb } from "../src/db/client";
import { resetPassword } from "../src/services/auth/accounts";

const username = process.argv[2];
if (!username) {
  console.error("Usage: bun run auth:reset-password <username>");
  process.exit(1);
}

try {
  runMigrations();
  // 18 random bytes → 24 URL-safe characters.
  const password = randomBytes(18).toString("base64url");
  const { created } = await resetPassword(username, password);
  console.log(`${created ? "Created" : "Updated"} account "${username.trim().toLowerCase()}".`);
  console.log(`Password: ${password}`);
  console.log("Sign in and change it under Settings → My account.");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  closeDb();
}
