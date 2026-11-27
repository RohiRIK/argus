export type VisualSectionKey = "anomaly" | "diff" | "intro" | "summary" | "kpis" | "table";
export type VisualPresetId = "operator" | "soc" | "executive" | "minimal";

export interface VisualTemplateConfig {
  preset: VisualPresetId;
  accentColor: string;
  headerStyle: "clean" | "banner" | "left-accent";
  density: "comfortable" | "compact";
  showOrgName: boolean;
  showCategoryDate: boolean;
  showAnomalyBanner: boolean;
  showDiffBanner: boolean;
  showSummary: boolean;
  showKpiCards: boolean;
  showDetailsTable: boolean;
  customIntro: string;
  customFooter: string;
  sectionOrder: VisualSectionKey[];
}

const DEFAULT_ORDER: VisualSectionKey[] = ["anomaly", "diff", "intro", "summary", "kpis", "table"];

export const VISUAL_PRESETS: Record<
  VisualPresetId,
  { label: string; description: string; config: VisualTemplateConfig }
> = {
  operator: {
    label: "Operator Clean",
    description: "Balanced white card with KPI cards, banners, and data table.",
    config: {
      preset: "operator",
      accentColor: "#2563eb",
      headerStyle: "clean",
      density: "comfortable",
      showOrgName: true,
      showCategoryDate: true,
      showAnomalyBanner: true,
      showDiffBanner: true,
      showSummary: true,
      showKpiCards: true,
      showDetailsTable: true,
      customIntro: "",
      customFooter: "",
      sectionOrder: [...DEFAULT_ORDER],
    },
  },
  soc: {
    label: "SOC Incident Alert",
    description: "High-contrast alert banner header with banners first and compact spacing.",
    config: {
      preset: "soc",
      accentColor: "#dc2626",
      headerStyle: "banner",
      density: "compact",
      showOrgName: true,
      showCategoryDate: true,
      showAnomalyBanner: true,
      showDiffBanner: true,
      showSummary: true,
      showKpiCards: true,
      showDetailsTable: true,
      customIntro: "Immediate triage recommended for high-severity findings in {{organization_name}}.",
      customFooter: "Security Operations · Argus M365 Monitoring",
      sectionOrder: ["anomaly", "diff", "intro", "kpis", "summary", "table"],
    },
  },
  executive: {
    label: "Executive Brief",
    description: "Accent bar header, polished lead note, summary and clean KPI callouts.",
    config: {
      preset: "executive",
      accentColor: "#0f172a",
      headerStyle: "left-accent",
      density: "comfortable",
      showOrgName: true,
      showCategoryDate: true,
      showAnomalyBanner: true,
      showDiffBanner: false,
      showSummary: true,
      showKpiCards: true,
      showDetailsTable: true,
      customIntro: "Automated compliance & security briefing prepared for {{organization_name}}.",
      customFooter: "Confidential — Internal Microsoft 365 Governance Report",
      sectionOrder: ["intro", "kpis", "summary", "anomaly", "table", "diff"],
    },
  },
  minimal: {
    label: "Minimalist Digest",
    description: "Crisp compact summary + table without large KPI tiles.",
    config: {
      preset: "minimal",
      accentColor: "#334155",
      headerStyle: "clean",
      density: "compact",
      showOrgName: true,
      showCategoryDate: true,
      showAnomalyBanner: true,
      showDiffBanner: false,
      showSummary: true,
      showKpiCards: false,
      showDetailsTable: true,
      customIntro: "",
      customFooter: "",
      sectionOrder: ["anomaly", "summary", "table", "diff", "intro", "kpis"],
    },
  },
};

function sanitizeHex(hex: string): string {
  const cleaned = hex.trim();
  return /^#[0-9a-fA-F]{6}$/.test(cleaned) ? cleaned : "#2563eb";
}

/** Encode UTF-8 string to base64 safely in both Node/Bun and browser environments. */
function toBase64(text: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(text, "utf8").toString("base64");
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Escape static user-entered HTML text while leaving {{tokens}} intact. */
function escapeKeepingTokens(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Compile a visual config into Outlook-safe, responsive table HTML compatible with Argus `renderReport()`. */
export function compileVisualTemplate(config: VisualTemplateConfig): string {
  const accent = sanitizeHex(config.accentColor);
  const pad = config.density === "compact" ? "18px 18px 16px" : "24px 24px 20px";
  const kpiPad = config.density === "compact" ? "10px 10px" : "14px 12px";

  const metaParts: string[] = [];
  if (config.showOrgName) metaParts.push("{{organization_name}}");
  if (config.showCategoryDate) metaParts.push("{{categoryLabel}}", "{{timestamp}}");
  const metaLine = metaParts.join(" · ");

  let headerBlock = "";
  if (config.headerStyle === "banner") {
    headerBlock = `<tr>
    <td style="padding:18px 24px;background:${accent};color:#ffffff;border-radius:8px 8px 0 0">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 4px;color:#ffffff">{{reportName}}</h1>${
        metaLine ? `\n      <p style="color:#e2e8f0;font-size:13px;margin:0">${metaLine}</p>` : ""
      }
    </td>
  </tr>`;
  } else if (config.headerStyle === "left-accent") {
    headerBlock = `<tr>
    <td style="padding:${pad};padding-bottom:8px">
      <div style="border-left:4px solid ${accent};padding-left:12px">
        <h1 style="font-size:20px;line-height:1.3;margin:0 0 4px;color:#0f172a">{{reportName}}</h1>${
          metaLine ? `\n        <p style="color:#475569;font-size:13px;margin:0">${metaLine}</p>` : ""
        }
      </div>
    </td>
  </tr>`;
  } else {
    headerBlock = `<tr>
    <td style="padding:${pad};padding-bottom:8px;border-bottom:2px solid ${accent}1f">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 4px;color:#0f172a">{{reportName}}</h1>${
        metaLine ? `\n      <p style="color:#475569;font-size:13px;margin:0">${metaLine}</p>` : ""
      }
    </td>
  </tr>`;
  }

  const sections: Record<VisualSectionKey, string> = {
    anomaly: config.showAnomalyBanner ? "{{anomalyBanner}}" : "",
    diff: config.showDiffBanner ? "{{diffBanner}}" : "",
    intro: config.customIntro.trim()
      ? `<p style="font-size:13px;line-height:1.5;margin:0 0 14px;padding:10px 12px;background:#f8fafc;border-left:3px solid ${accent};color:#334155">${escapeKeepingTokens(config.customIntro.trim())}</p>`
      : "",
    summary: config.showSummary
      ? `<p style="font-size:14px;line-height:1.55;margin:0 0 16px;color:#1e293b">{{executiveSummary}}</p>`
      : "",
    kpis: config.showKpiCards
      ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:14px 0">
        <tr>
          <td width="48%" style="width:48%;padding:${kpiPad};background:#f8fafc;border:1px solid #e2e8f0;border-top:3px solid ${accent};border-radius:8px;text-align:center;vertical-align:top">
            <div style="font-size:28px;font-weight:700;line-height:1.2;color:#0f172a">{{count}}</div>
            <div style="font-size:12px;color:#475569;margin-top:4px">primary metric</div>
          </td>
          <td width="4%" style="width:4%"></td>
          <td width="48%" style="width:48%;padding:${kpiPad};background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;text-align:center;vertical-align:top">
            <div style="font-size:24px;font-weight:700;line-height:1.35;color:#0f172a">{{trendArrow}} {{trendDisplay}}</div>
            <div style="font-size:12px;color:#475569;margin-top:4px">{{trendCaption}}</div>
          </td>
        </tr>
      </table>`
      : "",
    table: config.showDetailsTable ? "{{detailsTable}}" : "",
  };

  const renderedSections = config.sectionOrder
    .map((key) => sections[key])
    .filter(Boolean)
    .map((block) => `      ${block}`)
    .join("\n");

  const footerText = config.customFooter.trim()
    ? `${escapeKeepingTokens(config.customFooter.trim())} · `
    : "";

  const encoded = toBase64(JSON.stringify(config));

  return `<!-- argus-visual:${encoded} -->
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a202c">
  ${headerBlock}
  <tr>
    <td style="padding:${pad};padding-top:16px">
${renderedSections}
      <p style="font-size:12px;color:#64748b;margin:20px 0 0;border-top:1px solid #e2e8f0;padding-top:12px">${footerText}Sent by Argus · {{organization_name}} · execution {{executionId}}</p>
    </td>
  </tr>
</table>`;
}

/** Restore visual builder state from an HTML template created by `compileVisualTemplate()`, or null for custom HTML. */
export function parseVisualConfig(html: string): VisualTemplateConfig | null {
  const m = html.match(/<!--\s*argus-visual:([A-Za-z0-9+/=]+)\s*-->/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(fromBase64(m[1])) as Partial<VisualTemplateConfig>;
    if (!parsed || typeof parsed !== "object") return null;
    const base = VISUAL_PRESETS[parsed.preset && parsed.preset in VISUAL_PRESETS ? parsed.preset : "operator"].config;
    const order = Array.isArray(parsed.sectionOrder)
      ? DEFAULT_ORDER.filter((k) => parsed.sectionOrder!.includes(k)).concat(
          DEFAULT_ORDER.filter((k) => !parsed.sectionOrder!.includes(k)),
        )
      : [...base.sectionOrder];
    const resolvedOrder = Array.isArray(parsed.sectionOrder) && parsed.sectionOrder.length === DEFAULT_ORDER.length
      ? (parsed.sectionOrder as VisualSectionKey[])
      : order;

    return {
      ...base,
      ...parsed,
      accentColor: sanitizeHex(parsed.accentColor ?? base.accentColor),
      sectionOrder: resolvedOrder,
    };
  } catch {
    return null;
  }
}

const VOID_TAGS = new Set(["meta", "link", "br", "hr", "img", "input", "col"]);

/** Lightweight deterministic HTML formatter for the CodeMirror editor Format action. */
export function formatHtmlSource(source: string): string {
  const compact = source
    .replace(/>\s*</g, ">\n<")
    .trim();
  const lines = compact.split("\n");
  let indent = 0;
  const out: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const isClosing = /^<\/[a-zA-Z0-9-]+>/.test(line);
    if (isClosing) indent = Math.max(0, indent - 1);

    out.push(`${"  ".repeat(indent)}${line}`);

    const openMatch = line.match(/^<([a-zA-Z0-9-]+)(?:\s[^>]*)?>$/);
    if (
      openMatch &&
      !VOID_TAGS.has(openMatch[1].toLowerCase()) &&
      !/\/>$/.test(line) &&
      !line.includes(`</${openMatch[1]}>`)
    ) {
      indent += 1;
    }
  }
  return out.join("\n");
}
