import { NextResponse } from "next/server";
import { hasMasterKey } from "@/config/env";
import { vaultService } from "@/services/vault/vault";
import { generateSelfSignedCert, buildAzureCertScripts } from "@/services/graph/cert";
import { requiredScopes } from "@/services/graph/connection-test";
import { clearTokenCache } from "@/services/graph/auth";
import { resetGraphClient } from "@/services/graph/client";
import { AUTHORIZE_CALLBACK_PATH } from "@/lib/graph-consent";
import { getPublicOrigin } from "@/lib/request-origin";
import { ok, fail } from "@/lib/api";
import { NotFoundError, ValidationError, VaultError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/** GET /api/integrations/:provider/cert — read certificate metadata or download public .cer file. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider !== "microsoft365") throw new ValidationError("Only supported for microsoft365");

    const certPem = vaultService.get("certPublicPem");
    const thumbprint = vaultService.get("certThumbprint");
    const expiresAt = vaultService.get("certExpiresAt");

    const download = new URL(req.url).searchParams.get("download") === "1";
    if (download) {
      if (!certPem) throw new NotFoundError("No certificate generated yet");
      return new NextResponse(certPem, {
        headers: {
          "content-type": "application/x-pem-file",
          "content-disposition": 'attachment; filename="argus-m365.cer"',
        },
      });
    }

    const origin = getPublicOrigin(req);
    const scripts = certPem
      ? buildAzureCertScripts({
          appName: "Argus M365",
          certPem,
          scopes: requiredScopes(),
          redirectUri: `${origin}${AUTHORIZE_CALLBACK_PATH}`,
          existingClientId: vaultService.get("clientId") ?? undefined,
        })
      : null;

    return ok({
      present: Boolean(certPem && vaultService.has("clientPrivateKey")),
      thumbprint: thumbprint ?? null,
      expiresAt: expiresAt ?? null,
      certPem: certPem ?? null,
      scripts,
    });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/integrations/:provider/cert — generate a new X.509 certificate locally & save private key to vault. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    if (provider !== "microsoft365") throw new ValidationError("Only supported for microsoft365");
    if (!hasMasterKey()) throw new VaultError("ARGUS_MASTER_KEY is not set");

    const cert = generateSelfSignedCert({ commonName: "Argus M365" });
    vaultService.set("clientPrivateKey", cert.privateKeyPem);
    vaultService.set("certThumbprint", cert.thumbprintSha1Hex);
    vaultService.set("certThumbprintX5t", cert.x5t);
    vaultService.set("certPublicPem", cert.certPem);
    vaultService.set("certExpiresAt", cert.notAfterIso);
    clearTokenCache();
    resetGraphClient();

    const origin = getPublicOrigin(req);
    const scripts = buildAzureCertScripts({
      appName: "Argus M365",
      certPem: cert.certPem,
      scopes: requiredScopes(),
      redirectUri: `${origin}${AUTHORIZE_CALLBACK_PATH}`,
      existingClientId: vaultService.get("clientId") ?? undefined,
    });

    return ok({
      present: true,
      thumbprint: cert.thumbprintSha1Hex,
      expiresAt: cert.notAfterIso,
      certPem: cert.certPem,
      scripts,
    });
  } catch (err) {
    return fail(err);
  }
}
