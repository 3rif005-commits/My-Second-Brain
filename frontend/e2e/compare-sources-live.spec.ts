/**
 * compare-sources, end to end, on real lectures — the first note this skill
 * has ever produced.
 *
 * Unlike workspace-skills.spec.ts this one DOES spend model quota, so it is
 * its own project and never part of a routine run:
 *
 *   LECTURE_A=... LECTURE_B=... npx playwright test --project=skills-live
 *
 * It writes the note's text next to the screenshots so a person can read what
 * the model actually said, not just that a test went green.
 */
import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const OUT = path.join(process.cwd(), "e2e/screenshots/compare-sources-live");
const A = process.env.LECTURE_A ?? "";
const B = process.env.LECTURE_B ?? "";

async function ss(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

test("compare-sources writes a note from two real lectures", async ({ page }) => {
  test.skip(!A || !B, "set LECTURE_A and LECTURE_B to two PDF paths");
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/brain/workspace", { waitUntil: "networkidle" });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /choose files/i }).click(),
  ]);
  await chooser.setFiles([A, B]);
  await page.waitForURL(/\/brain\/workspace\/[0-9a-f-]{36}/, { timeout: 120_000 });

  // Comparing needs both sources indexed; the chip enables when they are.
  const compare = page.getByRole("button", { name: /compare sources/i });
  await expect(compare).toBeEnabled({ timeout: 300_000 });
  await ss(page, "01-ready");

  await compare.click();
  await expect(page.getByText(/writing the note/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/writing the note/i)).toHaveCount(0, { timeout: 420_000 });
  await ss(page, "02-note");

  const text = await page.locator(".bn-editor").first().innerText();
  fs.writeFileSync(path.join(OUT, "note.txt"), `${page.url()}\n\n${text}`);
  expect(text).toMatch(/agree/i);
  expect(text).toMatch(/differ/i);
  expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
});
