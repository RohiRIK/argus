import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "argus-tls-"));
const prevKey = process.env.ARGUS_MASTER_KEY;
process.env.ARGUS_MASTER_KEY = "1".repeat(64);

const { ensureTlsCertificate, tlsHostNames, TLS_VALID_DAYS } = await import("../src/services/tls/certificate");
const { createHttpsProxy, rewriteLocation } = await import("../src/services/tls/https-proxy");
const { generateSelfSignedCert } = await import("../src/services/graph/cert");

beforeAll(() => {
  process.env.ARGUS_MASTER_KEY = "1".repeat(64);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  if (prevKey === undefined) delete process.env.ARGUS_MASTER_KEY;
  else process.env.ARGUS_MASTER_KEY = prevKey;
});

describe("server certificate generation", () => {
  test("adds serverAuth and SAN entries for names and IPs", () => {
    const c = generateSelfSignedCert({ serverNames: ["localhost", "argus.lan", "10.1.2.3", "::1"] });
    const x = new X509Certificate(c.certPem);
    expect(x.keyUsage).toEqual(["1.3.6.1.5.5.7.3.1"]);
    expect(x.checkHost("argus.lan")).toBe("argus.lan");
    expect(x.checkIP("10.1.2.3")).toBe("10.1.2.3");
    expect(x.checkIP("::1")).toBe("::1");
    expect(x.checkHost("evil.test")).toBeUndefined();
    expect(x.checkPrivateKey(createPrivateKey(c.privateKeyPem))).toBe(true);
  });

  test("default (Entra) certificate is unchanged: clientAuth, no SAN", () => {
    const x = new X509Certificate(generateSelfSignedCert().certPem);
    expect(x.keyUsage).toEqual(["1.3.6.1.5.5.7.3.2"]);
    expect(x.subjectAltName).toBeUndefined();
  });
});

describe("tlsHostNames", () => {
  test("always includes localhost, dedupes and drops junk", () => {
    expect(tlsHostNames("Argus.LAN, 192.168.1.5 argus.lan,,bad name;rm")).toEqual([
      "localhost",
      "127.0.0.1",
      "::1",
      "argus.lan",
      "192.168.1.5",
      "bad",
    ]);
  });
});

describe("ensureTlsCertificate", () => {
  const dataDir = join(dir, "data");

  test("generates once, stores the key encrypted, then reuses it", () => {
    const first = ensureTlsCertificate({ dataDir, hostNames: "argus.lan" });
    expect(first.source).toBe("generated");
    expect(first.names).toContain("argus.lan");

    const stored = readFileSync(join(dataDir, "tls", "key.enc.json"), "utf8");
    expect(stored).not.toContain("PRIVATE KEY");
    expect(statSync(join(dataDir, "tls", "key.enc.json")).mode & 0o777).toBe(0o600);

    const again = ensureTlsCertificate({ dataDir, hostNames: "argus.lan" });
    expect(again.source).toBe("reused");
    expect(again.fingerprint256).toBe(first.fingerprint256);
    expect(again.keyPem).toBe(first.keyPem);
  });

  test("regenerates when names change, near expiry, or the master key changed", () => {
    const base = ensureTlsCertificate({ dataDir, hostNames: "argus.lan" });

    const renamed = ensureTlsCertificate({ dataDir, hostNames: "argus.lan,10.0.0.9" });
    expect(renamed.source).toBe("generated");
    expect(renamed.fingerprint256).not.toBe(base.fingerprint256);

    const later = Date.now() + (TLS_VALID_DAYS - 10) * 86_400_000;
    const renewed = ensureTlsCertificate({ dataDir, hostNames: "argus.lan,10.0.0.9", now: later });
    expect(renewed.source).toBe("generated");

    process.env.ARGUS_MASTER_KEY = "2".repeat(64);
    try {
      const rekeyed = ensureTlsCertificate({ dataDir, hostNames: "argus.lan,10.0.0.9" });
      expect(rekeyed.source).toBe("generated");
    } finally {
      process.env.ARGUS_MASTER_KEY = "1".repeat(64);
    }
  });

  test("uses provided cert/key files and rejects a mismatched pair", () => {
    const a = generateSelfSignedCert({ serverNames: ["argus.example.com"] });
    const b = generateSelfSignedCert({ serverNames: ["argus.example.com"] });
    const certFile = join(dir, "fullchain.pem");
    const keyFile = join(dir, "privkey.pem");
    const wrongKey = join(dir, "wrong.pem");
    writeFileSync(certFile, a.certPem);
    writeFileSync(keyFile, a.privateKeyPem);
    writeFileSync(wrongKey, b.privateKeyPem);

    const provided = ensureTlsCertificate({ dataDir, certFile, keyFile });
    expect(provided.source).toBe("provided");
    expect(() => ensureTlsCertificate({ dataDir, certFile, keyFile: wrongKey })).toThrow(/does not match/);
    expect(() => ensureTlsCertificate({ dataDir, certFile })).toThrow(/both/);
  });
});

describe("https proxy", () => {
  const upstream = "http://127.0.0.1:8180";

  test("forwards path/query/body and sets its own X-Forwarded-* headers", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const handle = createHttpsProxy({
      upstream,
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response("ok", { status: 201, headers: { "x-test": "1", connection: "keep-alive" } });
      }) as unknown as typeof fetch,
    });

    const res = await handle(
      new Request("https://argus.lan:8100/api/jobs?x=1", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-proto": "http",
          "x-forwarded-host": "evil.test",
          "x-forwarded-for": "6.6.6.6",
        },
        body: "{}",
      }),
      "10.0.0.7",
    );

    expect(seen?.url).toBe("http://127.0.0.1:8180/api/jobs?x=1");
    const h = new Headers(seen?.init.headers);
    expect(h.get("x-forwarded-proto")).toBe("https");
    expect(h.get("x-forwarded-host")).toBe("argus.lan:8100");
    expect(h.get("x-forwarded-for")).toBe("10.0.0.7");
    expect(seen?.init.redirect).toBe("manual");
    expect(res.status).toBe(201);
    expect(res.headers.get("x-test")).toBe("1");
    expect(res.headers.get("connection")).toBeNull();
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  test("rewrites internal and plain-http redirects to the public https origin", () => {
    const pub = "https://argus.lan:8100";
    expect(rewriteLocation("http://127.0.0.1:8180/login?next=%2F", pub, upstream)).toBe(`${pub}/login?next=%2F`);
    expect(rewriteLocation("http://argus.lan:8100/login", pub, upstream)).toBe(`${pub}/login`);
    expect(rewriteLocation("/login", pub, upstream)).toBe("/login");
    expect(rewriteLocation("https://login.microsoftonline.com/x", pub, upstream)).toBe(
      "https://login.microsoftonline.com/x",
    );
    expect(rewriteLocation("http://argus.lan:81000/x", pub, upstream)).toBe("http://argus.lan:81000/x");
  });

  test("adds HSTS only when asked, and answers 502 when the app is down", async () => {
    const hsts = createHttpsProxy({
      upstream,
      hsts: true,
      fetchImpl: (async () => new Response("ok")) as unknown as typeof fetch,
    });
    const r1 = await hsts(new Request("https://argus.example.com/"));
    expect(r1.headers.get("strict-transport-security")).toBe("max-age=31536000");

    const down = createHttpsProxy({
      upstream,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    const r2 = await down(new Request("https://argus.lan/api/jobs"));
    expect(r2.status).toBe(502);
  });
});
