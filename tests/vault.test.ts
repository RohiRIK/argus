import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-vault-"));
process.env.ARGUS_DB_PATH = join(dir, "test.db");
// 32-byte key as 64 hex chars.
process.env.ARGUS_MASTER_KEY = "0".repeat(64);

const { encrypt, decrypt } = await import("../src/services/vault/crypto");
const { vaultService } = await import("../src/services/vault/vault");
const { VaultError } = await import("../src/lib/errors");
const { runMigrations } = await import("../src/db/migrate");
const { closeDb } = await import("../src/db/client");

beforeAll(() => runMigrations());
afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("crypto (AES-256-GCM)", () => {
  test("encrypt → decrypt roundtrip (AC-3)", () => {
    const plaintext = "roundtrip-fixture-value-123";
    const enc = encrypt(plaintext);
    expect(enc.value).not.toContain(plaintext);
    expect(decrypt(enc)).toBe(plaintext);
  });

  test("unique IV per encryption", () => {
    const a = encrypt("x");
    const b = encrypt("x");
    expect(a.iv).not.toBe(b.iv);
    expect(a.value).not.toBe(b.value);
  });

  test("tampered ciphertext throws VaultError", () => {
    const enc = encrypt("hello");
    const flipped = Buffer.from(enc.value, "base64");
    flipped[0] ^= 0xff;
    expect(() => decrypt({ ...enc, value: flipped.toString("base64") })).toThrow(VaultError);
  });

  test("tampered auth tag throws VaultError", () => {
    const enc = encrypt("hello");
    const tag = Buffer.from(enc.tag, "base64");
    tag[0] ^= 0xff;
    expect(() => decrypt({ ...enc, tag: tag.toString("base64") })).toThrow(VaultError);
  });
});

describe("vaultService", () => {
  test("set/get/has/remove roundtrip", () => {
    vaultService.set("tenantId", "contoso-tenant-id");
    expect(vaultService.has("tenantId")).toBe(true);
    expect(vaultService.get("tenantId")).toBe("contoso-tenant-id");

    vaultService.set("tenantId", "updated-tenant"); // upsert
    expect(vaultService.get("tenantId")).toBe("updated-tenant");

    vaultService.remove("tenantId");
    expect(vaultService.has("tenantId")).toBe(false);
    expect(vaultService.get("tenantId")).toBeUndefined();
  });

  test("list masks secret values", () => {
    vaultService.set("clientSecret", "the-actual-secret-value");
    vaultService.set("clientId", "abc123def456");
    const entries = vaultService.list();
    const secret = entries.find((e) => e.key === "clientSecret");
    const id = entries.find((e) => e.key === "clientId");
    expect(secret?.masked).toBe("••••••••");
    expect(secret?.masked).not.toContain("actual");
    expect(id?.masked).not.toBe("abc123def456"); // partially masked
  });

  test("isConfigured requires all four core keys", () => {
    vaultService.set("tenantId", "t");
    vaultService.set("clientId", "c");
    vaultService.set("clientSecret", "s");
    expect(vaultService.isConfigured()).toBe(false); // mailbox missing
    vaultService.set("mailbox", "alerts@contoso.com");
    expect(vaultService.isConfigured()).toBe(true);
  });
});
