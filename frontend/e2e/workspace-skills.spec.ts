/**
 * Workspace action bar — the live pass for "skills as jobs".
 *
 * Proves, against the running app: a note's jobs are offered with a price
 * before any click, and a skill that cannot run yet shows the reason instead
 * of sitting greyed out with no explanation.
 *
 * It deliberately does not RUN a skill. That needs model quota, and a test
 * whose result depends on a provider's daily limit is a test that lies on
 * Tuesdays.
 */
import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const SCREENSHOT_DIR = path.join(process.cwd(), "e2e/screenshots/workspace-skills");
const FIXTURE = path.join(process.cwd(), "e2e/fixtures/test.pdf");

async function ss(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

/** Open a recent session from the workspace landing strip. */
async function openRecent(page: Page, match: RegExp) {
  await page.goto("/brain/workspace", { waitUntil: "networkidle" });
  await page.getByText(match).first().click();
  await page.waitForURL(/\/brain\/workspace\/[0-9a-f-]{36}/, { timeout: 30_000 });
}

test.describe("workspace action bar", () => {
  test.setTimeout(120_000);

  test("a note with several sources offers every job, priced", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await openRecent(page, /2 sources/);
    await expect(page.getByText(/\d+ sources?/).first()).toBeVisible({ timeout: 30_000 });
    await ss(page, "01-multi-source");

    // Both shipped skills are offered as chips.
    const compare = page.getByRole("button", { name: /compare sources/i });
    const flashcards = page.getByRole("button", { name: /flashcards/i });
    await expect(compare).toBeVisible({ timeout: 30_000 });
    await expect(flashcards).toBeVisible();

    // Two sources means comparing is possible, and the chip carries a price.
    await expect(compare).toBeEnabled();
    // "free · ≈12K tokens" on a free-tier model, "≈$0.05" on a paid one —
    // never "$0.000", which reads as broken.
    await expect(compare).toContainText(/free|\$\d|tokens/);
    await expect(compare).not.toContainText("$0.000");
    await ss(page, "02-chips-priced");

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("a single-source note explains why comparing is unavailable", async ({ page }) => {
    await openRecent(page, /1\s*source/);

    const compare = page.getByRole("button", { name: /compare sources/i });
    await expect(compare).toBeVisible({ timeout: 30_000 });
    // The rule under test: say why, rather than greying out in silence.
    await expect(compare).toBeDisabled();
    await expect(compare).toContainText(/two sources/i);
    // Flashcards works on one source, so it stays available.
    await expect(page.getByRole("button", { name: /flashcards/i })).toBeEnabled();
    await ss(page, "03-blocked-with-reason");
  });

  test("the editor's slash menu offers the same jobs", async ({ page }) => {
    await openRecent(page, /2 sources/);
    await expect(page.getByRole("button", { name: /flashcards/i }))
      .toBeVisible({ timeout: 30_000 });

    // Type "/" in the note and look for the Skills group.
    await page.locator(".bn-editor [contenteditable='true']").first().click();
    await page.keyboard.type("/flash");
    const menuItem = page.getByText(/^Flashcards$/).first();
    await expect(menuItem).toBeVisible({ timeout: 10_000 });
    await ss(page, "06-slash-menu");

    // Escape without running anything — this test spends no quota.
    await page.keyboard.press("Escape");
  });

  test("dropping a source indexes it without generating anything", async ({ page }) => {
    await page.goto("/brain/workspace", { waitUntil: "networkidle" });

    // Through the real control, not a stray input: the page has more than one
    // file input and the first in the DOM belongs to the sidebar.
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /choose files/i }).click(),
    ]);
    await chooser.setFiles(FIXTURE);

    await page.waitForURL(/\/brain\/workspace\/[0-9a-f-]{36}/, { timeout: 60_000 });
    await ss(page, "04-dropped");

    // The drop policy: indexing happens, generation does not.
    await expect(page.getByText(/writing the note/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /generate note/i }))
      .toBeVisible({ timeout: 90_000 });
    await ss(page, "05-offered-not-fired");
  });
});
