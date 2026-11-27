import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

/** Newest account email sent to `to` (the test server writes them to ARGUS_MAIL_OUTBOX). */
function lastMailTo(to: string): { subject: string; html: string } {
  const dir = process.env.ARGUS_MAIL_OUTBOX ?? "";
  const mails = readdirSync(dir)
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { to: string[]; subject: string; html: string })
    .filter((m) => m.to.includes(to));
  if (mails.length === 0) throw new Error(`no email to ${to}`);
  return mails[mails.length - 1]!;
}

const otpFrom = (html: string) => /One-time password<\/td><td[^>]*><strong>([^<]+)<\/strong>/.exec(html)?.[1] ?? "";

// Runs after auth.spec (workers: 1, alphabetical), so the first-run admin already exists.
test.describe("Users & roles", () => {
  test("admin adds a Viewer; the Viewer signs in read-only and writes get 403", async ({ page, browser, baseURL }) => {
    await page.goto("/users");
    await expect(page.getByTestId("users-admin")).toBeVisible();

    await page.getByTestId("user-add-toggle").click();
    await page.getByTestId("user-add-seg-local").click();
    await page.getByLabel("Email").fill("e2e-viewer@example.com");
    await page.locator("#new-role").selectOption("viewer");
    await page.getByTestId("user-add-submit").click();
    // The one-time password is emailed, never shown on the page.
    await expect(page.getByTestId("users-notice")).toContainText("emailed them a one-time password");
    await expect(page.getByTestId("users-notice")).not.toContainText(/[A-Za-z0-9]{14}/);
    await expect(page.getByTestId("user-role-e2e-viewer@example.com")).toHaveValue("viewer");
    const otp = otpFrom(lastMailTo("e2e-viewer@example.com").html);
    expect(otp).toHaveLength(14);

    // A clean browser context: no suite-wide bearer key, so this is a real sign-in.
    const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: {} });
    const viewer = await ctx.newPage();
    await viewer.goto("/login");
    await viewer.getByLabel("Username").fill("e2e-viewer@example.com");
    await viewer.getByLabel("Password", { exact: true }).fill(otp);
    await viewer.getByRole("button", { name: "Sign in" }).click();
    // One-time password → must choose their own before anything else.
    await expect(viewer).toHaveURL(/\/change-password\?next=%2Fdashboard$/);
    expect((await viewer.request.get("/api/jobs")).status()).toBe(403);
    await viewer.getByLabel("One-time password").fill(otp);
    await viewer.getByLabel("New password", { exact: true }).fill("viewer own password");
    await viewer.getByLabel("Confirm new password").fill("viewer own password");
    await viewer.getByRole("button", { name: "Set password and continue" }).click();
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
    await page.getByTestId("user-toggle-e2e-viewer@example.com").click();
    await expect(page.getByTestId("users-notice")).toContainText("disabled");
    expect((await viewer.request.get("/api/jobs")).status()).toBe(401);
    await ctx.close();
  });

  test("Add user offers Entra ID (invite) first, with password as the fallback", async ({ page }) => {
    await page.goto("/users");
    await page.getByTestId("user-add-toggle").click();
    await expect(page.getByTestId("user-add-seg-entra")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("entra-person-search")).toBeVisible();
    await expect(page.getByTestId("user-add-send-email")).toBeChecked();
    // Nobody picked yet → the Invite button stays disabled.
    await expect(page.getByTestId("user-add-submit")).toHaveText("Invite");
    await expect(page.getByTestId("user-add-submit")).toBeDisabled();
    // No group-mapping card any more: one table only.
    await expect(page.getByTestId("entra-sign-in-card")).toHaveCount(0);
    await expect(page.getByTestId("users-table")).toHaveCount(1);
    // The sign-in page offers Microsoft only once someone is invited from Entra ID.
    expect((await (await page.request.get("/api/auth/providers")).json()).data.microsoft).toBe(false);
  });
});

test("old Settings URLs redirect to the new Users and My account pages", async ({ page }) => {
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/users$/);
  await page.goto("/settings/account");
  await expect(page).toHaveURL(/\/account$/);
});
