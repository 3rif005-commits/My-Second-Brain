/**
 * Background jobs, M4, on the real stack — FREE: no model is ever called (the
 * trigger only queues a job; nothing runs it here).
 *   Attach a source, open the workspace, turn on "When I add a source here:
 *   Flashcards" → attach a second source → the settle debounce fires once,
 *   2 minutes after the last one settles → exactly one job, not two.
 * The test waits out the real 2-minute debounce plus the scheduler's own
 * 60-second tick — the actual production path, not a fast-forwarded one.
 * Trashes its note and deletes the job it created.
 *
 *   npx playwright test --project=background-trigger
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { attachFixture, openPanel as openPanelOnce, waitSourcesReady } from "./helpers/panel";

const OUT = path.join(process.cwd(), "e2e/screenshots/background-trigger-live");
test.use({ actionTimeout: 45_000 });

async function openPanel(page: Page) {
  try { return await openPanelOnce(page); } catch { return await openPanelOnce(page); }
}

test("when a source is added: two files, one job — never two", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let noteId: string | null = null;
  let jobId: string | null = null;

  try {
    // ── one note, one source, via the panel like a real drop ────────────
    await page.goto("/brain", { waitUntil: "networkidle" });
    await openPanel(page);
    const noteP = attachFixture(page);
    await page.getByRole("button", { name: "Send" }).click();
    noteId = await noteP;
    await waitSourcesReady(page, noteId);

    // ── turn the trigger on, in the workspace's Sources rail ─────────────
    await page.goto(`/brain/workspace/${noteId}`, { waitUntil: "domcontentloaded" });
    // The sources panel remembers whether it was left collapsed; wait for
    // either state to actually mount (not just "not visible yet") and open
    // it if it is the collapsed one.
    const showSources = page.getByRole("button", { name: "Show the sources" });
    const trigger = page.getByRole("combobox", { name: "When I add a source here" });
    await expect(showSources.or(trigger)).toBeVisible({ timeout: 30_000 });
    // Click() has its own actionability wait/retry; a one-shot isVisible() check here raced
    // and missed the button on a re-render. Swallow: it may already be expanded.
    await showSources.click({ timeout: 10_000 }).catch(() => {});
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await expect(trigger).not.toBeDisabled({ timeout: 30_000 });   // waits for the note's own priced skill list
    await trigger.selectOption("flashcards");
    await expect(page.getByText(/New sources → Flashcards \(background\)/)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: path.join(OUT, "01-trigger-on.png") });

    // confirmed server-side too, not just optimistic UI
    const saved = await (await page.request.get(`/api/ws/jobs/notes/${noteId}/trigger`)).json();
    expect(saved.skill).toBe("flashcards");

    // ── a second source lands on the same note ───────────────────────────
    await openPanel(page);
    const second = attachFixture(page);
    await page.getByRole("button", { name: "Send" }).click();
    const secondNoteId = await second;
    expect(secondNoteId).toBe(noteId);                 // the panel adds to the OPEN note, not a new one
    await waitSourcesReady(page, noteId);
    const sources = await (await page.request.get(`/api/ws/notes/${noteId}/sources`)).json();
    expect(sources).toHaveLength(2);

    // ── wait out the real debounce (2 min) + the scheduler's own tick (60s) ─
    let jobs: { id: string; trigger: string; skill: string }[] = [];
    await expect.poll(async () => {
      jobs = (await (await page.request.get(`/api/ws/jobs?note_id=${noteId}`)).json()).jobs;
      return jobs.length;
    }, { timeout: 240_000, intervals: [10_000] }).toBeGreaterThan(0);
    expect(jobs, "exactly one job from two sources settling close together").toHaveLength(1);
    expect(jobs[0].trigger).toBe("source_added");
    expect(jobs[0].skill).toBe("flashcards");
    jobId = jobs[0].id;
    await page.screenshot({ path: path.join(OUT, "02-one-job.png") });

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  } finally {
    if (jobId) {
      await page.request.post(`/api/ws/jobs/${jobId}/cancel`, { timeout: 30_000 }).catch(() => {});
      await page.request.delete(`/api/ws/jobs/${jobId}`, { timeout: 30_000 }).catch(() => {});
    }
    if (noteId) {
      await page.request.put(`/api/ws/jobs/notes/${noteId}/trigger`, { data: {},
        headers: { "Content-Type": "application/json" }, timeout: 30_000 }).catch(() => {});
      await page.request.delete(`/api/notes/${noteId}`, { timeout: 30_000 }).catch(() => {});
    }
  }
});
