/**
 * A selection-surface skill, end to end: select text, open the AI menu from
 * the toolbar, run define-terms, and read what it proposes.
 *
 * SPENDS MODEL QUOTA (one small call) — its own project, never a sweep:
 *
 *   npx playwright test --project=skills-live
 *
 * It ends by clicking Revert, so the note is left as typed. The proposal is
 * written next to the screenshots so a person can read it.
 */
import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const OUT = path.join(process.cwd(), "e2e/screenshots/selection-skills-live");
const PASSAGE =
  "Gradient descent minimises the loss by stepping against the gradient. " +
  "The learning rate sets the step size, and momentum damps oscillation.";

async function ss(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

test("define-terms runs on a selection and waits for review", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/brain");
  await page.click("text=+ New Note");
  await page.waitForURL(/\/brain\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await page.waitForSelector(".bn-editor", { timeout: 20_000 });
  await page.locator(".bn-editor").click();
  await page.keyboard.type(PASSAGE);

  // Select the paragraph, then use the toolbar's AI button — the entry point
  // a mouse user has.
  await page.keyboard.press("Shift+Home");
  const aiButton = page.getByRole("button", { name: /edit with ai/i });
  await expect(aiButton).toBeVisible({ timeout: 10_000 });
  await aiButton.click();

  const skill = page.getByText(/^Define terms$/).first();
  await expect(skill).toBeVisible({ timeout: 15_000 });
  await ss(page, "01-menu-with-skill");
  await skill.click();

  // xl-ai's own review: nothing changes until Accept.
  const revert = page.getByText(/^Revert$/).first();
  await expect(revert).toBeVisible({ timeout: 120_000 });
  await ss(page, "02-proposal");

  const text = await page.locator(".bn-editor").first().innerText();
  fs.writeFileSync(path.join(OUT, "proposal.txt"), `${page.url()}\n\n${text}`);
  expect(text).toContain(PASSAGE);            // the selection is untouched
  expect(text.toLowerCase()).toContain("learning rate");
  expect(text.length).toBeGreaterThan(PASSAGE.length + 80);  // something was added

  await revert.click();
  await expect(page.getByText(/^Revert$/)).toHaveCount(0, { timeout: 10_000 });
  expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
});
