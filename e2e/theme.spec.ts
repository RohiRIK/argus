import { test, expect } from "@playwright/test";

/**
 * Theme system (spec P2 / AC-TH1, TH2, TH4, TH6).
 *
 * No-flash persistence uses the same proven mechanism as dark/light: a
 * beforeInteractive inline script reads localStorage and sets data-theme before
 * paint. So we assert persistence across reload (the practical no-flash proof)
 * rather than a raw-SSR-HTML attribute (which a cookie approach would give).
 */

const ALT_THEMES = ["slate-bone", "carbon-coral", "ink-sky", "paper-ink"] as const;

async function geometry(page: import("@playwright/test").Page) {
  return page.getByTestId("general-panel").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderRadius };
  });
}

test("theme switch re-tints, is layout-invariant, and persists (AC-TH1/2/4/6)", async ({ page }) => {
  await page.goto("/settings");
  const picker = page.getByTestId("theme-picker");
  await expect(picker).toBeVisible();

  // Default palette = no data-theme attribute.
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();

  const baseline = await geometry(page);

  // Each theme sets data-theme (default clears it) and never moves the layout.
  for (const t of [...ALT_THEMES, "graphite-amber"]) {
    await picker.selectOption(t);
    const attr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(attr).toBe(t === "graphite-amber" ? null : t);

    const now = await geometry(page);
    expect(now.w).toBe(baseline.w);
    expect(now.h).toBe(baseline.h);
    expect(now.radius).toBe(baseline.radius); // AC-TH4: radius never changes with theme
  }

  // AC-TH2: persists across reload (no-flash inline script re-applies).
  await picker.selectOption("slate-bone");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("slate-bone");
  await expect(page.getByTestId("theme-picker")).toHaveValue("slate-bone");
});
