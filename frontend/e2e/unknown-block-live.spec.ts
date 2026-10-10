/**
 * Ledger B3 (docs/notion-sync/DIVERGENCE_LEDGER.md): a block whose type the
 * editor doesn't know must survive load, editing and autosave untouched.
 *
 * Creates its own fixture note through the API and permanently deletes it in
 * `finally`: e2e runs against the real account, so it never touches an
 * existing note.
 */
import { test, expect } from "@playwright/test";

const para = (id: string, text: string) => ({
  id, type: "paragraph",
  props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
  content: [{ type: "text", text, styles: {} }], children: [],
});

const FLASHCARD = {
  id: "sbtest-flash-1",
  type: "flashcard",
  props: { front: "What is entropy?", back: "A measure of disorder" },
  content: [],
  children: [para("sbtest-inside-1", "nested inside the unknown block")],
};

test("an unknown block type survives load, an edit and autosave", async ({ page }) => {
  // The dev server compiles /brain/[noteId] on first visit: 60 s+ on this machine.
  test.setTimeout(300_000);
  const created = await page.request.post("/api/notes", {
    data: {
      title: "SB-TEST unknown block (safe to delete)",
      content: [para("sbtest-before", "before"), FLASHCARD, para("sbtest-after", "after")],
    },
  });
  expect(created.ok()).toBeTruthy();
  const noteId: string = (await created.json()).id;

  try {
    await page.goto(`/brain/${noteId}`);
    const placeholder = page.getByText(/Unsupported block “flashcard”/);
    await expect(placeholder).toBeVisible({ timeout: 180_000 });

    // Edit a known block next to it, then let the 2 s autosave fire.
    const after = page.locator('[data-id="sbtest-after"] [data-content-type="paragraph"] .bn-inline-content');
    await after.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" edited");

    await expect.poll(async () => {
      const r = await page.request.get(`/api/notes/${noteId}`);
      const content = (await r.json()).content as any[];
      return content.some((b) => JSON.stringify(b).includes("after edited"));
    }, { timeout: 20_000 }).toBe(true);

    const saved = (await (await page.request.get(`/api/notes/${noteId}`)).json()).content as any[];
    const flash = saved.find((b) => b.id === FLASHCARD.id);
    // Stored exactly as it was written: type, props and nested children.
    expect(flash).toEqual(FLASHCARD);
    expect(saved.some((b) => b.type === "unknownBlock")).toBe(false);
  } finally {
    await page.request.delete(`/api/notes/${noteId}`, { timeout: 120_000 });
    await page.request.delete(`/api/notes/${noteId}/permanent`, { timeout: 120_000 });
  }
});
