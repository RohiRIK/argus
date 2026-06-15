import { z } from "zod";
import { jobsDao } from "@/db/dao/jobs";
import { templatesDao } from "@/db/dao/templates";
import { settingsDao } from "@/db/dao/settings";
import { getReport } from "@/services/reports/registry";
import { renderReport, renderSubject, type RenderInput } from "@/services/report-engine/default-template";
import { liveEmailTransport } from "@/services/dispatch/email";
import { buildTestSendEmail } from "@/services/dispatch/alerts";
import { vaultService } from "@/services/vault/vault";
import { ok, fail } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ to: z.array(z.string().email()).optional() }).optional();

type Ctx = { params: Promise<{ id: string }> };

/** Representative sample data so the test-send looks like a real run. */
function sampleInput(job: { name: string }, reportName: string, executionId: string): RenderInput {
  return {
    reportName,
    organizationName: vaultService.get("tenantId") ?? "your organization",
    executionId,
    count: 14,
    executiveSummary: `Sample run for "${job.name}" — 14 item(s), up 40% on the previous run.`,
    trendPercent: 40,
    trendDirection: "up",
    isAnomaly: true,
    baselineMean: 8.5,
    variables: { totalSignIns: 1280, failedSignIns: 14 },
    rows: [
      { user: "alice@contoso.com", reason: "Invalid credentials" },
      { user: "bob@contoso.com", reason: "MFA required" },
    ],
  };
}

/** POST /api/jobs/:id/test-send — email a rendered sample of this job to yourself. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const job = jobsDao.findById(id);
    if (!job) throw new NotFoundError(`Job ${id} not found`);

    const parsed = bodySchema.safeParse(await req.json().catch(() => undefined));
    const settings = settingsDao.get();
    const recipients = parsed.success && parsed.data?.to?.length
      ? parsed.data.to
      : settings.adminContacts.length
        ? settings.adminContacts
        : settings.globalRecipients;
    if (recipients.length === 0) throw new ValidationError("No recipients — set admin contacts or pass `to`.");
    if (settings.permissionStatus !== "ok") {
      throw new ValidationError("Mailbox not validated — run Test Connection in Settings first.");
    }

    const report = getReport(job.reportType);
    const input = sampleInput(job, report?.name ?? job.reportType, "test-send-0000");
    const template =
      (job.templateId ? templatesDao.findById(job.templateId) : undefined) ?? templatesDao.defaultFor(job.reportType);
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
