import { z } from "zod";

/**
 * Environment schema. Only ARGUS_MASTER_KEY is a true secret; everything else
 * is optional with sane defaults. All other credentials live in the encrypted
 * vault, not the environment.
 */
const envSchema = z.object({
  // 32 bytes as 64 hex chars. Optional at import time so the app can boot into a
  // "generate a key" UI state; the vault layer enforces presence when used.
  ARGUS_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/u, "ARGUS_MASTER_KEY must be 64 hex characters (32 bytes)")
    .optional(),
  // 8100 = the hundred eyes of Argus Panoptes (Ovid). Override with PORT.
  PORT: z.coerce.number().int().positive().default(8100),
  ARGUS_DB_PATH: z.string().min(1).default("./data/argus.db"),
  // Max scheduled jobs allowed to run Graph queries simultaneously. Caps the
  // burst when many jobs share a fire time (e.g. all "daily" at 08:00) so the
  // tenant isn't throttled. Excess runs queue. See scheduler runQueue.
  ARGUS_MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().max(64).default(4),
  ARGUS_ENV: z.enum(["production", "staging", "dev"]).default("production"),
  // Operator access gate (src/proxy.ts). "access-key" (default) requires the
  // access key derived from ARGUS_MASTER_KEY; "off" is only for a host nobody
  // else can reach (local dev, isolated CI).
  ARGUS_AUTH_MODE: z.enum(["access-key", "off"]).default("access-key"),
  // Container HTTPS front (scripts/container-start.ts). "on" serves HTTPS on PORT
  // with a self-signed or provided certificate; "off" serves plain HTTP.
  ARGUS_TLS: z.enum(["on", "off"]).default("on"),
  // Extra names/IPs for the self-signed certificate (comma separated).
  ARGUS_TLS_HOSTNAMES: z.string().optional(),
  // Use your own certificate instead of the self-signed one (PEM file paths).
  ARGUS_TLS_CERT_FILE: z.string().min(1).optional(),
  ARGUS_TLS_KEY_FILE: z.string().min(1).optional(),
  // Loopback port `next start` listens on behind the HTTPS front.
  ARGUS_INTERNAL_PORT: z.coerce.number().int().positive().default(8180),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate the environment from process.env. Not cached: parsing a
 * handful of vars is cheap, and caching breaks test isolation (a key set after
 * the first read would be invisible). Throws on malformed values.
 */
export function getEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

/** True when a usable master key is present in the environment. */
export function hasMasterKey(): boolean {
  return Boolean(getEnv().ARGUS_MASTER_KEY);
}
