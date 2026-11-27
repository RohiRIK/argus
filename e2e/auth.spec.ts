import { test, expect } from "@playwright/test";

// Plan H1: anonymous traffic reaches only the sign-in flow and a minimal health probe.
// Operators sign in with a username + password; the first account is created on first run.
test.describe("Operator sign-in", () => {
  // Drop the suite-wide bearer header so these run as an anonymous visitor.
  test.use({ extraHTTPHeaders: {} });

  test("anonymous API calls are rejected and health is minimal", async ({ request }) => {
    const jobs = await request.get("/api/jobs");
    expect(jobs.status()).toBe(401);
    expect((await jobs.json()).error.code).toBe("UnauthorizedError");

    const vault = await request.put("/api/vault", { data: {} });
    expect(vault.status()).toBe(401);

    const health = await request.get("/api/health");
    expect(health.ok()).toBe(true);
    const body = await health.json();
    expect(Object.keys(body.data).sort()).toEqual(["status", "timestamp"]);
  });

  test("first run creates the admin; then sign out, wrong password, and sign back in", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);

    // Fresh E2E database: no account yet → create-admin form.
    await expect(page.getByRole("heading", { name: "Create the admin account" })).toBeVisible();
    await page.getByLabel("Username").fill("e2e-admin");
    await page.getByLabel("Password", { exact: true }).fill("e2e password 123");
    await page.getByLabel("Confirm password").fill("e2e password 123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("account-card")).toContainText("e2e-admin");
    expect((await page.request.get("/api/jobs")).status()).toBe(200);

    await page.locator("[data-testid=sign-out]:visible").click();
    await expect(page).toHaveURL(/\/login/);
    expect((await page.request.get("/api/jobs")).status()).toBe(401);

    await expect(page.getByRole("heading", { name: "Sign in to Argus" })).toBeVisible();
    await page.getByLabel("Username").fill("e2e-admin");
    await page.getByLabel("Password", { exact: true }).fill("not the password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("#login-error")).toContainText("incorrect");

    await page.getByLabel("Password", { exact: true }).fill("e2e password 123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
