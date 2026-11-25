import { vaultService } from "@/services/vault/vault";
import { settingsDao } from "@/db/dao/settings";
import { integrationsDao } from "@/db/dao/integrations";
import { auditDao } from "@/db/dao/audit";
import { resolveOrganizationName } from "@/lib/org-name";
import {
  buildSharedMailboxScript,
  listTenantMailboxes,
  sendMailboxVerificationEmail,
  verifyMailbox,
  type TenantMailbox,
} from "@/services/graph/mailboxes";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { mailboxActionSchema, parseBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

function assertProvider(provider: string) {
  if (provider !== "microsoft365") {
    throw new ValidationError("Mailbox management is only supported for microsoft365");
  }
}

/** GET /api/integrations/:provider/mailboxes — list candidate M365 mailboxes + setup script. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    assertProvider(provider);

    const configuredMailbox = vaultService.get("mailbox")?.trim() || null;
    const settings = settingsDao.get();
    const m365 = integrationsDao.findByProvider("microsoft365");
    const primaryDomain =
      typeof m365?.config?.primaryDomain === "string" && m365.config.primaryDomain
        ? m365.config.primaryDomain
        : null;
    const appId = vaultService.get("clientId")?.trim() || undefined;
    const appDisplayName =
      typeof m365?.config?.appDisplayName === "string" && m365.config.appDisplayName
        ? m365.config.appDisplayName
        : "Argus M365";

    let mailboxes: TenantMailbox[] = [];
    let error: string | null = null;
    if (vaultService.isConfigured()) {
      try {
        mailboxes = await listTenantMailboxes();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }

    const suggestedDedicatedAddress = primaryDomain
      ? `argus@${primaryDomain}`
      : "argus@yourdomain.com";
    const scriptTarget = configuredMailbox || suggestedDedicatedAddress;

    return ok({
      configuredMailbox,
      fromAddress: settings.fromAddress,
      primaryDomain,
      appId: appId ?? null,
      appDisplayName,
      suggestedDedicatedAddress,
      sharedMailboxScript: buildSharedMailboxScript({
        address: scriptTarget,
        displayName: "Argus Reports",
        appId,
        appDisplayName,
      }),
      mailboxes,
      error,
    });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/integrations/:provider/mailboxes — select existing, verify dedicated, or send test email. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { provider } = await params;
    assertProvider(provider);

    const input = await parseBody(req, mailboxActionSchema);
    const m365 = integrationsDao.findByProvider("microsoft365");
    const appId = vaultService.get("clientId")?.trim() || undefined;
    const appDisplayName =
      typeof m365?.config?.appDisplayName === "string" && m365.config.appDisplayName
        ? m365.config.appDisplayName
        : "Argus M365";
    const settings = settingsDao.get();
    const orgName = resolveOrganizationName({
      settingsOrgName: settings.organizationDisplayName,
      tenantDisplayName: m365?.config?.tenantDisplayName,
      primaryDomain: m365?.config?.primaryDomain,
    });

    if (input.action === "select") {
      vaultService.set("mailbox", input.address.trim());
      if (input.syncFromAddress) {
        settingsDao.update({ fromAddress: input.address.trim() });
      }
      auditDao.record({
        action: "mailbox_select",
        provider,
        outcome: "success",
        detail: { mailbox: input.address.trim() },
      });
      return ok({ mailbox: input.address.trim(), saved: true });
    }

    if (input.action === "verify") {
      const check = vaultService.isConfigured()
        ? await verifyMailbox(input.address)
        : {
            exists: false,
            address: input.address.trim(),
            note: "Connect Microsoft 365 credentials first to verify the mailbox live.",
          };
      const script = buildSharedMailboxScript({
        address: input.address,
        displayName: input.displayName || "Argus Reports",
        appId,
        appDisplayName,
      });
      if (check.exists) {
        vaultService.set("mailbox", check.address);
        settingsDao.update({ fromAddress: check.address });
        auditDao.record({
          action: "mailbox_verify",
          provider,
          outcome: "success",
          detail: { mailbox: check.address },
        });
      }
      return ok({ ...check, saved: check.exists, script });
    }

    // action === "test-send"
    const from = (input.from || settings.fromAddress || vaultService.get("mailbox") || "").trim();
    if (!from) {
      throw new ValidationError("Select or verify a sender mailbox before sending a test email.");
    }
    try {
      await sendMailboxVerificationEmail({ from, to: input.to.trim(), orgName });
      auditDao.record({
        action: "mailbox_test_send",
        provider,
        outcome: "success",
        detail: { from, to: input.to.trim() },
      });
      return ok({ sent: true, from, to: input.to.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      auditDao.record({
        action: "mailbox_test_send",
        provider,
        outcome: "error",
        detail: { from, to: input.to.trim(), error: msg },
      });
      throw err;
    }
  } catch (err) {
    return fail(err);
  }
}
