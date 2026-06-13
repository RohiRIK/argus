import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/config/env";
import { VaultError } from "@/lib/errors";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

export interface Encrypted {
  value: string; // base64 ciphertext
  iv: string; // base64 nonce
  tag: string; // base64 auth tag
}

/**
 * Resolve the 32-byte master key from ARGUS_MASTER_KEY. Loaded fresh each call
 * (cheap) and never cached on disk or logged. Throws VaultError if absent.
 */
function masterKey(): Buffer {
  const hex = getEnv().ARGUS_MASTER_KEY;
  if (!hex) {
    throw new VaultError("ARGUS_MASTER_KEY is not set — cannot encrypt or decrypt the vault");
  }
  return Buffer.from(hex, "hex"); // 32 bytes (validated as 64 hex chars by env schema)
}

/** Encrypt a UTF-8 string with a fresh random IV. */
export function encrypt(plaintext: string): Encrypted {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    value: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/** Decrypt and verify. Throws VaultError on wrong key or tampered ciphertext/tag. */
export function decrypt(enc: Encrypted): string {
  try {
    const decipher = createDecipheriv(ALGORITHM, masterKey(), Buffer.from(enc.iv, "base64"));
    decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(enc.value, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    // GCM auth failure surfaces here — do not leak which part failed.
    throw new VaultError("Vault decryption failed — wrong master key or tampered data", {
      cause: err,
    });
  }
}
