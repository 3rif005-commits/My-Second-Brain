/**
 * Settings → Skills (user decision, 2026-09-24) — free, and it leaves the
 * user's skills exactly as it found them: the edit is Reset, the new skill
 * deleted, and the original text is compared before and after.
 *
 *   npx playwright test --project=settings-skills
 */
import { test, expect } from "@playwright/test";

test.afterEach(async ({ page }) => {
  // Whatever happened above, the user's skills end as they began.
  await page.request.delete("/api/skills/e2e-temp-job").catch(() => {});
});

test("every skill is listed; a built-in can be edited and reset; a new job appears", async ({ page }) => {
  test.setTimeout(180_000);
  const original = await page.request.get("/api/skills/study-guide").then((r) => r.json());
  await page.goto("/brain/settings/skills", { waitUntil: "networkidle" });

  for (const group of [/job in the ai panel/i, /action on selected text/i, /assistant instructions/i])
    await expect(page.getByRole("heading", { name: group })).toBeVisible({ timeout: 90_000 });
  const row = page.locator("li", { hasText: "/study-guide" });
  await expect(row).toContainText("Built-in");

  // Edit the built-in: the user's copy wins, the label says so.
  await row.getByTitle("Edit").click();
  const body = page.getByPlaceholder("What the AI should do, step by step…");
  await expect(body).toHaveValue(original.body);
  await body.fill(original.body + "\nE2E marker line.");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.locator("li", { hasText: "/study-guide" })).toContainText("Edited", { timeout: 60_000 });
  expect((await page.request.get("/api/skills/study-guide").then((r) => r.json())).body)
    .toContain("E2E marker line.");

  // Reset: the original is back, byte for byte.
  await page.locator("li", { hasText: "/study-guide" }).getByTitle("Reset to the original").click();
  await page.getByRole("dialog").getByRole("button", { name: /^reset$/i }).click();
  await expect(page.locator("li", { hasText: "/study-guide" })).toContainText("Built-in", { timeout: 60_000 });
  const after = await page.request.get("/api/skills/study-guide").then((r) => r.json());
  expect(after.body).toBe(original.body);

  // A new job, then gone again.
  await page.getByRole("button", { name: /new skill/i }).click();
  await page.getByPlaceholder("exam-questions").fill("e2e-temp-job");
  await page.getByPlaceholder(/write five exam questions/i).fill("A temporary job for a test.");
  await body.fill("Write one line.");
  await page.getByRole("button", { name: /^save$/i }).click();
  const temp = page.locator("li", { hasText: "/e2e-temp-job" });
  await expect(temp).toContainText("Yours", { timeout: 60_000 });
  await temp.getByTitle("Delete").click();
  await page.getByRole("dialog").getByRole("button", { name: /^delete$/i }).click();
  await expect(page.locator("li", { hasText: "/e2e-temp-job" })).toHaveCount(0, { timeout: 60_000 });
});
