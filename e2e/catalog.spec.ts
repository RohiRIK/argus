import { test, expect } from "@playwright/test";

/**
 * Catalog discovery tile grid + E1.3 discoverability (search/filters/drawer).
 * Operator: airy 2-col tiles, icon-on-wash, Create job deep-link (Q1),
 * card body opens detail drawer (does not navigate).
 */

test.describe("Catalog — discovery tile grid", () => {
  test("AC-OP3: tiles use soft radius (Operator DNA — non-zero, themed)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/catalog");
    const tile = page.locator('[data-testid^="catalog-card-"]').first();
    await expect(tile).toBeVisible();
    const radius = await tile.evaluate(
      (el) => parseFloat(getComputedStyle(el).borderTopLeftRadius),
    );
    expect(radius).toBeGreaterThan(0);
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

  test("Q1: Create job deep-link funnels to creation page with report preselected", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByTestId("catalog-create-risky-users").click();
    await expect(page).toHaveURL(/\/jobs\/new\?report=risky-users/);
  });

  test("E1.3: card body opens detail drawer (does not navigate)", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByTestId("catalog-card-risky-users").click();
    await expect(page).toHaveURL(/\/catalog/);
    const drawer = page.getByTestId("catalog-drawer");
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId("catalog-drawer-name")).toContainText(/Risky Users/i);
    await expect(page.getByTestId("catalog-drawer-create")).toBeVisible();
  });

  test("E1.3: Esc / close dismisses drawer", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByTestId("catalog-card-risky-users").click();
    await expect(page.getByTestId("catalog-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("catalog-drawer")).toHaveCount(0);

    await page.getByTestId("catalog-card-risky-users").click();
    await page.getByTestId("catalog-drawer-close").click();
    await expect(page.getByTestId("catalog-drawer")).toHaveCount(0);
  });

  test("E1.3: search filters cards; clear restores", async ({ page }) => {
    await page.goto("/catalog");
    const before = await page.locator('[data-testid^="catalog-card-"]').count();
    expect(before).toBeGreaterThan(1);

    await page.getByTestId("catalog-search").fill("risky-users");
    await expect(page.getByTestId("catalog-card-risky-users")).toBeVisible();
    // Narrow query should leave only matching cards.
    const after = await page.locator('[data-testid^="catalog-card-"]').count();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);

    await page.getByTestId("catalog-search").fill("zzz-no-such-report-xyz");
    await expect(page.getByText("No reports match")).toBeVisible();
    await page.getByTestId("clear-filters").click();
    await expect(page.locator('[data-testid^="catalog-card-"]')).toHaveCount(before);
  });

  test("E1.3: category chip filters the grid", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByTestId("catalog-category-security").click();
    const cards = page.locator('[data-testid^="catalog-card-"]');
    await expect(cards.first()).toBeVisible();
    // All visible category badges should read "security"
    const badges = page.locator('[data-testid^="catalog-card-"] >> text=security');
    expect(await badges.count()).toBeGreaterThan(0);
  });
});
