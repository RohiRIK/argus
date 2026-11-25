import { renderReport, renderText, renderSubject } from "@/services/report-engine/default-template";
import { buildSampleRenderInput } from "@/services/report-engine/preview-samples";
import { settingsDao } from "@/db/dao/settings";
import { integrationsDao } from "@/db/dao/integrations";
import { resolveOrganizationName } from "@/lib/org-name";
import { ok, fail } from "@/lib/api";
import { parseBody } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  mode: z.enum(["html", "text"]).default("html"),
  htmlBody: z.string().optional(),
  textBody: z.string().optional(),
  subject: z.string().optional(),
  organizationName: z.string().optional(),
  reportType: z.string().optional(),
});

/** POST /api/templates/preview — render a template body (html|text) with realistic plugin sample data. */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, schema);
    const settings = settingsDao.get();
    const m365 = integrationsDao.findByProvider("microsoft365");
    const orgName =
      body.organizationName?.trim() ||
      resolveOrganizationName({
        settingsOrgName: settings.organizationDisplayName,
        tenantDisplayName: m365?.config?.tenantDisplayName,
        primaryDomain: m365?.config?.primaryDomain,
        fallback: "Contoso Ltd",
      });

    const { input, pluginVars } = await buildSampleRenderInput({
      reportType: body.reportType,
      organizationName: orgName,
      timezone: settings.timezone,
    });

    if (body.mode === "text") {
      const textTpl = body.textBody && body.textBody.trim() ? body.textBody : undefined;
      return ok({
        mode: "text",
        text: renderText(input, textTpl),
        subject: renderSubject(input, body.subject),
        availableVars: pluginVars,
      });
    }

    const htmlTpl = body.htmlBody && body.htmlBody.trim() ? body.htmlBody : undefined;
    return ok({
      mode: "html",
      html: renderReport(input, htmlTpl),
      subject: renderSubject(input, body.subject),
      availableVars: pluginVars,
    });
  } catch (err) {
    return fail(err);
  }
}
