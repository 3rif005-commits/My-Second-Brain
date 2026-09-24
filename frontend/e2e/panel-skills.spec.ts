/**
 * Skills from the AI side panel, without opening the workspace (user decision,
 * 2026-09-24) — the free half: attach a file, see it processed, see the /
 * menu say what a skill will run on. Nothing here runs a model.
 * Deletes the note it creates.
 *
 *   npx playwright test --project=panel-skills
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { attachFixture, openPanel } from "./helpers/panel";

const OUT = path.join(process.cwd(), "e2e/screenshots/panel-skills");

test("attach in the side panel → processed into a new note → / says what it runs on", async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/brain", { waitUntil: "networkidle" });
  const box = await openPanel(page);

  // Before anything is attached, the / menu says skills need sources.
  await box.click();
  await page.keyboard.type("/study");
  await expect(page.getByRole("option", { name: /\/study-guide/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Attach a file first/)).toBeVisible();
  await box.fill("");

  const noteP = attachFixture(page);
  await page.screenshot({ path: path.join(OUT, "01-attached.png") });
  await page.getByRole("button", { name: "Send" }).click();
  const noteId = await noteP;
  try {
    await expect(page.getByTestId("panel-upload-card")).toBeVisible();
    await expect(page.getByText(/Ready\. Ask about “test”/)).toBeVisible({ timeout: 180_000 });
    await page.screenshot({ path: path.join(OUT, "02-ready.png") });

    // Now the menu knows what it would run on — and nothing ran yet.
    await box.click();
    await page.keyboard.type("/stu");
    await expect(page.getByText(/Runs on “test”/)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(box).toHaveValue("/study-guide ");
    await page.screenshot({ path: path.join(OUT, "03-menu.png") });

    // The note the files went into links to the workspace from its top bar.
    const reqs: string[] = [];
    page.on("response", (r) => { if (r.url().includes(`/notes/${noteId}/sources`)) reqs.push(String(r.status())); });
    await page.goto(`/brain/${noteId}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: /open in workspace/i }), `sources requests: ${reqs}`)
      .toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: path.join(OUT, "04-note-top-bar.png") });
    expect(errors, errors.join(" | ")).toHaveLength(0);
  } finally {
    await page.request.delete(`/api/notes/${noteId}`);
  }
});
