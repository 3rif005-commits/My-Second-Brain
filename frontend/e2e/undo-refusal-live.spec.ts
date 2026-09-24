/**
 * Undo refuses once the user has typed after a draft landed — restoring then
 * would throw their edits away. SPENDS ONE SMALL CALL (compare-sources, ~$0.03).
 *
 *   npx playwright test --project=skills-live e2e/undo-refusal-live.spec.ts
 */
import { test, expect } from "@playwright/test";

test("Undo keeps the user's edits and says why", async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto("/brain/workspace", { waitUntil: "networkidle" });
  await page.getByText(/2 sources/).first().click();
  await page.waitForURL(/\/brain\/workspace\/[0-9a-f-]{36}/, { timeout: 30_000 });

  const compare = page.getByRole("button", { name: /compare sources/i });
  await expect(compare).toBeEnabled({ timeout: 60_000 });
  await compare.click();
  const undo = page.getByRole("button", { name: /^undo$/i });
  await expect(undo).toBeVisible({ timeout: 300_000 });      // the draft landed

  // The user types after the draft landed…
  const editor = page.locator(".bn-editor[contenteditable='true']").first();
  await editor.click();
  await page.keyboard.press("Control+End");
  const mine = `my own line ${Date.now()}`;
  await page.keyboard.type(mine);

  // …so Undo must not restore, and must say why.
  await undo.click();
  await expect(page.getByText(/edited the note since/i)).toBeVisible({ timeout: 10_000 });
  await expect(editor).toContainText(mine);
});
