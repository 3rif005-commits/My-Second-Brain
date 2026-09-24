/**
 * The study guide, end to end, on two real lectures — the path most users
 * take. SPENDS MODEL QUOTA (one run, ~$0.07 on the Markdown path):
 *
 *   LECTURE_A=... LECTURE_B=... npx playwright test --project=skills-live e2e/study-guide-live.spec.ts
 *
 * Writes the note's text next to the screenshots for a person to read.
 */
import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const OUT = path.join(process.cwd(), "e2e/screenshots/study-guide-live");
const A = process.env.LECTURE_A ?? "";
const B = process.env.LECTURE_B ?? "";

async function ss(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

test("a study guide is written from two real lectures, whole", async ({ page }) => {
  test.skip(!A || !B, "set LECTURE_A and LECTURE_B to two PDF paths");
  test.setTimeout(900_000);

  await page.goto("/brain/workspace", { waitUntil: "networkidle" });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /choose files/i }).click(),
  ]);
  await chooser.setFiles([A, B]);
  await page.waitForURL(/\/brain\/workspace\/[0-9a-f-]{36}/, { timeout: 120_000 });

  // "2 sources" is shown as soon as both are DROPPED; the compare chip only
  // enables once both are READY — the first live run generated from one
  // source because it trusted the count.
  await expect(page.getByRole("button", { name: /compare sources/i }))
    .toBeEnabled({ timeout: 480_000 });
  const generate = page.getByRole("button", { name: /generate note/i });
  await generate.click();

  // Wait for the draft itself, not for a spinner to disappear.
  const editor = page.locator(".bn-editor").first();
  await expect(editor.locator("h1")).toHaveCount(1, { timeout: 600_000 });
  // Counted, not "visible": chapters can sit inside collapsed toggles.
  await expect.poll(() => editor.locator("h2").count(), { timeout: 60_000 })
    .toBeGreaterThan(3);
  await ss(page, "01-guide");

  const text = await editor.innerText();
  fs.writeFileSync(path.join(OUT, "note.txt"), `${page.url()}\n\n${text}`);
  expect(await editor.locator("h1").count()).toBe(1);
  expect(text.length).toBeGreaterThan(15_000);
  expect(text).not.toMatch(/was cut off/);                       // E13
  expect(text).not.toMatch(/\b(?:DEF|INS|EQ|PROC)-\d{2}\b/);     // E14 (synthesis still sees IDs)
  for (const term of ["passive", "panchromatic", "geostationary", "NDVI"]) {
    expect(text.toLowerCase()).toContain(term.toLowerCase());
  }
});
