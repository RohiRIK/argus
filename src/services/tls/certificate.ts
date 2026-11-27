import { X509Certificate, createPrivateKey } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSelfSignedCert } from "@/services/graph/cert";
import { decrypt, encrypt, type Encrypted } from "@/services/vault/crypto";

/**
 * HTTPS certificate for the container's built-in TLS listener.
 *
 * - If ARGUS_TLS_CERT_FILE + ARGUS_TLS_KEY_FILE are set, those files are used as-is.
 * - Otherwise Argus generates a self-signed certificate on first boot and keeps
 *   it in `<data dir>/tls/`. The private key is stored AES-256-GCM encrypted with
 *   ARGUS_MASTER_KEY (same primitive as the vault), never in plain text.
 * - The generated certificate is replaced when it is within 30 days of expiry,
 *   when the requested host names change, or when the master key changed.
 */

/** Browsers cap publicly trusted leaf certs at 398 days; stay under it. */
export const TLS_VALID_DAYS = 397;
const RENEW_BEFORE_MS = 30 * 86_400_000;
const DEFAULT_NAMES = ["localhost", "127.0.0.1", "::1"];

export interface TlsMaterial {
  certPem: string;
  keyPem: string;
  /** SHA-256 fingerprint, colon-separated hex, for operators to verify the cert. */
  fingerprint256: string;
  notAfter: string;
  names: string[];
  source: "provided" | "generated" | "reused";
}

interface StoredMeta {
  names: string[];
  notAfter: string;
  key: Encrypted;
}

/** Default names plus ARGUS_TLS_HOSTNAMES (comma/space separated), de-duplicated and lowercased. */
export function tlsHostNames(extra: string | undefined): string[] {
  const names = [...DEFAULT_NAMES, ...(extra ?? "").split(/[\s,]+/u)]
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 0 && /^[a-z0-9.:*-]+$/u.test(n));
  return [...new Set(names)];
}

function sameNames(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
}

function describe(certPem: string, keyPem: string, names: string[], source: TlsMaterial["source"]): TlsMaterial {
  const x = new X509Certificate(certPem);
  return {
    certPem,
    keyPem,
    fingerprint256: x.fingerprint256,
    notAfter: new Date(x.validTo).toISOString(),
    names,
    source,
  };
}

export function ensureTlsCertificate(opts: {
  dataDir: string;
  hostNames?: string;
  certFile?: string;
  keyFile?: string;
  now?: number;
}): TlsMaterial {
  const now = opts.now ?? Date.now();

  if (opts.certFile || opts.keyFile) {
    if (!opts.certFile || !opts.keyFile) {
      throw new Error("Set both ARGUS_TLS_CERT_FILE and ARGUS_TLS_KEY_FILE, or neither");
    }
    const certPem = readFileSync(opts.certFile, "utf8");
    const keyPem = readFileSync(opts.keyFile, "utf8");
    const x = new X509Certificate(certPem);
    if (!x.checkPrivateKey(createPrivateKey(keyPem))) {
      throw new Error("ARGUS_TLS_KEY_FILE does not match ARGUS_TLS_CERT_FILE");
    }
    return describe(certPem, keyPem, [], "provided");
  }

  const names = tlsHostNames(opts.hostNames);
  const dir = join(opts.dataDir, "tls");
  const certPath = join(dir, "cert.pem");
  const metaPath = join(dir, "key.enc.json");

  if (existsSync(certPath) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as StoredMeta;
      const certPem = readFileSync(certPath, "utf8");
      const fresh = new Date(meta.notAfter).getTime() - now > RENEW_BEFORE_MS;
      if (fresh && sameNames(meta.names, names)) {
        return describe(certPem, decrypt(meta.key), names, "reused");
      }
    } catch {
      // Unreadable, tampered, or encrypted under another master key: regenerate.
    }
  }

  const cert = generateSelfSignedCert({ commonName: "Argus", validDays: TLS_VALID_DAYS, serverNames: names });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(certPath, cert.certPem, { mode: 0o644 });
  const meta: StoredMeta = { names, notAfter: cert.notAfterIso, key: encrypt(cert.privateKeyPem) };
  writeFileSync(metaPath, JSON.stringify(meta), { mode: 0o600 });
  chmodSync(metaPath, 0o600);
  return describe(cert.certPem, cert.privateKeyPem, names, "generated");
}

