import { renderReport, renderText, renderSubject, type RenderInput } from "@/services/report-engine/default-template";
import { getReport } from "@/services/reports/registry";
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

/** Representative sample data so authors see a realistic, report-specific preview (C3). */
function sampleInput(organizationName: string, reportType?: string): RenderInput {
  const report = reportType ? getReport(reportType) : undefined;
  const reportName = report?.name ?? "Daily Sign-in Anomalies";
  const summary = report?.description
    ? `${report.description} 14 items in this sample run — up 40% on the previous.`
    : "14 failed sign-ins detected — up 40% on the previous run.";
  return {
    reportName,
    organizationName,
    executionId: "preview-0000",
    count: 14,
    executiveSummary: summary,
    trendPercent: 40,
    trendDirection: "up",
    isAnomaly: true,
    baselineMean: 8.5,
    variables: {
      totalSignIns: 1280,
      failedSignIns: 14,
      legacyAuthSignIns: 3,
      distinctCountries: 5,
      topRiskUsers: "alice@contoso.com, bob@contoso.com",
    },
    rows: [
      { user: "alice@contoso.com", ip: "203.0.113.7", reason: "Invalid credentials", country: "DE" },
      { user: "bob@contoso.com", ip: "198.51.100.2", reason: "MFA required", country: "US" },
    ],
  };
}

/** POST /api/templates/preview — render a template body (html|text) with sample data. */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, schema);
    const input = sampleInput(body.organizationName ?? "Contoso Ltd", body.reportType);
    if (body.mode === "text") {
      return ok({ mode: "text", text: renderText(input, body.textBody), subject: renderSubject(input, body.subject) });
    }
    return ok({ mode: "html", html: renderReport(input, body.htmlBody), subject: renderSubject(input, body.subject) });
  } catch (err) {
    return fail(err);
  }
}
