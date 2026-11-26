import { test, expect } from "@playwright/test";

// Plan H1: anonymous traffic reaches only the login flow and a minimal health probe.
test.describe("Operator access gate", () => {
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

  test("pages redirect to sign-in; a wrong key is refused; the right key returns to the page", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);

    const field = page.getByLabel("Access key");
    await field.fill("argus_wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("#login-error")).toContainText("not valid");

    await field.fill(process.env.ARGUS_ACCESS_KEY ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/settings$/);

    // Signed in via cookie: protected API now answers.
    expect((await page.request.get("/api/jobs")).status()).toBe(200);

    await page.locator("[data-testid=sign-out]:visible").click();
    await expect(page).toHaveURL(/\/login/);
    expect((await page.request.get("/api/jobs")).status()).toBe(401);
  });
});
