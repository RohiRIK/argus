import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";

/**
 * Pure Node/Bun X.509 v3 self-signed certificate generator and RS256 client_assertion
 * signer for passwordless Entra ID app-only authentication. Zero external binaries.
 */

export interface GeneratedCert {
  privateKeyPem: string;
  certDerBase64: string;
  certPem: string;
  thumbprintSha1Hex: string;
  x5t: string;
  x5tS256: string;
  keyId: string;
  notBeforeIso: string;
  notAfterIso: string;
}

/* ── Minimal ASN.1 DER encoder ─────────────────────────────────────────── */

function derLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}

const derSeq = (...parts: Buffer[]) => tlv(0x30, ...parts);
const derSet = (...parts: Buffer[]) => tlv(0x31, ...parts);
const derNull = () => Buffer.from([0x05, 0x00]);
const derUtf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
const derOctet = (b: Buffer) => tlv(0x04, b);
const derBitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0x00]), b]));
const derExplicit = (ctxTag: number, inner: Buffer) => tlv(0xa0 | ctxTag, inner);

function derInt(buf: Buffer): Buffer {
  let b = buf;
  while (b.length > 1 && b[0] === 0 && (b[1] & 0x80) === 0) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
  return tlv(0x02, b);
}

function derOid(oid: string): Buffer {
  const nums = oid.split(".").map(Number);
  const out: number[] = [nums[0] * 40 + nums[1]];
  for (let i = 2; i < nums.length; i++) {
    let v = nums[i];
    if (v === 0) {
      out.push(0);
      continue;
    }
    const enc: number[] = [];
    while (v > 0) {
      enc.unshift((v & 0x7f) | (enc.length ? 0x80 : 0));
      v >>= 7;
    }
    out.push(...enc);
  }
  return tlv(0x06, Buffer.from(out));
}

function derUtcTime(d: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = pad(d.getUTCFullYear() % 100);
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return tlv(0x17, Buffer.from(`${yy}${mm}${dd}${hh}${mi}${ss}Z`, "ascii"));
}

const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
const OID_COMMON_NAME = "2.5.4.3";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_KEY_USAGE = "2.5.29.15";
const OID_EXT_KEY_USAGE = "2.5.29.37";
const OID_CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";
const OID_SERVER_AUTH = "1.3.6.1.5.5.7.3.1";
const OID_SUBJECT_ALT_NAME = "2.5.29.17";

/** Parse a dotted IPv4 or full/compressed IPv6 literal to its raw bytes, or null. */
function ipBytes(ip: string): Buffer | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/u.test(ip)) {
    const parts = ip.split(".").map(Number);
    return parts.every((n) => n <= 255) ? Buffer.from(parts) : null;
  }
  if (!ip.includes(":")) return null;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = ip.includes("::") && tail ? tail.split(":") : [];
  const missing = 8 - h.length - t.length;
  if ((ip.includes("::") ? missing < 1 : missing !== 0) || ip.split("::").length > 2) return null;
  const groups = [...h, ...Array<string>(ip.includes("::") ? missing : 0).fill("0"), ...t];
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/u.test(g))) return null;
  return Buffer.concat(groups.map((g) => { const b = Buffer.alloc(2); b.writeUInt16BE(parseInt(g, 16)); return b; }));
}

/** subjectAltName extension: each entry is a DNS name or an IP literal. */
function sanExtension(names: string[]): Buffer {
  const general = names.map((n) => {
    const ip = ipBytes(n);
    return ip ? tlv(0x87, ip) : tlv(0x82, Buffer.from(n, "ascii"));
  });
  return derSeq(derOid(OID_SUBJECT_ALT_NAME), derOctet(derSeq(...general)));
}

function formatPem(der: Buffer): string {
  const b64 = der.toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

/**
 * Generate an RSA-2048 X.509 v3 self-signed certificate. By default it is a
 * client-auth certificate suitable for Entra ID `keyCredentials`; pass
 * `serverNames` for a TLS server certificate (serverAuth EKU + subjectAltName).
 */
export function generateSelfSignedCert(options?: {
  commonName?: string;
  validDays?: number;
  serverNames?: string[];
}): GeneratedCert {
  const serverNames = options?.serverNames?.filter((n) => n.trim().length > 0) ?? [];
  const isServer = serverNames.length > 0;
  const commonName = options?.commonName?.trim() || "Argus M365";
  const validDays = Math.max(1, Math.min(3650, options?.validDays ?? 730));

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const now = Date.now();
  const notBefore = new Date(now - 5 * 60_000);
  const notAfter = new Date(now + validDays * 86_400_000);

  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  if (serial[0] === 0) serial[0] = 0x01;

  const algId = derSeq(derOid(OID_SHA256_WITH_RSA), derNull());
  const name = derSeq(derSet(derSeq(derOid(OID_COMMON_NAME), derUtf8(commonName))));
  const validity = derSeq(derUtcTime(notBefore), derUtcTime(notAfter));

  const extBasic = derSeq(derOid(OID_BASIC_CONSTRAINTS), Buffer.from([0x01, 0x01, 0xff]), derOctet(derSeq()));
  // keyUsage: digitalSignature (0x80); servers add keyEncipherment (0x20).
  const extKeyUsage = derSeq(
    derOid(OID_KEY_USAGE),
    Buffer.from([0x01, 0x01, 0xff]),
    derOctet(tlv(0x03, isServer ? Buffer.from([0x05, 0xa0]) : Buffer.from([0x07, 0x80]))),
  );
  const extEku = derSeq(
    derOid(OID_EXT_KEY_USAGE),
    derOctet(derSeq(derOid(isServer ? OID_SERVER_AUTH : OID_CLIENT_AUTH))),
  );
  const extensions = isServer
    ? derSeq(extBasic, extKeyUsage, extEku, sanExtension(serverNames))
    : derSeq(extBasic, extKeyUsage, extEku);

  const tbs = derSeq(
    derExplicit(0, derInt(Buffer.from([0x02]))), // v3
    derInt(serial),
    algId,
    name,
    validity,
    name,
    Buffer.from(publicKey),
    derExplicit(3, extensions),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(tbs);
  const sig = signer.sign(privateKey);

  const certDer = derSeq(tbs, algId, derBitString(sig));
  const sha1 = createHash("sha1").update(certDer).digest();
  const sha256 = createHash("sha256").update(certDer).digest();

  return {
    privateKeyPem: privateKey,
    certDerBase64: certDer.toString("base64"),
    certPem: formatPem(certDer),
    thumbprintSha1Hex: sha1.toString("hex").toUpperCase(),
    x5t: sha1.toString("base64url"),
    x5tS256: sha256.toString("base64url"),
    keyId: crypto.randomUUID(),
    notBeforeIso: notBefore.toISOString(),
    notAfterIso: notAfter.toISOString(),
  };
}

/** Sign a short-lived RS256 OAuth2 client_assertion JWT for Entra ID certificate auth. */
export function signClientAssertion(args: {
  tenantId: string;
  clientId: string;
  privateKeyPem: string;
  x5t: string;
  nowSec?: number;
}): string {
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", x5t: args.x5t }),
    "utf8",
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: `https://login.microsoftonline.com/${encodeURIComponent(args.tenantId)}/oauth2/v2.0/token`,
      iss: args.clientId,
      sub: args.clientId,
      jti: crypto.randomUUID(),
      nbf: nowSec - 60,
      iat: nowSec,
      exp: nowSec + 600,
    }),
    "utf8",
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const sig = signer.sign(args.privateKeyPem).toString("base64url");
  return `${signingInput}.${sig}`;
}

/** Build Conditional-Access-safe fallback scripts using only the PUBLIC certificate. */
export function buildAzureCertScripts(opts: {
  appName: string;
  certPem: string;
  scopes: string[];
  redirectUri: string;
  existingClientId?: string;
}): { azCli: string; powerShell: string } {
  const b64Pem = Buffer.from(opts.certPem, "utf8").toString("base64");
  const scopeList = opts.scopes.map((s) => `"${s}"`).join(",");
  const azCli = [
    `# Run in Azure Cloud Shell or local bash (uploads public .cer only)`,
    `echo "${b64Pem}" | base64 -d > argus.cer`,
    opts.existingClientId
      ? `APP_ID="${opts.existingClientId}"`
      : `APP_ID=$(az ad app create --display-name "${opts.appName}" --web-redirect-uris "${opts.redirectUri}" --query appId -o tsv)`,
    `az ad app credential reset --id "$APP_ID" --cert @argus.cer --append`,
    `SP_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv 2>/dev/null || az ad sp create --id "$APP_ID" --query id -o tsv)`,
    `GRAPH_SP=$(az ad sp show --id 00000003-0000-0000-c000-000000000000 --query id -o tsv)`,
    `for R in $(az ad sp show --id 00000003-0000-0000-c000-000000000000 --query "appRoles[?contains('${opts.scopes.join(",")}', value)].id" -o tsv); do`,
    `  az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$SP_ID/appRoleAssignments" --body "{\\"principalId\\":\\"$SP_ID\\",\\"resourceId\\":\\"$GRAPH_SP\\",\\"appRoleId\\":\\"$R\\"}" || true`,
    `done`,
    `echo "App Client ID: $APP_ID"`,
  ].join("\n");

  const powerShell = [
    `# Run in PowerShell 7+ (Microsoft.Graph module)`,
    `Connect-MgGraph -Scopes "Application.ReadWrite.All","AppRoleAssignment.ReadWrite.All"`,
    `[IO.File]::WriteAllBytes("argus.cer", [Convert]::FromBase64String("${b64Pem}"))`,
    `$cer = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new("argus.cer")`,
    opts.existingClientId
      ? `$app = Get-MgApplication -Filter "appId eq '${opts.existingClientId}'"`
      : `$app = New-MgApplication -DisplayName "${opts.appName}" -Web @{ RedirectUris = @("${opts.redirectUri}") }`,
    `Update-MgApplication -ApplicationId $app.Id -KeyCredentials @(@{ Type="AsymmetricX509Cert"; Usage="Verify"; Key=$cer.RawData; DisplayName="${opts.appName}" } + $app.KeyCredentials)`,
    `$sp = (Get-MgServicePrincipal -Filter "appId eq '$($app.AppId)'") ?? (New-MgServicePrincipal -AppId $app.AppId)`,
    `$graph = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"`,
    `$scopes = @(${scopeList})`,
    `foreach ($s in $scopes) { $r = $graph.AppRoles | Where-Object Value -eq $s | Select-Object -First 1; if ($r) { New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -PrincipalId $sp.Id -ResourceId $graph.Id -AppRoleId $r.Id -ErrorAction SilentlyContinue | Out-Null } }`,
    `"ClientId: $($app.AppId)"`,
  ].join("\n");

  return { azCli, powerShell };
}
