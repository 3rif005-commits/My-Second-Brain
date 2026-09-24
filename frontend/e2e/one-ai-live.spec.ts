/**
 * The workspace's one AI, live (user decision, 2026-09-24). SPENDS A LITTLE
 * (two short chat turns on a tiny PDF, ~$0.02).
 *
 *   npx playwright test --project=skills-live e2e/one-ai-live.spec.ts
 */
import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const OUT = path.join(process.cwd(), "e2e/screenshots/one-ai-live");
const FIXTURE = path.join(process.cwd(), "e2e/fixtures/test.pdf");

async function freshNote(page: Page): Promise<string> {
  await page.goto("/brain/workspace", { waitUntil: "networkidle" });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /choose files/i }).click(),
  ]);
  await chooser.setFiles(FIXTURE);
  await page.waitForURL(/\/brain\/workspace\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /\/study-guide/ })).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator(".bn-editor").first()).toBeVisible({ timeout: 60_000 });
  return page.url().split("/").pop()!;
}

async function ask(page: Page, q: string) {
  const box = page.getByRole("textbox", { name: /message the ai/i });
  await box.fill(q);
  await page.getByRole("button", { name: "Send" }).click();
}

test("ask → cited answer → insert → undo; and the open note survives 'delete this note'", async ({ page }) => {
  test.setTimeout(420_000);
  fs.mkdirSync(OUT, { recursive: true });
  const noteId = await freshNote(page);

  await ask(page, "In two sentences, what is this lecture about?");
  const insert = page.getByRole("button", { name: /^insert into this note$/i }).last();
  await expect(insert).toBeVisible({ timeout: 120_000 });
  // At least one source chip: a small button whose name is just a number.
  await expect(page.locator("[role=log] button").filter({ hasText: /^\d+$/ }).first())
    .toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: path.join(OUT, "01-cited-answer.png") });

  await insert.click();
  await expect(page.getByText("Added to the note").last()).toBeVisible({ timeout: 15_000 });
  const editorText = await page.locator(".bn-editor").first().evaluate((el) => el.textContent ?? "");
  expect(editorText.length).toBeGreaterThan(40);
  expect(editorText).not.toMatch(/\[\d\]/);            // markers became source names
  await page.getByRole("button", { name: /^undo$/i }).last().click();
  await expect.poll(async () => (await page.locator(".bn-editor").first()
    .evaluate((el) => el.textContent ?? "")).trim().length, { timeout: 15_000 }).toBeLessThan(5);
  await page.screenshot({ path: path.join(OUT, "02-undone.png") });

  await ask(page, "Delete this note.");
  await expect(page.getByRole("button", { name: /^insert into this note$/i }).nth(1)
    .or(page.getByText(/open in the editor|needs your OK/i).first()))
    .toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: path.join(OUT, "03-delete-refused.png") });
  const note = await page.request.get(`/api/notes/${noteId}`).then((r) => r.json());
  expect(note.deleted_at ?? null).toBeNull();            // the open note is still there
  await expect(page.locator(".bn-editor").first()).toBeVisible();
  await page.request.delete(`/api/notes/${noteId}`);     // its own note, not the user's
});
