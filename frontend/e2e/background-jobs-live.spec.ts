/**
 * Background jobs (5.3) end to end, on the real stack:
 *   /flashcards → ▾ → Run later → "Queued" card → Run now → the result card
 *   labelled Background → Insert into this note → Undo;
 *   then a second job is queued and cancelled, and never runs.
 * SPENDS ONE SMALL CALL (the tiny test PDF). Deletes its note.
 *
 *   npx playwright test --project=background-jobs
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { attachFixture, openPanel as openPanelOnce, waitSourcesReady } from "./helpers/panel";

/** The workspace opens its own panel while the page settles, so the launcher
 *  button can vanish under the first click: ask again once. */
async function openPanel(page: import("@playwright/test").Page) {
  try { return await openPanelOnce(page); }
  catch { return await openPanelOnce(page); }
}

const OUT = path.join(process.cwd(), "e2e/screenshots/background-jobs-live");

// A missing button must fail in seconds, not hang until the test timeout —
// a hang skips the cleanup and leaves a test note behind.
test.use({ actionTimeout: 45_000 });

test("Run later: queue → Run now → Background result card → Put in note → Undo; queue → Cancel", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // A note with one source, made through the panel like a student would.
  await page.goto("/brain", { waitUntil: "networkidle" });
  await openPanel(page);
  const noteP = attachFixture(page);
  await page.getByRole("button", { name: "Send" }).click();   // just the file: attaches, runs nothing
  const noteId = await noteP;
  try {
    await waitSourcesReady(page, noteId);

    // Open it in the workspace: its AI panel is where background jobs live.
    await page.goto(`/brain/workspace/${noteId}`, { waitUntil: "domcontentloaded" });
    const box = await openPanel(page);

    // ── queue ────────────────────────────────────────────────────────────
    await box.click();
    await page.keyboard.type("/flashcards ");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More ways to run" }).click();
    const later = page.getByRole("menuitem", { name: /run later/i });
    await expect(later).toContainText(/(Normal price|Free|Price unknown) .*runs (tonight|tomorrow) at 22:00/);
    await expect(later).not.toContainText("0.000");
    await page.screenshot({ path: path.join(OUT, "01-run-later-menu.png") });
    await later.click();

    await expect(page.getByText(/^Queued · Flashcards · /)).toBeVisible({ timeout: 30_000 });
    const waiting = page.getByTestId("background-job-card").first();
    await expect(waiting).toContainText(/Queued · runs (tonight|tomorrow) at 22:00/);
    await expect(box).toHaveValue("");
    await page.screenshot({ path: path.join(OUT, "02-queued.png") });

    // ── run it now → the same result card, labelled Background ───────────
    await waiting.getByRole("button", { name: /run now/i }).click();
    const ready = page.getByTestId("background-ready");
    await expect(ready).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId("job-badge")).toContainText(/Background · ready/);
    await page.screenshot({ path: path.join(OUT, "03-ready.png") });

    // the bell heard about it (written by the worker, not the page)
    await expect.poll(async () => {
      const rows = await (await page.request.get("/api/db/notifications")).json().catch(() => []);
      return Array.isArray(rows) && rows.some((n: { source?: string }) => n.source?.startsWith("job:"));
    }, { timeout: 60_000, intervals: [3000] }).toBe(true);

    // ── Put in note, then Undo ───────────────────────────────────────────
    await page.getByRole("button", { name: /insert into this note/i }).click();
    await expect(page.getByText(/In “/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".bn-editor").first()).not.toBeEmpty();
    await page.screenshot({ path: path.join(OUT, "04-applied.png") });
    await page.getByRole("button", { name: /^undo$/i }).click();
    await expect(page.getByRole("button", { name: /insert into this note/i })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(OUT, "05-undone.png") });

    // the server knows it was applied: a reload no longer offers it
    await page.reload({ waitUntil: "domcontentloaded" });
    await openPanel(page);
    await expect(page.getByTestId("background-ready")).toHaveCount(0, { timeout: 30_000 });

    // ── queue another and cancel it: it never runs ───────────────────────
    const box2 = page.getByRole("textbox", { name: "Message the AI" });
    await box2.click();
    await page.keyboard.type("/flashcards ");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More ways to run" }).click();
    await page.getByRole("menuitem", { name: /run later/i }).click();
    const card = page.getByTestId("background-job-card").first();
    await expect(card).toContainText(/Queued/, { timeout: 30_000 });
    await card.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByTestId("background-job-card")).toHaveCount(0, { timeout: 30_000 });
    const jobs = await (await page.request.get(`/api/ws/jobs?note_id=${noteId}`)).json();
    expect(jobs.jobs.filter((j: { status: string }) => j.status === "queued")).toHaveLength(0);
    await page.screenshot({ path: path.join(OUT, "06-cancelled.png") });

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  } finally {
    await page.request.delete(`/api/notes/${noteId}`, { timeout: 30_000 });
  }
});
