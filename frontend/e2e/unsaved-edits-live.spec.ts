/**
 * ArtCraft study item 1 (docs/artcraft-study/SHORTLIST.md): a save that fails must say so, keep
 * the edit in this browser, and get it to the server later; leaving the page inside the 2 s
 * autosave debounce must still save.
 *
 * Creates its own fixture note through the API and permanently deletes it in `finally`.
 */
import { test, expect, type Page } from "@playwright/test";

const para = (id: string, text: string) => ({
  id, type: "paragraph",
  props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
  content: [{ type: "text", text, styles: {} }], children: [],
});

async function serverText(page: Page, noteId: string): Promise<string> {
  const r = await page.request.get(`/api/notes/${noteId}`);
  return JSON.stringify((await r.json()).content);
}

async function typeAtEnd(page: Page, text: string) {
  const p = page.locator('[data-id="sbtest-p1"] [data-content-type="paragraph"] .bn-inline-content');
  await p.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

test("a failed save is kept, labelled, and restored; a quick exit still saves", async ({ page }) => {
  test.setTimeout(300_000);
  const created = await page.request.post("/api/notes", {
    data: { title: "SB-TEST unsaved edits (safe to delete)", content: [para("sbtest-p1", "sbtest-start-marker")] },
  });
  expect(created.ok()).toBeTruthy();
  const noteId: string = (await created.json()).id;
  const notePath = `**/api/notes/${noteId}`;

  try {
    await page.goto(`/brain/${noteId}`);
    await expect(page.locator('[data-id="sbtest-p1"] [data-content-type="paragraph"]')).toContainText("sbtest-start-marker", { timeout: 180_000 });

    // Offline for this note's saves only.
    await page.route(notePath, (route) =>
      route.request().method() === "PATCH" ? route.abort("internetdisconnected") : route.continue());
    await typeAtEnd(page, " offline-edit");

    await expect(page.getByText("Not saved — retrying")).toBeVisible({ timeout: 15_000 });
    const kept = await page.evaluate((id) => localStorage.getItem(`unsaved-note-${id}`), noteId);
    expect(kept).toContain("offline-edit");
    expect(await serverText(page, noteId)).not.toContain("offline-edit");

    // Back online, as if the tab had been closed and reopened.
    await page.unroute(notePath);
    await page.reload();
    await expect(page.getByText(/Restored edits from .* that hadn't been saved/)).toBeVisible({ timeout: 180_000 });
    await expect.poll(() => serverText(page, noteId), { timeout: 20_000 }).toContain("offline-edit");
    await expect.poll(
      () => page.evaluate((id) => localStorage.getItem(`unsaved-note-${id}`), noteId),
      { timeout: 10_000 }).toBeNull();

    // Leave inside the 2 s debounce: the editor flushes instead of dropping the edit.
    await typeAtEnd(page, " quick-exit");
    await page.goto("/brain");
    await expect.poll(() => serverText(page, noteId), { timeout: 20_000 }).toContain("quick-exit");
  } finally {
    await page.request.delete(`/api/notes/${noteId}`, { timeout: 120_000 });
    await page.request.delete(`/api/notes/${noteId}/permanent`, { timeout: 120_000 });
  }
});
