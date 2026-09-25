/**
 * E9, live: a study guide from THREE real lectures, from the AI panel, is
 * written chapter by chapter and its card carries the quality check; the
 * study guide's "Several sources" setting shows in Settings → Skills.
 * SPENDS ~$0.25 (three IML lectures on Haiku). Deletes its note; changes no
 * setting.
 *
 *   npx playwright test --project=skills-live e2e/panel-guide-three-live.spec.ts
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { openPanel } from "./helpers/panel";

const OUT = path.join(process.cwd(), "e2e/screenshots/panel-guide-three-live");
const PDFS = ["08", "09", "10"].map((n) =>
  path.join(process.cwd(), `../backend/evals/corpus/sources/pdf/iml-lecture-${n}.pdf`));

test("three lectures → /study-guide → chapter by chapter, checked", async ({ page }) => {
  test.skip(!PDFS.every((p) => fs.existsSync(p)), "the IML lecture PDFs are local only");
  test.setTimeout(1_200_000);
  fs.mkdirSync(OUT, { recursive: true });

  await page.goto("/brain/settings/skills?skill=study-guide", { waitUntil: "networkidle" });
  const setting = page.getByTestId("property-several-sources");
  await expect(setting).toBeVisible({ timeout: 60_000 });
  await expect(setting).toContainText("Automatic");
  await page.screenshot({ path: path.join(OUT, "01-setting.png") });

  await page.goto("/brain", { waitUntil: "networkidle" });
  const box = await openPanel(page);
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/ws/sources") && r.request().method() === "POST", { timeout: 120_000 });
  await page.getByTestId("panel-file-input").setInputFiles(PDFS);
  await box.fill("/study-guide");
  await box.press("Escape");
  await page.getByRole("button", { name: "Send" }).click();
  const noteId = (await (await created).json()).note_id as string;
  try {
    const check = page.getByTestId("guide-check");
    await expect(check).toBeVisible({ timeout: 1_100_000 });
    await expect(check).toContainText("Written chapter by chapter");
    await expect(check).not.toContainText("point nowhere");       // repaired (E9)
    await page.screenshot({ path: path.join(OUT, "02-card.png") });
    const card = page.getByTestId("panel-job-card").last();
    await card.getByRole("button", { name: "Discard" }).click();
  } finally {
    await page.request.delete(`/api/notes/${noteId}`);
  }
});
