import { test, expect } from "@playwright/test";

test.describe("Argus — navigation & workflows", () => {
  test("sidebar navigation routes between sections (real clicks)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByTestId("nav-catalog").click();
    await expect(page).toHaveURL(/\/catalog$/);

    await page.getByTestId("nav-templates").click();
    await expect(page).toHaveURL(/\/templates/);

    await page.getByTestId("nav-logs").click();
    await expect(page).toHaveURL(/\/logs$/);

    await page.getByTestId("nav-settings").click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("catalog: clicking a report opens its template editor (AC-C1, AC-E2)", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByTestId("catalog-card-risky-users").click();
    await expect(page).toHaveURL(/\/templates\?report=risky-users/);
    // The matching template is preselected and the HTML editor is shown.
    await expect(page.getByTestId("template-item-risky-users")).toBeVisible();
    await expect(page.getByTestId("editor-html")).toBeVisible();
    const frame = page.frameLocator('iframe[title="preview"]');
    await expect(frame.locator("body")).toContainText("Daily Sign-in Anomalies", { timeout: 10_000 });
  });

  test("template editor: HTML ↔ Text toggle switches editor + preview (AC-T1)", async ({ page }) => {
    await page.goto("/templates");
    await expect(page.getByTestId("editor-html")).toBeVisible();
    await expect(page.getByTestId("preview-html")).toBeVisible();

    await page.getByTestId("seg-text").click();
    await expect(page.getByTestId("editor-text")).toBeVisible();
    await expect(page.getByTestId("preview-text")).toBeVisible();
    await expect(page.getByTestId("editor-html")).toHaveCount(0);

    await page.getByTestId("seg-html").click();
    await expect(page.getByTestId("editor-html")).toBeVisible();
    await expect(page.getByTestId("preview-text")).toHaveCount(0);
  });

  test("settings: Integrations lives under Settings sub-nav (AC-S1/S2, AC-E4)", async ({ page }) => {
    await page.goto("/dashboard");
    // No top-level Integrations in the sidebar.
    await expect(page.getByTestId("nav-integrations")).toHaveCount(0);

    await page.getByTestId("nav-settings").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("settings-tab-integrations")).toBeVisible();

    await page.getByTestId("settings-tab-integrations").click();
    await expect(page).toHaveURL(/\/settings\/integrations$/);
    await expect(page.getByTestId("integrations-panel")).toBeVisible();
    await expect(page.getByText("Microsoft 365")).toBeVisible();

    await page.getByTestId("settings-tab-permissions").click();
    await expect(page).toHaveURL(/\/settings\/permissions$/);
    await expect(page.getByTestId("permissions-panel")).toBeVisible();
  });

  test("create a job from the catalog form, then see it on the dashboard", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByPlaceholder("defaults to report name").fill("E2E Sign-in Job");
    await page.getByPlaceholder("admin@contoso.com").fill("e2e@contoso.com");
    await page.getByRole("button", { name: "Create job" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("E2E Sign-in Job")).toBeVisible();
  });

  test("run a job and open its execution console", async ({ page }) => {
    const res = await page.request.post("/api/jobs", {
      data: {
        name: "E2E Run Job",
        reportType: "sign-in-anomalies",
        scheduleType: "preset",
        schedulePreset: "daily",
        recipients: ["e2e@contoso.com"],
      },
    });
    expect(res.ok()).toBeTruthy();

    await page.goto("/dashboard");
    const card = page.getByTestId("job-card").filter({ hasText: "E2E Run Job" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /Run/ }).click();
    const logsLink = card.getByRole("link", { name: "Logs" });
    await expect(logsLink).toBeVisible({ timeout: 20_000 });
    await logsLink.click();
    await expect(page).toHaveURL(/\/executions\//);
    await expect(page.getByRole("heading", { name: "Console" })).toBeVisible();
  });

  test("settings Test Connection reports a result", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText(/Auth|failed|OK/i)).toBeVisible({ timeout: 10_000 });
  });
});
