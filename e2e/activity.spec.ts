import { test, expect } from "@playwright/test";

test.describe("Activity — unified runs, logs and events", () => {
  test("sidebar is Dashboard, Activity, Catalog, Templates + Settings", async ({ page }) => {
    await page.goto("/dashboard");
    const aside = page.locator("aside").first();
    const links = aside.locator("nav a");
    await expect(links).toHaveText(["Dashboard", "Activity", "Catalog", "Templates", "Settings"]);
    await expect(aside.getByTestId("nav-automations")).toHaveCount(0);
    await expect(aside.getByTestId("nav-activity")).toBeVisible();
    await expect(aside.getByTestId("nav-logs")).toHaveCount(0);
    await expect(aside.getByTestId("nav-automations-runs")).toHaveCount(0);
  });

  test("Runs tab is the default and filters by source and outcome", async ({ page }) => {
    await page.goto("/activity");
    await expect(page.getByTestId("activity-page")).toBeVisible();
    await expect(page.getByTestId("activity-seg-runs")).toHaveAttribute("aria-selected", "true");

    const filtered = page.waitForResponse((r) => r.url().includes("/api/runs") && r.url().includes("source=automation"));
    await page.getByTestId("run-source-filter").selectOption("automation");
    expect((await filtered).status()).toBe(200);
    await expect(page.locator('[data-testid="run-row"][data-source="report"]')).toHaveCount(0);

    const byOutcome = page.waitForResponse((r) => r.url().includes("/api/runs") && r.url().includes("outcome=failed"));
    await page.getByTestId("run-outcome-filter").selectOption("failed");
    expect((await byOutcome).status()).toBe(200);
  });

  test("Logs tab shows events (a failed sign-in) and keeps the tab in the URL", async ({ page }) => {
    // A rejected sign-in is recorded in the audit log, which the Logs tab shows as an event.
    const login = await page.request.post("/api/auth/login", {
      data: { username: "e2e-activity-probe", password: "wrong-password" },
    });
    expect(login.ok()).toBe(false);

    await page.goto("/activity");
    await page.getByTestId("activity-seg-logs").click();
    await expect(page).toHaveURL(/\/activity\?tab=logs$/);
    await page.getByTestId("log-source-filter").selectOption("event");
    await expect(
      page.locator('[data-testid="log-line"][data-source="event"]', { hasText: "Sign-in failed: e2e-activity-probe" }).first(),
    ).toBeVisible();
    await expect(page.locator('[data-testid="log-line"]:not([data-source="event"])')).toHaveCount(0);
  });

  test("/logs redirects to the Activity logs tab", async ({ page }) => {
    await page.goto("/logs");
    await expect(page).toHaveURL(/\/activity\?tab=logs$/);
    await expect(page.getByTestId("activity-seg-logs")).toHaveAttribute("aria-selected", "true");
  });
});

test("automation policy pages highlight Dashboard; run pages highlight Activity", async ({ page }) => {
  await page.goto("/automations");
  const aside = page.locator("aside").first();
  await expect(aside.getByTestId("nav-dashboard")).toHaveAttribute("aria-current", "page");
  await page.goto("/automations/runs");
  await expect(page.locator("aside").first().getByTestId("nav-activity")).toHaveAttribute("aria-current", "page");
});
