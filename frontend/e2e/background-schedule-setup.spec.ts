/**
 * Background jobs, M5 — sets up a real schedule against the real backend and
 * prints its ids, so a companion script can fast-forward `next_check_at`
 * directly (no real week's wait) and watch the REAL scheduler tick fire it.
 * FREE: no model is called by this file. See background-schedule-live's
 * sibling note in the ledger for the full live-pass procedure.
 *
 *   npx playwright test --project=background-schedule-setup
 */
import { test, expect } from "@playwright/test";
import { attachFixture, openPanel } from "./helpers/panel";

const WEEKLY = { frequency: "weekly", weekdays: [7], time_of_day: "22:00", start_date: "2026-09-06" };

test("create a real schedule on a real note", async ({ page }) => {
  await page.goto("/brain", { waitUntil: "networkidle" });
  await openPanel(page);
  const noteP = attachFixture(page);
  await page.getByRole("button", { name: "Send" }).click();
  const noteId = await noteP;

  // wait for the source to actually be ready — a schedule with nothing ready
  // yet would just skip, which is a different case than the one we want here.
  await expect.poll(async () => {
    const rows = await (await page.request.get(`/api/ws/notes/${noteId}/sources`)).json();
    return Array.isArray(rows) && rows.length > 0 && rows.every((r: { status: string }) => r.status === "ready");
  }, { timeout: 180_000, intervals: [2000] }).toBe(true);

  const res = await page.request.post("/api/ws/jobs/schedules", {
    data: { note_id: noteId, skill: "flashcards", cadence: WEEKLY, month_cap_usd: 1.0 },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status()).toBe(200);
  const schedule = await res.json();
  console.log(`SCHEDULE_SETUP note_id=${noteId} trigger_id=${schedule.id}`);
});
