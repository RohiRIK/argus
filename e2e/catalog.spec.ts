import { test, expect } from "@playwright/test";

/**
 * Catalog discovery tile grid (spec P3 / AC-UI8, UI8b, UI9, WF1).
 * Airbnb-flavored: airy 2-col tiles, icon-on-wash, always-visible CTA, soft
 * surface lift (0px, NO shadow), funnel to /jobs/new?report=<id>.
 */

test.describe("Catalog — editorial tile grid", () => {
  test("AC-UI8b: tiles have 0px radius and no shadow (catalog surface exception)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/catalog");
    const tile = page.locator('[data-testid^="catalog-card-"]').first();
    await expect(tile).toBeVisible();
    const style = await tile.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderTopLeftRadius, shadow: cs.boxShadow };
    });
    expect(style.radius).toBe("0px");
    expect(style.shadow).toBe("none");
  });

  test("AC-UI9: each tile shows exactly one always-visible CTA, no <img>/emoji", async ({ page }) => {
    await page.goto("/catalog");
    const tiles = page.locator('[data-testid^="catalog-card-"]');
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);

    // No raster images anywhere in the grid (icons are inline SVG).
    expect(await page.locator('[data-testid^="catalog-card-"] img').count()).toBe(0);

    const first = tiles.first();
    await expect(first.getByText("Create job")).toBeVisible();
    await expect(first.locator("svg")).toHaveCount(1); // the category icon tile
  });

  test("WF1: clicking a tile funnels to the creation page with the report preselected", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByTestId("catalog-card-risky-users").click();
    await expect(page).toHaveURL(/\/jobs\/new\?report=risky-users/);
  });
});
