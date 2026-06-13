// Capture screenshots of every page for visual UX audit.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100";
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

const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  const page = await ctx.newPage();
  // seed theme in localStorage
  await page.addInitScript((t) => localStorage.setItem("argus-theme", t), theme);
  for (const [name, path] of pages) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, fullPage: true });
      console.log(`shot ${name}-${theme}`);
    } catch (e) {
      console.log(`FAIL ${name}-${theme}: ${e.message}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log("done");
