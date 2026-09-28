/**
 * Background jobs, M3, on the real stack and the real provider — SPENDS a
 * small batch call (half price) and cancels a second one.
 *
 *   ▾ → "Run later — half price" with the live price beside it →
 *   Queue → Run now (sent to the provider) → "Sent · half price" →
 *   [second job: sent, then Cancel → "Cancelling… still charged" → cancelled] →
 *   the first comes back → the card labelled Background → Insert into this note →
 *   Activity: Applied, and the expanded row's "Paid … · the same job run now
 *   would be … · saved …".
 *
 *   npx playwright test --project=background-batch
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { attachFixture, openPanel as openPanelOnce, waitSourcesReady } from "./helpers/panel";

const OUT = path.join(process.cwd(), "e2e/screenshots/background-batch-live");
test.use({ actionTimeout: 45_000 });

async function openPanel(page: Page) {
  try { return await openPanelOnce(page); } catch { return await openPanelOnce(page); }
}

async function queueFlashcards(page: Page) {
  const box = page.getByRole("textbox", { name: "Message the AI" });
  await box.click();
  await page.keyboard.type("/flashcards ");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More ways to run" }).click();
  return page.getByRole("menuitem", { name: /run later/i });
}

test("half-price batch: quote → sent → cancel one → the other returns → applied → the saving is shown", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let noteId: string | null = null;
  const jobIds: string[] = [];
  try {
    await page.goto("/brain", { waitUntil: "networkidle" });
    await openPanel(page);
    const noteP = attachFixture(page);
    await page.getByRole("button", { name: "Send" }).click();
    noteId = await noteP;
    await waitSourcesReady(page, noteId);
    await page.goto(`/brain/workspace/${noteId}`, { waitUntil: "domcontentloaded" });
    await openPanel(page);

    // ── the price says half price, before the click ─────────────────────
    const later = await queueFlashcards(page);
    await expect(later).toContainText("Run later — half price", { timeout: 30_000 });
    const line = page.getByTestId("later-price");
    await expect(line).toContainText(/Half price · ≈\$[\d.]+ \(now \$[\d.]+\) · sent (tonight|tomorrow) at 22:00, ready within a few hours/);
    await page.screenshot({ path: path.join(OUT, "01-half-price-menu.png") });
    await later.click();
    const first = page.getByTestId("background-job-card").first();
    await expect(first).toContainText(/Queued/, { timeout: 30_000 });
    const queued = (await (await page.request.get(`/api/ws/jobs?note_id=${noteId}`)).json()).jobs;
    expect(queued[0].price_mode).toBe("batch");
    expect(queued[0].shown_estimate_usd).toBeLessThan(queued[0].live_equivalent_usd);
    jobIds.push(queued[0].id);
    const shown = queued[0].shown_estimate_usd as number;

    // ── a second job, sent and then cancelled ───────────────────────────
    const later2 = await queueFlashcards(page);
    await later2.click();
    await expect(page.getByTestId("background-job-card")).toHaveCount(2, { timeout: 30_000 });
    const second = (await (await page.request.get(`/api/ws/jobs?note_id=${noteId}&status=queued`)).json()).jobs
      .find((j: { id: string }) => j.id !== jobIds[0]);
    jobIds.push(second.id);
    await page.request.post(`/api/ws/jobs/${second.id}/run-now`);
    const secondCard = page.getByTestId("background-job-card").filter({ hasText: /Sent · half price/ });
    await expect(secondCard).toHaveCount(1, { timeout: 90_000 });
    await secondCard.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByText(/Anything the provider had already finished is still charged/)).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await (await page.request.get(`/api/ws/jobs/${second.id}`)).json()).status,
      { timeout: 30_000 }).toBe("cancelled");
    await page.screenshot({ path: path.join(OUT, "02-cancelled-batch.png") });

    // ── send the first and wait for the provider ────────────────────────
    await page.request.post(`/api/ws/jobs/${jobIds[0]}/run-now`);
    await expect(page.getByTestId("background-job-card").filter({ hasText: /Sent · half price/ }))
      .toHaveCount(1, { timeout: 90_000 });
    await page.screenshot({ path: path.join(OUT, "03-sent.png") });

    // the tick collects it; poll the job (not the page) so the wait is cheap
    await expect.poll(async () => (await (await page.request.get(`/api/ws/jobs/${jobIds[0]}`)).json()).status,
      { timeout: 1_500_000, intervals: [15_000] }).toMatch(/^(ready|failed|expired)$/);
    const done = await (await page.request.get(`/api/ws/jobs/${jobIds[0]}`)).json();
    expect(done.status, `job ended as ${done.status}: ${done.error}`).toBe("ready");
    expect(done.price_mode).toBe("batch");
    expect(done.actual_usd).toBeGreaterThan(0);
    expect(done.live_equivalent_usd).toBeGreaterThan(done.actual_usd);
    expect(done.actual_usd / done.live_equivalent_usd).toBeCloseTo(0.5, 2);        // half price, exactly
    expect(done.result_html.length).toBeGreaterThan(100);

    // ── the same result card, put in the note ───────────────────────────
    await page.reload({ waitUntil: "domcontentloaded" });
    await openPanel(page);
    await expect(page.getByTestId("job-badge")).toContainText(/Background · ready/, { timeout: 60_000 });
    await page.screenshot({ path: path.join(OUT, "04-ready.png") });
    await page.getByRole("button", { name: /insert into this note/i }).click();
    await expect(page.getByText(/In “/).first()).toBeVisible({ timeout: 60_000 });

    // ── Activity shows the honest cost ──────────────────────────────────
    await page.goto("/brain/activity", { waitUntil: "domcontentloaded" });
    const row = page.getByTestId("history-row").filter({ hasText: "Applied" }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    const detail = page.getByTestId("history-detail").first();
    await expect(detail).toContainText(/Paid \$[\d.]+ · the same job run now would be \$[\d.]+ · saved \$[\d.]+/);
    await expect(detail).toContainText("half price");
    await expect(detail).toContainText(/claude-haiku/);
    await expect(page.getByTestId("month-line")).toContainText(/saved \$/);
    await page.screenshot({ path: path.join(OUT, "05-activity-saving.png") });

    // record what the run log says, for the ledger
    console.log(`BATCH RESULT shown≈$${shown} paid=$${done.actual_usd} live=$${done.live_equivalent_usd}`);
    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  } finally {
    // A job still waiting cannot be deleted: cancel first (a no-op for finished ones).
    for (const id of jobIds) {
      await page.request.post(`/api/ws/jobs/${id}/cancel`, { timeout: 30_000 }).catch(() => {});
      await page.request.delete(`/api/ws/jobs/${id}`, { timeout: 30_000 }).catch(() => {});
    }
    if (noteId) await page.request.delete(`/api/notes/${noteId}`, { timeout: 30_000 }).catch(() => {});
  }
});
