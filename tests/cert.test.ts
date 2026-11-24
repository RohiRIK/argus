import { describe, test, expect } from "bun:test";
import { X509Certificate, createVerify } from "node:crypto";
import { generateSelfSignedCert, signClientAssertion, buildAzureCertScripts } from "../src/services/graph/cert";

describe("X.509 certificate generator & client_assertion signer", () => {
  test("generates a valid self-signed RSA-2048 X.509 v3 certificate", () => {
    const generated = generateSelfSignedCert({ commonName: "Argus Test", validDays: 365 });
    const der = Buffer.from(generated.certDerBase64, "base64");
    const cert = new X509Certificate(der);

    expect(cert.subject).toContain("CN=Argus Test");
    expect(cert.issuer).toContain("CN=Argus Test");
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.fingerprint.replace(/:/g, "").toUpperCase()).toBe(generated.thumbprintSha1Hex);
    expect(generated.certPem).toContain("-----BEGIN CERTIFICATE-----");
    expect(generated.privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
  });

  test("signs a verifiable RS256 client_assertion JWT with x5t header", () => {
    const generated = generateSelfSignedCert({ commonName: "Argus JWT" });
    const cert = new X509Certificate(Buffer.from(generated.certDerBase64, "base64"));

    const jwt = signClientAssertion({
      tenantId: "11111111-1111-1111-1111-111111111111",
      clientId: "22222222-2222-2222-2222-222222222222",
      privateKeyPem: generated.privateKeyPem,
      x5t: generated.x5t,
      nowSec: 1_700_000_000,
    });

    const [h, p, s] = jwt.split(".");
    expect(h).toBeTruthy();
    expect(p).toBeTruthy();
    expect(s).toBeTruthy();

    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    expect(header).toEqual({ alg: "RS256", typ: "JWT", x5t: generated.x5t });
    expect(payload.iss).toBe("22222222-2222-2222-2222-222222222222");
    expect(payload.sub).toBe("22222222-2222-2222-2222-222222222222");
    expect(payload.aud).toBe("https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/oauth2/v2.0/token");

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    expect(verifier.verify(cert.publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  test("buildAzureCertScripts embeds public cert only (never private key)", () => {
    const generated = generateSelfSignedCert();
    const scripts = buildAzureCertScripts({
      appName: "Argus M365",
      certPem: generated.certPem,
      scopes: ["Mail.Send", "User.Read.All"],
      redirectUri: "https://argus.example.com/api/integrations/microsoft365/authorize/callback",
    });
    expect(scripts.azCli).toContain("az ad app create");
    expect(scripts.powerShell).toContain("New-MgApplication");
    expect(scripts.azCli).not.toContain("PRIVATE KEY");
    expect(scripts.powerShell).not.toContain("PRIVATE KEY");
  });
});
