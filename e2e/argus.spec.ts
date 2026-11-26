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

    // Quick Setup is clean by default; manual credentials and permissions live under Advanced.
    await expect(page.getByTestId("one-click-deploy")).toBeVisible();
    await expect(page.getByTestId("manual-creds-panel")).toHaveCount(0);

    await page.getByTestId("seg-advanced").click();
    await expect(page.getByTestId("permissions-panel")).toBeVisible();
    await expect(page.getByTestId("revalidate-permissions")).toBeVisible();
  });

  test("catalog card opens the dedicated creation page (UX-C2)", async ({ page }) => {
    await page.goto("/catalog");
    await page.getByTestId("catalog-create-risky-users").click();
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
    await page.getByTestId("seg-advanced").click();
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByTestId("connection-result")).toBeVisible({ timeout: 10_000 });
  });

  test("settings: create, toggle, and delete a maintenance window", async ({ page }) => {
    await page.goto("/settings");
    const card = page.getByTestId("maintenance-windows-card");
    await expect(card).toBeVisible();

    await page.getByTestId("mw-name").fill("E2E Patch Window");
    await page.getByTestId("mw-add").click();

    const row = card.locator('[data-testid^="mw-row-"]').filter({ hasText: "E2E Patch Window" });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Enabled" }).click();
    await expect(row.getByRole("button", { name: "Disabled" })).toBeVisible();

    await row.getByRole("button", { name: "Delete" }).click();
    await expect(row).toHaveCount(0);
  });

  test("metric_delta condition persists across create and edit", async ({ page }) => {
    await page.goto("/jobs/new?report=secure-score");
    await page.getByTestId("job-name").fill("E2E Metric Delta");
    await page.getByTestId("job-recipients").fill("e2e@contoso.com");
    await page.getByTestId("job-condition").selectOption("metric_delta");
    await page.getByTestId("job-metric").fill("currentScore");
    await page.getByTestId("job-direction").selectOption("drop");
    await page.getByTestId("job-delta").fill("3");
    await page.getByTestId("submit-job").click();

    await expect(page).toHaveURL(/\/dashboard$/);
    const card = page.getByTestId("data-row").filter({ hasText: "E2E Metric Delta" });
    await expect(card).toBeVisible();

    await card.getByTestId("edit-job").click();
    await expect(page).toHaveURL(/\/jobs\/.+\/edit$/);
    await expect(page.getByTestId("job-condition")).toHaveValue("metric_delta");
    await expect(page.getByTestId("job-metric")).toHaveValue("currentScore");
    await expect(page.getByTestId("job-direction")).toHaveValue("drop");
    await expect(page.getByTestId("job-delta")).toHaveValue("3");
  });

  test("H4: a job with no recipients is saved paused with a reason, not silently active", async ({ page }) => {
    await page.goto("/jobs/new?report=secure-score");
    await page.getByTestId("job-name").fill("E2E No Recipients");
    await page.getByTestId("submit-job").click();
    await expect(page.getByTestId("job-error")).toContainText("Saved as paused");
    await expect(page).toHaveURL(/\/jobs\/.+\/edit$/);
  });

  test("templates: clone, dirty indicator, and delete custom template", async ({ page }) => {
    await page.goto("/templates?report=risky-users");
    await expect(page.getByTestId("preview-subject")).toBeVisible();

    await page.getByTestId("clone-template").click();
    await expect(page.getByTestId("template-name")).toHaveValue(/\(copy\)$/);
    await expect(page.getByTestId("delete-template")).toBeVisible();

    await page.getByTestId("template-subject").fill("[Custom] {{reportName}}");
    await expect(page.getByText("Unsaved")).toBeVisible();
    await page.getByTestId("save-template").click();
    await expect(page.getByTestId("template-save-msg")).toContainText("Saved.");

    await page.getByTestId("delete-template").click();
    await expect(page.getByTestId("delete-template")).toHaveCount(0);
  });

  test("integrations: one-click deploy UI and onboarding checklist at 1440px and 1280px", async ({ page }) => {
    for (const width of [1440, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard");
      await expect(page.getByTestId("onboarding-checklist")).toBeVisible();
      const overflowDash = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflowDash).toBe(false);

      await page.goto("/settings/integrations");
      await expect(page.getByTestId("one-click-deploy")).toBeVisible();
      await expect(page.getByTestId("deploy-azure-btn")).toBeVisible();
      await page.getByTestId("seg-advanced").click();
      await expect(page.getByTestId("sender-mailbox-panel")).toBeVisible();
      const overflowInt = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflowInt).toBe(false);
    }
  });

  test("recipients: create group, attach to job, and toggle sender mailbox strategy", async ({ page }) => {
    await page.goto("/settings/recipients");
    await expect(page.getByTestId("recipients-panel")).toBeVisible();

    await page.getByTestId("toggle-create-group").click();
    await page.getByText("Local Group").click();
    await page.getByTestId("new-group-name").fill("SecOps E2E Group");
    await page.getByTestId("new-group-static").fill("soc-e2e@contoso.com");
    await page.getByTestId("submit-create-group").click();

    await expect(page.getByTestId("group-resolved-emails")).toContainText("soc-e2e@contoso.com");

    await page.goto("/jobs/new?report=risky-users");
    await page.getByTestId("job-name").fill("Group Attached Job");
    const grpBtn = page.getByTestId("job-recipient-groups").getByRole("button", { name: /SecOps E2E Group/ });
    await grpBtn.click();
    await page.getByTestId("submit-job").click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const row = page.getByTestId("data-row").filter({ hasText: "Group Attached Job" });
    await row.getByTestId("edit-job").click();
    await expect(page).toHaveURL(/\/jobs\/.+\/edit$/);
    await expect(
      page.getByTestId("job-recipient-groups").getByRole("button", { name: /SecOps E2E Group/ }),
    ).toHaveClass(/border-primary/);

    await page.goto("/settings/integrations");
    await page.getByTestId("seg-advanced").click();
    const panel = page.getByTestId("sender-mailbox-panel");
    await panel.getByText("Create dedicated mailbox").click();
    await expect(page.getByTestId("dedicated-mailbox-address")).toBeVisible();
    await panel.getByText("Use existing mailbox").click();
    await expect(page.getByTestId("existing-mailbox-input")).toBeVisible();
  });
});
