/**
 * A job run from the AI panel, end to end (user decision, 2026-09-24):
 * type /study-guide → a result card → Preview → Insert into note → Undo.
 * SPENDS ONE SMALL CALL (a fresh note with the tiny test PDF, ~$0.02).
 *
 *   npx playwright test --project=skills-live e2e/chat-job-live.spec.ts
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { openPanel } from "./helpers/panel";

const OUT = path.join(process.cwd(), "e2e/screenshots/chat-job-live");
const FIXTURE = path.join(process.cwd(), "e2e/fixtures/test.pdf");

test("/study-guide in the AI panel: preview, insert, undo", async ({ page }) => {
  test.setTimeout(420_000);
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/brain/workspace", { waitUntil: "networkidle" });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /choose files/i }).click(),
  ]);
  await chooser.setFiles(FIXTURE);
  await page.waitForURL(/\/brain\/workspace\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await openPanel(page);           // the app's one AI panel
  await expect(page.getByRole("button", { name: /\/study-guide/ })).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator(".bn-editor").first()).toBeVisible({ timeout: 60_000 });

  const box = page.getByRole("textbox", { name: /message the ai/i });
  await box.click();
  await page.keyboard.type("/study-guide");
  await page.keyboard.press("Escape");            // close the / menu, keep the text
  await box.fill("/study-guide");
  await page.getByRole("button", { name: "Send" }).click();

  const insert = page.getByRole("button", { name: /insert into this note/i });
  await expect(page.getByText(/Writing…/)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(OUT, "01-running.png") });
  await expect(insert).toBeVisible({ timeout: 300_000 });
  await expect(page.locator(".bn-editor h1")).toHaveCount(0);   // nothing touched the note yet
  await page.getByRole("button", { name: /^preview$/i }).click();
  await expect(page.locator("iframe[title$='preview']")).toBeVisible();
  await page.screenshot({ path: path.join(OUT, "02-card.png") });

  await insert.click();
  await expect(page.locator(".bn-editor h1").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/In “/)).toBeVisible();
  await page.screenshot({ path: path.join(OUT, "03-inserted.png") });

  await page.getByRole("button", { name: /^undo$/i }).click();
  await expect(page.locator(".bn-editor h1")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /insert into this note/i })).toBeVisible();
  await page.screenshot({ path: path.join(OUT, "04-undone.png") });
  await page.request.delete(`/api/notes/${page.url().split("/").pop()}`);   // its own note, not the user's
});
