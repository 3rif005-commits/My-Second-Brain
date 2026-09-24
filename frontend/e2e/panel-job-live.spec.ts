/**
 * /study-guide from the AI side panel, end to end: attach → run → result
 * card → Put in note (opens the note with the guide) → Undo.
 * SPENDS ONE SMALL CALL (the tiny test PDF, ~$0.02). Deletes its note.
 *
 *   npx playwright test --project=skills-live e2e/panel-job-live.spec.ts
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { attachFixture, openPanel } from "./helpers/panel";

const OUT = path.join(process.cwd(), "e2e/screenshots/panel-job-live");

test("side panel: attach + /study-guide → card → Put in note → Undo", async ({ page }) => {
  test.setTimeout(540_000);
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/brain", { waitUntil: "networkidle" });
  const box = await openPanel(page);
  const noteP = attachFixture(page);
  await box.fill("/study-guide");
  await box.press("Escape");
  await page.getByRole("button", { name: "Send" }).click();
  const noteId = await noteP;
  try {
    await expect(page.getByText(/Writing…/)).toBeVisible({ timeout: 240_000 });
    const put = page.getByRole("button", { name: /put in note/i });
    await expect(put).toBeVisible({ timeout: 300_000 });
    await page.getByRole("button", { name: /^preview$/i }).click();
    await expect(page.locator("iframe[title$='preview']")).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "01-card.png") });

    await put.click();
    await page.waitForURL(new RegExp(`/brain/${noteId}$`), { timeout: 60_000 });
    await expect(page.locator(".bn-editor h1").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/In “test”/)).toBeVisible();
    await expect(page.getByRole("button", { name: /open in workspace/i }).first()).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "02-in-note.png") });

    await page.getByRole("button", { name: /^undo$/i }).click();
    await expect(page.locator(".bn-editor h1")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /put in note|insert into this note/i })).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "03-undone.png") });
  } finally {
    await page.request.delete(`/api/notes/${noteId}`);
  }
});
