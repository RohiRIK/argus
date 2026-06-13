import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { vault } from "@/db/schema";
import { encrypt, decrypt } from "./crypto";

/** Credential keys Argus knows about. Free-form keys are also allowed. */
export const VAULT_KEYS = ["tenantId", "clientId", "clientSecret", "mailbox"] as const;
export type VaultKey = (typeof VAULT_KEYS)[number] | (string & {});

/** Keys whose values must never be revealed in listings. */
const SECRET_KEYS = new Set<string>(["clientSecret"]);

export interface MaskedEntry {
  key: string;
  masked: string;
  hasValue: boolean;
  updatedAt: string;
}

function mask(key: string, plaintext: string): string {
  if (SECRET_KEYS.has(key)) return "••••••••";
  if (plaintext.length <= 6) return "••••";
  return `${plaintext.slice(0, 3)}••••${plaintext.slice(-3)}`;
}

export const vaultService = {
  /** Upsert an encrypted credential. */
  set(key: VaultKey, value: string): void {
    const enc = encrypt(value);
    getDb()
      .insert(vault)
      .values({
        id: crypto.randomUUID(),
        key,
        value: enc.value,
        iv: enc.iv,
        tag: enc.tag,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: vault.key,
        set: { value: enc.value, iv: enc.iv, tag: enc.tag, updatedAt: new Date().toISOString() },
      })
      .run();
  },

  /** Decrypt and return a credential, or undefined if not set. */
  get(key: VaultKey): string | undefined {
    const row = getDb().select().from(vault).where(eq(vault.key, key)).get();
    if (!row) return undefined;
    return decrypt({ value: row.value, iv: row.iv, tag: row.tag });
  },

  has(key: VaultKey): boolean {
    return Boolean(getDb().select({ k: vault.key }).from(vault).where(eq(vault.key, key)).get());
  },

  remove(key: VaultKey): void {
    getDb().delete(vault).where(eq(vault.key, key)).run();
  },

  /** List all stored keys with masked values — safe for API responses. */
  list(): MaskedEntry[] {
    return getDb()
      .select()
      .from(vault)
      .all()
      .map((row) => ({
        key: row.key,
        masked: mask(row.key, decrypt({ value: row.value, iv: row.iv, tag: row.tag })),
        hasValue: true,
        updatedAt: row.updatedAt,
      }));
  },

  /** True when the four core Entra/mailbox credentials are all present. */
  isConfigured(): boolean {
    return VAULT_KEYS.every((k) => this.has(k));
  },
};
