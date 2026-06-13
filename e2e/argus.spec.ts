import { test, expect } from "@playwright/test";

test.describe("Argus app", () => {
  test("root redirects to dashboard with sidebar nav", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("link", { name: "Catalog", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  });

  test("catalog lists the full report set", async ({ page }) => {
    await page.goto("/catalog");
    await expect(page.getByRole("heading", { name: "Daily Sign-in Anomalies" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Device Compliance (Intune)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Manual Graph Query" })).toBeVisible();
  });

  test("create a job from the catalog then see it on the dashboard", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByPlaceholder("defaults to report name").fill("E2E Sign-in Job");
    await page.getByPlaceholder("admin@contoso.com").fill("e2e@contoso.com");
    await page.getByRole("button", { name: "Create job" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("E2E Sign-in Job")).toBeVisible();
  });

  test("run a job and view its execution console", async ({ page }) => {
    // Self-contained: seed a job via the API, then drive the UI.
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

  test("template editor renders a live preview", async ({ page }) => {
    await page.goto("/templates");
    await expect(page.getByRole("heading", { name: "Editor" })).toBeVisible();
    const frame = page.frameLocator('iframe[title="preview"]');
    await expect(frame.locator("body")).toContainText("Daily Sign-in Anomalies", { timeout: 10_000 });
  });

  test("settings Test Connection reports a result", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText(/Auth|failed|OK/i)).toBeVisible({ timeout: 10_000 });
  });
});
