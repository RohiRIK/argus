import { test, expect } from "@playwright/test";

// Runs after auth.spec (workers: 1, alphabetical), so the first-run admin already exists.
test.describe("Users & roles", () => {
  test("admin adds a Viewer; the Viewer signs in read-only and writes get 403", async ({ page, browser, baseURL }) => {
    await page.goto("/users");
    await expect(page.getByTestId("users-admin")).toBeVisible();

    await page.getByTestId("user-add-toggle").click();
    await page.getByLabel("Username").fill("e2e-viewer");
    await page.locator("#new-role").selectOption("viewer");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const password = (await page.getByTestId("temp-password").textContent())?.trim() ?? "";
    expect(password.length).toBeGreaterThanOrEqual(10);
    await expect(page.getByTestId("user-row-e2e-viewer")).toContainText("e2e-viewer");
    await expect(page.getByTestId("user-role-e2e-viewer")).toHaveValue("viewer");

    // A clean browser context: no suite-wide bearer key, so this is a real sign-in.
    const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: {} });
    const viewer = await ctx.newPage();
    await viewer.goto("/login");
    await viewer.getByLabel("Username").fill("e2e-viewer");
    await viewer.getByLabel("Password", { exact: true }).fill(password);
    await viewer.getByRole("button", { name: "Sign in" }).click();
    await expect(viewer).toHaveURL(/\/dashboard$/);
    await expect(viewer.getByTestId("view-only-badge")).toBeVisible();
    await expect(viewer.locator("[data-testid=account-role-label]:visible")).toHaveText("Viewer");
    await expect(viewer.locator("aside").first().getByTestId("nav-users")).toHaveCount(0);

    expect((await viewer.request.get("/api/jobs")).status()).toBe(200);
    const write = await viewer.request.post("/api/jobs", { data: {} });
    expect(write.status()).toBe(403);
    expect((await write.json()).error.message).toContain("Viewer");
    expect((await viewer.request.get("/api/users")).status()).toBe(403);

    await viewer.goto("/users");
    await expect(viewer.getByTestId("users-not-admin")).toBeVisible();

    // Admin disables the viewer → their next request is signed out.
    await page.getByTestId("user-toggle-e2e-viewer").click();
    await expect(page.getByTestId("users-notice")).toContainText("disabled");
    expect((await viewer.request.get("/api/jobs")).status()).toBe(401);
    await ctx.close();
  });

  test("Microsoft sign-in card shows why it is not live yet", async ({ page }) => {
    await page.goto("/users");
    await expect(page.getByTestId("entra-sign-in-card")).toBeVisible();
    await page.getByTestId("entra-sign-in-enabled").check();
    await page.getByTestId("entra-sign-in-save").click();
    // No Microsoft 365 connection in the E2E tenant-less setup.
    await expect(page.getByTestId("entra-sign-in-status")).toContainText("Connect Microsoft 365 first");
    // The sign-in page does not offer Microsoft until it is live.
    const providers = await page.request.get("/api/auth/providers");
    expect((await providers.json()).data.microsoft).toBe(false);
  });
});

test("old Settings URLs redirect to the new Users and My account pages", async ({ page }) => {
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/users$/);
  await page.goto("/settings/account");
  await expect(page).toHaveURL(/\/account$/);
});
