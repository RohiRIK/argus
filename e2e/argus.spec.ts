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

  test("AC-OP15: mobile drawer opens, navigates, and closes on route change", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");

    // Desktop sidebar link is hidden at this width; the toggle is the only way in.
    const toggle = page.getByTestId("nav-toggle");
    await expect(toggle).toBeVisible();
    await toggle.click();

    // Scope to the open drawer (the desktop aside also carries these testids but is
    // display:none at this width). Clicking a link routes and auto-closes the drawer.
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await drawer.getByTestId("nav-catalog").click();
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(drawer).toBeHidden();
  });

  test("AC-UX6: command palette opens (⌘K), filters, and navigates", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Meta+k");
    const input = page.getByTestId("command-input");
    await expect(input).toBeVisible();
    await input.fill("catalog");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/catalog$/);
  });

  test("templates: deep-link preselects a report's template (UX-T)", async ({ page }) => {
    await page.goto("/templates?report=risky-users");
    // The matching template is preselected and the HTML editor is shown.
    await expect(page.getByTestId("template-item-risky-users")).toBeVisible();
    await expect(page.getByTestId("editor-html")).toBeVisible();
    const frame = page.frameLocator('iframe[title="preview"]');
    await expect(frame.locator("body")).toContainText("Risky Users Report", { timeout: 10_000 });
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

  test("settings: General default, Integrations sub-nav, permissions folded into M365 (UX-S)", async ({ page }) => {
    await page.goto("/dashboard");
    // No top-level Integrations in the sidebar.
    await expect(page.getByTestId("nav-integrations")).toHaveCount(0);

    await page.getByTestId("nav-settings").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("general-panel")).toBeVisible();
    await expect(page.getByTestId("settings-tab-integrations")).toBeVisible();

    await page.getByTestId("settings-tab-integrations").click();
    await expect(page).toHaveURL(/\/settings\/integrations$/);
    await expect(page.getByTestId("integrations-panel")).toBeVisible();
    await expect(page.getByTestId("m365-status")).toBeVisible();

    // Permissions are folded into the Microsoft 365 vendor card (no standalone tab).
    await expect(page.getByTestId("permissions-panel")).toBeVisible();
    await expect(page.getByTestId("revalidate-permissions")).toBeVisible();
  });

  test("catalog card opens the dedicated creation page (UX-C2)", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByTestId("catalog-card-risky-users").click();
    await expect(page).toHaveURL(/\/jobs\/new\?report=risky-users/);
    await page.getByTestId("job-recipients").fill("ops@contoso.com");
    await page.getByTestId("submit-job").click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Risky Users Report")).toBeVisible();
  });

  test("quick preset pre-fills the creation form, then job lands on dashboard (UX-P2)", async ({ page }) => {
    await page.goto("/jobs/new");
    await page.getByTestId("preset-daily-email").click();
    await page.getByTestId("job-name").fill("E2E Sign-in Job");
    await page.getByTestId("job-recipients").fill("e2e@contoso.com");
    await page.getByTestId("submit-job").click();
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
    const card = page.getByTestId("data-row").filter({ hasText: "E2E Run Job" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /Run/ }).click();
    const logsLink = card.getByRole("link", { name: "Logs" });
    await expect(logsLink).toBeVisible({ timeout: 20_000 });
    await logsLink.click();
    await expect(page).toHaveURL(/\/executions\//);
    await expect(page.getByRole("heading", { name: "Console" })).toBeVisible();
  });

  test("edit a job from the dashboard and save changes (UX-E)", async ({ page }) => {
    await page.request.post("/api/jobs", {
      data: { name: "E2E Edit Job", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily", recipients: ["e2e@contoso.com"] },
    });
    await page.goto("/dashboard");
    const card = page.getByTestId("data-row").filter({ hasText: "E2E Edit Job" });
    await card.getByTestId("edit-job").click();
    await expect(page).toHaveURL(/\/jobs\/.+\/edit$/);
    const name = page.getByTestId("job-name");
    await expect(name).toHaveValue("E2E Edit Job");
    await name.fill("E2E Edited Job");
    await page.getByTestId("submit-job").click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("E2E Edited Job")).toBeVisible();
  });

  test("duplicate a job pre-fills the creation form with a copy (UX-CL)", async ({ page }) => {
    await page.request.post("/api/jobs", {
      data: { name: "E2E Clone Src", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily", recipients: ["e2e@contoso.com"] },
    });
    await page.goto("/dashboard");
    const card = page.getByTestId("data-row").filter({ hasText: "E2E Clone Src" });
    await card.getByTestId("edit-job").click();
    await page.getByTestId("duplicate-job").click();
    await expect(page).toHaveURL(/\/jobs\/new\?clone=/);
    await expect(page.getByTestId("job-name")).toHaveValue("E2E Clone Src (copy)");
    await page.getByTestId("submit-job").click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("E2E Clone Src (copy)")).toBeVisible();
  });

  test("tags: create a tagged job and filter the dashboard by tag (UX-TG)", async ({ page }) => {
    await page.request.post("/api/jobs", {
      data: { name: "E2E Tagged Job", reportType: "sign-in-anomalies", scheduleType: "preset", schedulePreset: "daily", recipients: ["e2e@contoso.com"], tags: ["e2etag"] },
    });
    await page.goto("/dashboard");
    await expect(page.getByTestId("data-row").filter({ hasText: "E2E Tagged Job" })).toBeVisible();
    await page.getByTestId("tag-e2etag").click();
    await expect(page.getByTestId("data-row").filter({ hasText: "E2E Tagged Job" })).toBeVisible();
  });

  test("settings Test Connection reports a result", async ({ page }) => {
    await page.goto("/settings/integrations");
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByTestId("connection-result")).toBeVisible({ timeout: 10_000 });
  });
});
