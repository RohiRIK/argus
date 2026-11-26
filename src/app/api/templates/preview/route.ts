import { buildVars, renderReport, renderText, renderSubject } from "@/services/report-engine/default-template";
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
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
  htmlBody: z.string().optional(),
  textBody: z.string().optional(),
  subject: z.string().optional(),
  organizationName: z.string().optional(),
  reportType: z.string().optional(),
});

/** POST /api/templates/preview — render a template body (html|text) with fixture or live M365 data. */
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

    const { input, pluginVars, dataMode } = await buildSampleRenderInput({
      reportType: body.reportType,
      organizationName: orgName,
      timezone: settings.timezone,
      dataSource: body.dataSource,
    });

    const resolvedVars = buildVars(input);
    const sampleValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(resolvedVars)) {
      if (k === "detailsText" || k === "anomalyText" || k === "diffText") continue;
      if (v === undefined || v === null) continue;
      const str = String(v);
      sampleValues[k] = str.length > 64 ? `${str.slice(0, 61)}…` : str;
    }

    if (body.mode === "text") {
      const textTpl = body.textBody && body.textBody.trim() ? body.textBody : undefined;
      return ok({
        mode: "text",
        dataMode,
        text: renderText(input, textTpl),
        subject: renderSubject(input, body.subject),
        availableVars: pluginVars,
        sampleValues,
      });
    }

    const htmlTpl = body.htmlBody && body.htmlBody.trim() ? body.htmlBody : undefined;
    return ok({
      mode: "html",
      dataMode,
      html: renderReport(input, htmlTpl),
      subject: renderSubject(input, body.subject),
      availableVars: pluginVars,
      sampleValues,
    });
  } catch (err) {
    return fail(err);
  }
}
