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
    await expect(page.getByText("Nothing in the catalog matches")).toBeVisible();
    await page.getByTestId("clear-filters").click();
    await expect(page.locator('[data-testid^="catalog-card-"]')).toHaveCount(before);
  });

  test("type filter: Reports / Automations narrow the grid, All restores", async ({ page }) => {
    await page.goto("/catalog");
    const cards = page.locator('[data-testid^="catalog-card-"]');
    const all = await cards.count();

    await page.getByTestId("catalog-type-automation").click();
    await expect(page).toHaveURL(/\/catalog\?type=automation/);
    await expect(page.locator('[data-testid^="catalog-card-"][data-item-type="report"]')).toHaveCount(0);
    const autos = await page.locator('[data-testid^="catalog-card-"][data-item-type="automation"]').count();
    expect(autos).toBeGreaterThan(0);

    await page.getByTestId("catalog-type-report").click();
    await expect(page.locator('[data-testid^="catalog-card-"][data-item-type="automation"]')).toHaveCount(0);
    const reports = await cards.count();
    expect(reports + autos).toBe(all);

    await page.getByTestId("catalog-type-all").click();
    await expect(cards).toHaveCount(all);
  });

  test("automation card: type + risk, Set up opens the audit-mode policy dialog", async ({ page }) => {
    await page.goto("/catalog?type=automation");
    const card = page.getByTestId("catalog-card-high-risk-user-containment");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-item-type", "automation");
    await expect(page.getByTestId("catalog-risk-high-risk-user-containment")).toBeVisible();
    await expect(card.getByText("Based on report:")).toBeVisible();

    await page.getByTestId("catalog-setup-high-risk-user-containment").click();
    const dialog = page.getByRole("dialog", { name: "New automation policy" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Starts in Audit mode/)).toBeVisible();
  });

  test("automation drawer links to its report; report drawer links back", async ({ page }) => {
    await page.goto("/catalog?type=automation");
    await page.getByTestId("catalog-card-high-risk-user-containment").click();
    await expect(page.getByTestId("catalog-drawer")).toHaveAttribute("data-item-type", "automation");
    await expect(page.getByTestId("catalog-drawer-perms")).toBeVisible();
    await expect(page.getByTestId("catalog-drawer-setup")).toHaveText("Set up automation");

    await page.getByTestId("catalog-drawer-report-link").click();
    await expect(page.getByTestId("catalog-drawer")).toHaveAttribute("data-item-type", "report");
    await expect(page.getByTestId("catalog-drawer-name")).toContainText(/Risky Users/i);
    await page.getByTestId("catalog-drawer-automation-link-high-risk-user-containment").click();
    await expect(page.getByTestId("catalog-drawer-name")).toContainText(/High-Risk User/i);
  });

  test("report card shows 'Can be automated' for a paired automation", async ({ page }) => {
    await page.goto("/catalog?type=report");
    await expect(page.getByTestId("catalog-pairing-risky-users")).toContainText("Can be automated:");
    await expect(page.getByTestId("catalog-card-risky-users")).toHaveAttribute("data-item-type", "report");
  });

  test("/automations/catalog redirects to the unified catalog filtered to automations", async ({ page }) => {
    await page.goto("/automations/catalog");
    await expect(page).toHaveURL(/\/catalog\?type=automation/);
    await expect(page.getByTestId("catalog-type-automation")).toHaveAttribute("aria-pressed", "true");
  });

  test("packs strip shows report and automation packs", async ({ page }) => {
    await page.goto("/catalog");
    await expect(page.getByTestId("catalog-pack-secops")).toHaveAttribute("data-pack-type", "report");
    await expect(page.getByTestId("catalog-pack-zero-trust-guardrails")).toHaveAttribute("data-pack-type", "automation");
  });

  test("E1.3: category filter narrows the grid", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByTestId("catalog-category-security").click();
    const cards = page.locator('[data-testid^="catalog-card-"]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBe(await page.locator('[data-testid^="catalog-card-"][data-category="security"]').count());
  });
});
