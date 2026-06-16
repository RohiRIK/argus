import { test, expect, type Page } from "@playwright/test";

/**
 * Visual-regression baselines for the editorial overhaul (spec P0 / AC-E6, AC-A1).
 *
 * Captured BEFORE any visual restructuring so later phases can be diffed against
 * the current look. Playwright suffixes snapshots per-platform (…-darwin.png /
 * …-linux.png), so local (Darwin) baselines are for iteration diffing while CI
 * owns the canonical Linux set — this avoids font-rendering host drift.
 *
 * `toHaveScreenshot` disables CSS animations/transitions and hides the caret by
 * default. We additionally pin the viewport and mask non-deterministic regions
 * (relative timestamps, durations) so diffs reflect design, not clock drift.
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };

// Regions whose text changes run-to-run (seeded dates, "x minutes ago", durations).
function dynamicMasks(page: Page) {
  return [
    page.locator('[data-testid="relative-time"]'),
    page.locator("time"),
  ];
}

async function snapshot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    animations: "disabled",
    mask: dynamicMasks(page),
    maxDiffPixelRatio: 0.01,
  });
}

const PAGES: { path: string; name: string }[] = [
  { path: "/dashboard", name: "dashboard" },
  { path: "/catalog", name: "catalog" },
  { path: "/jobs/new", name: "jobs-new" },
  { path: "/templates", name: "templates" },
  { path: "/logs", name: "logs" },
  { path: "/settings", name: "settings" },
  { path: "/settings/integrations", name: "settings-integrations" },
];

test.describe("VR baselines — desktop", () => {
  test.use({ viewport: DESKTOP });
  for (const { path, name } of PAGES) {
    test(`desktop ${name}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await snapshot(page, `${name}-desktop.png`);
    });
  }
});

test.describe("VR baselines — mobile", () => {
  test.use({ viewport: MOBILE });
  for (const { path, name } of PAGES) {
    test(`mobile ${name}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await snapshot(page, `${name}-mobile.png`);
    });
  }
});
