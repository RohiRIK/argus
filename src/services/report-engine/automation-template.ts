/**
 * Default email template for automation runs. It lives in the same `templates`
 * table as the report template (type AUTOMATION_TEMPLATE_TYPE), so operators edit,
 * version, reset and preview it the same way, and seed upgrades it only while it
 * is unedited (managed + hash match).
 *
 * Variables: organization_name, policyName, automationName, modeLabel,
 * statusLabel, outcomeLabel, summary, evaluatedCount, plannedCount,
 * appliedCount, failedCount, runId, catalogId, catalogVersion, timestamp;
 * raw HTML fragment: actionsTable; plain text: actionsText.
 */
export const AUTOMATION_TEMPLATE_TYPE = "automation:*";

export const AUTOMATION_DEFAULT_SUBJECT = "[Argus {{modeLabel}}] {{policyName}} — {{outcomeLabel}}";

export const AUTOMATION_DEFAULT_HTML = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <tr>
    <td style="padding:24px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b">{{organization_name}} · Argus Automation</div>
      <h1 style="font-size:18px;line-height:1.3;margin:4px 0 4px;color:#0f172a">{{policyName}}</h1>
      <p style="color:#475569;font-size:12px;margin:0 0 14px">{{automationName}} · {{modeLabel}} · {{statusLabel}} · {{timestamp}}</p>
      <p style="font-size:13px;line-height:1.55;color:#334155;margin:0 0 14px">{{summary}}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12px">
        <tr>
          <td style="padding:10px 12px"><strong>Evaluated:</strong> {{evaluatedCount}}</td>
          <td style="padding:10px 12px"><strong>Planned / drift:</strong> {{plannedCount}}</td>
          <td style="padding:10px 12px"><strong>Applied:</strong> {{appliedCount}}</td>
          <td style="padding:10px 12px"><strong>Failed:</strong> {{failedCount}}</td>
        </tr>
      </table>
      {{actionsTable}}
      <p style="font-size:11px;color:#64748b;margin:18px 0 0;border-top:1px solid #e2e8f0;padding-top:12px">Run {{runId}} · {{catalogId}} v{{catalogVersion}} · Before/after snapshots are saved in Argus.</p>
    </td>
  </tr>
</table>`;

export const AUTOMATION_DEFAULT_TEXT = `{{organization_name}} — Argus Automation ({{modeLabel}})
Policy: {{policyName}} ({{automationName}})
Status: {{statusLabel}}
Summary: {{summary}}
Evaluated: {{evaluatedCount}} | Planned: {{plannedCount}} | Applied: {{appliedCount}} | Failed: {{failedCount}}

{{actionsText}}
— Run {{runId}}`;
