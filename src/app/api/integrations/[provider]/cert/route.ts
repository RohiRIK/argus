import { NextResponse } from "next/server";
import { hasMasterKey } from "@/config/env";
import { vaultService } from "@/services/vault/vault";
import { generateSelfSignedCert, buildAzureCertScripts } from "@/services/graph/cert";
import { requiredScopes } from "@/services/graph/connection-test";
import { clearTokenCache } from "@/services/graph/auth";
import { resetGraphClient } from "@/services/graph/client";
import {
  AUTOMATION_PROVIDER,
  clearAutomationTokenCache,
  requiredAutomationScopes,
  resetAutomationGraphClient,
} from "@/services/graph/automation-client";
import { AUTHORIZE_CALLBACK_PATH } from "@/lib/graph-consent";
import { getPublicOrigin } from "@/lib/request-origin";
import { ok, fail } from "@/lib/api";
import { NotFoundError, ValidationError, VaultError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

function keysForProvider(provider: string) {
  if (provider === "microsoft365") {
    return {
      isAuto: false,
      appName: "Argus M365",
      fileName: "argus-m365.cer",
      clientId: "clientId",
      privateKey: "clientPrivateKey",
      thumbprint: "certThumbprint",
      x5t: "certThumbprintX5t",
      publicPem: "certPublicPem",
      expiresAt: "certExpiresAt",
    };
  }
  if (provider === AUTOMATION_PROVIDER) {
    return {
      isAuto: true,
      appName: "Argus M365 Automation",
      fileName: "argus-m365-automation.cer",
      clientId: "auto_clientId",
      privateKey: "auto_clientPrivateKey",
      thumbprint: "auto_certThumbprint",
      x5t: "auto_certThumbprintX5t",
      publicPem: "auto_certPublicPem",
      expiresAt: "auto_certExpiresAt",
    };
  }
  throw new ValidationError("Only supported for microsoft365 and microsoft365-automation");
}

/** GET /api/integrations/:provider/cert — read certificate metadata or download public .cer file. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    const k = keysForProvider(provider);

    const certPem = vaultService.get(k.publicPem);
    const thumbprint = vaultService.get(k.thumbprint);
    const expiresAt = vaultService.get(k.expiresAt);

    const download = new URL(req.url).searchParams.get("download") === "1";
    if (download) {
      if (!certPem) throw new NotFoundError("No certificate generated yet");
      return new NextResponse(certPem, {
        headers: {
          "content-type": "application/x-pem-file",
          "content-disposition": `attachment; filename="${k.fileName}"`,
        },
      });
    }

    const scopes = k.isAuto ? await requiredAutomationScopes() : requiredScopes();
    const origin = getPublicOrigin(req);
    const scripts = certPem
      ? buildAzureCertScripts({
          appName: k.appName,
          certPem,
          scopes,
          redirectUri: `${origin}${AUTHORIZE_CALLBACK_PATH}`,
          existingClientId: vaultService.get(k.clientId) ?? undefined,
        })
      : null;

    return ok({
      present: Boolean(certPem && vaultService.has(k.privateKey)),
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
    const k = keysForProvider(provider);
    if (!hasMasterKey()) throw new VaultError("ARGUS_MASTER_KEY is not set");

    const cert = generateSelfSignedCert({ commonName: k.appName });
    vaultService.set(k.privateKey, cert.privateKeyPem);
    vaultService.set(k.thumbprint, cert.thumbprintSha1Hex);
    vaultService.set(k.x5t, cert.x5t);
    vaultService.set(k.publicPem, cert.certPem);
    vaultService.set(k.expiresAt, cert.notAfterIso);

    if (k.isAuto) {
      clearAutomationTokenCache();
      resetAutomationGraphClient();
    } else {
      clearTokenCache();
      resetGraphClient();
    }

    const scopes = k.isAuto ? await requiredAutomationScopes() : requiredScopes();
    const origin = getPublicOrigin(req);
    const scripts = buildAzureCertScripts({
      appName: k.appName,
      certPem: cert.certPem,
      scopes,
      redirectUri: `${origin}${AUTHORIZE_CALLBACK_PATH}`,
      existingClientId: vaultService.get(k.clientId) ?? undefined,
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
