import { z } from "zod";
import { jobsDao } from "@/db/dao/jobs";
import { templatesDao } from "@/db/dao/templates";
import { settingsDao } from "@/db/dao/settings";
import { integrationsDao } from "@/db/dao/integrations";
import { renderReport, renderSubject } from "@/services/report-engine/default-template";
import { buildSampleRenderInput } from "@/services/report-engine/preview-samples";
import { liveEmailTransport } from "@/services/dispatch/email";
import { buildTestSendEmail } from "@/services/dispatch/alerts";
import { vaultService } from "@/services/vault/vault";
import { resolveJobRecipients } from "@/services/graph/groups";
import { resolveOrganizationName } from "@/lib/org-name";
import { ok, fail } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ to: z.array(z.string().email()).optional() }).optional();

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/jobs/:id/test-send — email a rendered sample of this job to yourself. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const job = jobsDao.findById(id);
    if (!job) throw new NotFoundError(`Job ${id} not found`);

    const parsed = bodySchema.safeParse(await req.json().catch(() => undefined));
    const settings = settingsDao.get();
    let recipients: string[] = [];
    if (parsed.success && parsed.data?.to?.length) {
      recipients = parsed.data.to;
    } else if (settings.adminContacts.length) {
      recipients = settings.adminContacts;
    } else {
      const resolved = await resolveJobRecipients({
        directRecipients: job.recipients,
        groupIds: job.recipientGroupIds ?? [],
        globalRecipients: settings.globalRecipients,
        globalGroupIds: settings.globalRecipientGroupIds ?? [],
        syncLive: true,
      });
      recipients = resolved.emails;
    }
    if (recipients.length === 0) throw new ValidationError("No recipients — set admin contacts, job/group recipients, or pass `to`.");
    const m365 = integrationsDao.findByProvider("microsoft365");
    const grantedScopes = Array.isArray(m365?.config?.grantedScopes) ? (m365.config.grantedScopes as string[]) : [];
    const hasMailSend = settings.permissionStatus === "ok" || grantedScopes.includes("Mail.Send");
    if (!hasMailSend) {
      throw new ValidationError("Mailbox not validated — run Test Connection in Settings first.");
    }

    const orgName = resolveOrganizationName({
      settingsOrgName: settings.organizationDisplayName,
      tenantDisplayName: m365?.config?.tenantDisplayName,
      primaryDomain: m365?.config?.primaryDomain,
    });
    const { input } = await buildSampleRenderInput({
      reportType: job.reportType,
      organizationName: orgName,
      jobName: job.name,
      executionId: "test-send-0000",
      timezone: settings.timezone,
    });
    const template = templatesDao.resolve(job.templateId);
    const html = renderReport(input, template?.htmlBody);
    const subject = renderSubject(input, template?.subject);

    await liveEmailTransport.send(
      buildTestSendEmail({
        subject,
        html,
        recipients,
        from: settings.fromAddress || vaultService.get("mailbox") || "",
        replyTo: settings.replyTo ?? undefined,
      }),
    );
    return ok({ sent: true, recipients });
  } catch (err) {
    return fail(err);
  }
}
