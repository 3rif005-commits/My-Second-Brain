/**
 * Background jobs, M2, on the real stack — FREE: no model is ever called.
 *   Settings → Background jobs: lower the monthly limit to $0.01 →
 *   queue /flashcards (Run later) → Run now → it is refused before the model:
 *   "Not started — about $… would pass your $0.01 monthly limit" on the card,
 *   in the bell, on the Activity page (Needs you) and as the sidebar's badge →
 *   Dismiss → it moves to History → expand the row → delete it from history.
 * Restores the limit, trashes its note, deletes its job.
 *
 *   npx playwright test --project=background-activity
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { attachFixture, openPanel as openPanelOnce, waitSourcesReady } from "./helpers/panel";

const OUT = path.join(process.cwd(), "e2e/screenshots/background-activity-live");
test.use({ actionTimeout: 45_000 });

async function openPanel(page: Page) {
  try { return await openPanelOnce(page); } catch { return await openPanelOnce(page); }
}

test("monthly limit: refused before the model, visible in Activity, sidebar and bell", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const before = await (await page.request.get("/api/ws/jobs/settings")).json();
  const originalCap: number = before.monthly_cap_usd;
  let noteId: string | null = null;
  let jobId: string | null = null;
  try {
    // ── lower the limit in Settings ───────────────────────────────────────
    await page.goto("/brain/settings/background-jobs", { waitUntil: "domcontentloaded" });
    const cap = page.getByLabel("Monthly limit in dollars");
    await expect(cap).toHaveValue(String(originalCap), { timeout: 30_000 });
    await expect(page.getByTestId("spent-line")).toContainText(/Spent so far this month/);
    await cap.fill("0");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();      // nonsense is refused
    await cap.fill("0.01");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("settings-note")).toContainText("Saved — the limit is $0.01 a month.");
    await page.screenshot({ path: path.join(OUT, "01-settings.png") });

    // ── a note with one source, then queue and run a job ──────────────────
    await page.goto("/brain", { waitUntil: "networkidle" });
    await openPanel(page);
    const noteP = attachFixture(page);
    await page.getByRole("button", { name: "Send" }).click();
    noteId = await noteP;
    await waitSourcesReady(page, noteId);

    await page.goto(`/brain/workspace/${noteId}`, { waitUntil: "domcontentloaded" });
    const box = await openPanel(page);
    await box.click();
    await page.keyboard.type("/flashcards ");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More ways to run" }).click();
    await page.getByRole("menuitem", { name: /run later/i }).click();
    const card = page.getByTestId("background-job-card").first();
    await expect(card).toContainText(/Queued/, { timeout: 30_000 });
    await card.getByRole("button", { name: /run now/i }).click();

    // refused on the card, with the numbers — and no model call was made
    await expect(card).toContainText(/would pass your \$0\.01 monthly limit/, { timeout: 90_000 });
    await expect(card).toHaveAttribute("data-status", "budget_blocked");
    await page.screenshot({ path: path.join(OUT, "02-refused-on-card.png") });
    const jobs = (await (await page.request.get(`/api/ws/jobs?note_id=${noteId}`)).json()).jobs;
    jobId = jobs[0].id;
    expect(jobs[0].actual_usd).toBe(0);                                              // nothing was spent

    // the bell heard about it
    await expect.poll(async () => {
      const rows = await (await page.request.get("/api/db/notifications")).json().catch(() => []);
      return Array.isArray(rows) && rows.some((n: { source?: string; message?: string }) =>
        n.source === `job:${jobId}` && /monthly limit/.test(n.message ?? ""));
    }, { timeout: 60_000, intervals: [3000] }).toBe(true);

    // ── Activity: Needs you, the badge, the header ────────────────────────
    await page.goto("/brain/activity", { waitUntil: "domcontentloaded" });
    const needs = page.getByTestId("needs-you").first();
    await expect(needs).toContainText(/monthly limit/, { timeout: 30_000 });
    await expect(needs.getByRole("link", { name: /change limit/i })).toHaveAttribute("href", "/brain/settings/background-jobs");
    await expect(page.getByTestId("month-line")).toContainText(/This month: .* of \$0\.01/);
    await expect(needs).not.toContainText("Not started — Not started");           // said once
    await expect(page.getByTestId("activity-badge")).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "03-activity-needs-you.png") });

    // ── Dismiss → History → expand ────────────────────────────────────────
    await needs.getByRole("button", { name: /dismiss/i }).click();
    await expect(page.getByTestId("needs-you")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("activity-badge")).toHaveCount(0, { timeout: 10_000 });   // updates at once, not at the next poll
    const row = page.getByTestId("history-row").first();
    await expect(row).toContainText(/Discarded/);
    await expect(row).toContainText("$0");
    await row.click();
    const detail = page.getByTestId("history-detail");
    await expect(detail).toContainText(/monthly limit/);
    await expect(detail).toContainText(/Made from:/);
    await page.screenshot({ path: path.join(OUT, "04-history-expanded.png") });

    // ── delete it from the history ────────────────────────────────────────
    await page.getByRole("button", { name: /delete from history/i }).first().click();
    await expect(page.getByTestId("history-row")).toHaveCount(0, { timeout: 30_000 });
    jobId = null;

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  } finally {
    await page.request.put("/api/ws/jobs/settings", {
      data: { monthly_cap_usd: originalCap }, headers: { "Content-Type": "application/json" }, timeout: 30_000 });
    if (jobId) await page.request.delete(`/api/ws/jobs/${jobId}`, { timeout: 30_000 });
    if (noteId) await page.request.delete(`/api/notes/${noteId}`, { timeout: 30_000 });
  }
});
