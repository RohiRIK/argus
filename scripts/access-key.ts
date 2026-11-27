/**
 * Print the operator access key for this Argus instance.
 * Usage: bun run auth:access-key   (inside Docker: docker exec argus bun run auth:access-key)
 *
 * The key is derived from ARGUS_MASTER_KEY, so it never needs to be stored.
 * Treat it like a password: anyone holding it can operate Argus.
 */
import { deriveAccessKey } from "../src/lib/auth/access";

const master = process.env.ARGUS_MASTER_KEY;
if (!master || !/^[0-9a-fA-F]{64}$/u.test(master)) {
  console.error("ARGUS_MASTER_KEY is not set (64 hex characters). Load your .env first.");
  process.exit(1);
}
console.log(await deriveAccessKey(master));
