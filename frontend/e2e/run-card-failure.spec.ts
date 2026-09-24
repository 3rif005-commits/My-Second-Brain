/**
 * The run card's failure path — free: run the backend with MAX_USD_PER_RUN
 * far below any estimate, so every job is refused BEFORE a model is called.
 *
 *   (backend with MAX_USD_PER_RUN=0.001)  npx playwright test --project=run-card
 *
 * Checks the two things a unit test cannot: the banner names the job that
 * failed, and Retry calls THAT job — not the study guide it used to restart.
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const OUT = path.join(process.cwd(), "e2e/screenshots/run-card");

test("a refused compare-sources run is named, and Retry reruns it", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/brain/workspace", { waitUntil: "networkidle" });
  await page.getByText(/2 sources/).first().click();
  await page.waitForURL(/\/brain\/workspace\/[0-9a-f-]{36}/, { timeout: 30_000 });

  const compare = page.getByRole("button", { name: /compare sources/i });
  await expect(compare).toBeEnabled({ timeout: 60_000 });
  await compare.click();

  const banner = page.getByText(/^Compare sources failed:/);
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await expect(banner).toContainText(/MAX_USD_PER_RUN|cost/i);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, "01-refused.png") });

  const calls: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST") calls.push(new URL(r.url()).pathname); });
  await page.getByRole("button", { name: /^retry$/i }).click();
  await expect.poll(() => calls.find((c) => /skills\/compare-sources\/run|synthesize/.test(c)),
    { timeout: 15_000 }).toBeTruthy();
  const hit = calls.find((c) => /skills\/compare-sources\/run|synthesize/.test(c))!;
  expect(hit).toMatch(/skills\/compare-sources\/run/);        // not the study guide
});
