import { effectiveSender } from "@/services/graph/capabilities";
import { z } from "zod";
import { settingsDao } from "@/db/dao/settings";
import { integrationsDao } from "@/db/dao/integrations";
import { vaultService } from "@/services/vault/vault";
import { liveEmailTransport } from "@/services/dispatch/email";
import { buildTestSendEmail } from "@/services/dispatch/alerts";
import { renderReport, renderSubject } from "@/services/report-engine/default-template";
import { buildSampleRenderInput } from "@/services/report-engine/preview-samples";
import { resolveOrganizationName } from "@/lib/org-name";
import { ok, fail } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { parseBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const schema = z.object({
  to: z.string().email().optional(),
  reportType: z.string().optional(),
  subject: z.string().trim().min(1).max(300),
  htmlBody: z.string().trim().min(1).max(200_000),
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
});

/** POST /api/templates/test-send — email current template draft with sample/live telemetry. */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, schema);
    const settings = settingsDao.get();
    const recipient = body.to?.trim() || settings.adminContacts[0] || settings.globalRecipients[0];
    if (!recipient) {
      throw new ValidationError("Provide a recipient email address (or set Admin Contacts in Settings → General).");
    }

    const m365 = integrationsDao.findByProvider("microsoft365");
    const grantedScopes = Array.isArray(m365?.config?.grantedScopes) ? (m365.config.grantedScopes as string[]) : [];
    const hasMailSend = settings.permissionStatus === "ok" || grantedScopes.includes("Mail.Send");
    if (!hasMailSend) {
      throw new ValidationError("Mailbox not validated — run Test Connection in Settings → Integrations first.");
    }

    const from = effectiveSender(settings).address ?? "";
    if (!from) {
      throw new ValidationError("Select or configure a sender mailbox in Settings before sending.");
    }

    const orgName = resolveOrganizationName({
      settingsOrgName: settings.organizationDisplayName,
      tenantDisplayName: m365?.config?.tenantDisplayName,
      primaryDomain: m365?.config?.primaryDomain,
      fallback: "your organization",
    });

    const { input } = await buildSampleRenderInput({
      reportType: body.reportType,
      organizationName: orgName,
      executionId: "template-test-0000",
      timezone: settings.timezone,
      dataSource: body.dataSource,
    });

    const renderedHtml = renderReport(input, body.htmlBody);
    const renderedSubject = renderSubject(input, body.subject);

    await liveEmailTransport.send(
      buildTestSendEmail({
        subject: renderedSubject,
        html: renderedHtml,
        recipients: [recipient],
        from,
        replyTo: settings.replyTo ?? undefined,
      }),
    );

    return ok({ sent: true, to: recipient, subject: renderedSubject });
  } catch (err) {
    return fail(err);
  }
}
