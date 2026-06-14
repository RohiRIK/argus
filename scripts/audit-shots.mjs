// Live UX interceptor: drive every page + key flows, capture console errors,
// failed network, and full-page screenshots (dark + light) for visual audit.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:8100";
const OUT = "/tmp/argus-shots";
mkdirSync(OUT, { recursive: true });

const pages = [
  ["dashboard", "/dashboard"],
  ["catalog", "/catalog"],
  ["templates", "/templates"],
  ["templates-report", "/templates?report=risky-users"],
  ["logs", "/logs"],
  ["settings", "/settings"],
  ["settings-integrations", "/settings/integrations"],
  ["settings-permissions", "/settings/permissions"],
];

const findings = [];
const browser = await chromium.launch();

for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem("argus-theme", t), theme);

  page.on("console", (m) => {
    if (m.type() === "error") findings.push({ theme, kind: "console", text: m.text() });
  });
  page.on("pageerror", (e) => findings.push({ theme, kind: "pageerror", text: e.message }));
  page.on("response", (r) => {
    if (r.status() >= 400) findings.push({ theme, kind: "http", text: `${r.status()} ${r.url()}` });
  });

  for (const [name, path] of pages) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, fullPage: true });
      console.log(`shot ${name}-${theme}`);
    } catch (e) {
      findings.push({ theme, kind: "nav", text: `${name}: ${e.message}` });
    }
  }
  await ctx.close();
}

// Flow audit (dark only): catalog → template editor → create-job dialog
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
page.on("pageerror", (e) => findings.push({ theme: "flow", kind: "pageerror", text: e.message }));
try {
  await page.goto(`${BASE}/catalog`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  // click first report card
  const card = page.locator("[data-testid^='report-card'], a[href^='/templates?report=']").first();
  await card.click();
  await page.waitForURL(/templates\?report=/, { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/flow-1-editor.png`, fullPage: true });
  // open create-job dialog
  await page.locator("[data-testid='open-create-job']").click();
  await page.waitForTimeout(400);
  await page.locator("[data-testid='create-job-dialog']").waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/flow-2-create-job.png`, fullPage: true });
  console.log("flow ok");
} catch (e) {
  findings.push({ theme: "flow", kind: "flow", text: e.message });
}
await ctx.close();
await browser.close();

writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));
console.log(`\n=== ${findings.length} findings ===`);
for (const f of findings) console.log(`[${f.theme}/${f.kind}] ${f.text}`);
console.log("done");
