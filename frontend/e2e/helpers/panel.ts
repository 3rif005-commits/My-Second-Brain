// Shared by the side-panel specs. A helper module, not a spec: importing a
// spec file would register its tests a second time in the importer's project.
import { expect, Page } from "@playwright/test";
import path from "path";

const FIXTURE = path.join(process.cwd(), "e2e/fixtures/test.pdf");

export async function openPanel(page: Page) {
  const box = page.getByRole("textbox", { name: "Message the AI" });
  if (!(await box.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open AI panel", exact: true }).click();
  }
  await expect(box).toBeVisible({ timeout: 30_000 });
  // A fresh conversation: the panel reopens the last thread otherwise.
  await page.getByRole("button", { name: "New thread" }).click();
  page.on("console", (m) => { if (m.text().includes("[ai-panel]")) console.log(m.text()); });
  return box;
}

/** Attach the fixture in the panel; resolves with the note it went into. */
export async function attachFixture(page: Page): Promise<string> {
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/ws/sources") && r.request().method() === "POST", { timeout: 60_000 });
  await page.getByTestId("panel-file-input").setInputFiles(FIXTURE);
  await expect(page.getByRole("button", { name: "Remove test.pdf" })).toBeVisible();
  return created.then(async (r) => (await r.json()).note_id as string);
}


/** Wait until every source of a note is processed (ready or failed). */
export async function waitSourcesReady(page: Page, noteId: string, timeout = 180_000) {
  await expect.poll(async () => {
    const rows = await (await page.request.get(`/api/ws/notes/${noteId}/sources`)).json().catch(() => null);
    return Array.isArray(rows) && rows.length > 0 && rows.every((r: { status: string }) => r.status === "ready");
  }, { timeout, intervals: [2000] }).toBe(true);
}
