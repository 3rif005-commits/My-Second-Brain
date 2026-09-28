import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hooks/useNotes", () => ({
  useNotes: () => ({ notes: [{ id: "n1", title: "Lecture 10" }, { id: "n2", title: "Lecture 11" }] }),
}));

import { SchedulesSection } from "./SchedulesSection";
import type { Schedule } from "@/lib/backgroundJobs";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const CADENCE = { frequency: "weekly" as const, weekdays: [7], time_of_day: "22:00", start_date: "2026-09-06" };
const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  id: "s1", note_id: "n1", note_title: "Lecture 10", skill: "flashcards", cadence: CADENCE,
  month_cap_usd: 1.0, enabled: true, paused_reason: null, paused_kind: null,
  last_run_at: null, next_check_at: "2026-10-04T22:00:00+00:00", month_spent_usd: 0, ...over,
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("SchedulesSection", () => {
  it("says there is no schedule yet, and lists one once created", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ schedules: [] })));
    render(<SchedulesSection />);
    expect(await screen.findByTestId("schedules-empty")).toBeTruthy();
  });

  it("shows a schedule's cadence, cap and spend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ schedules: [schedule({ month_spent_usd: 0.12 })] })));
    render(<SchedulesSection />);
    const row = await screen.findByTestId("schedule-row");
    expect(row).toHaveTextContent("Flashcards");
    expect(row).toHaveTextContent("Lecture 10");
    expect(row).toHaveTextContent("Every week on Sunday at 22:00 (UTC)");
    expect(row).toHaveTextContent("stops at $1.00 a month");
    expect(row).toHaveTextContent("spent $0.12 this month");
  });

  it("shows why a paused schedule is paused, with Resume", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "POST" && url.includes("/resume")
        ? json(schedule({ paused_reason: null, paused_kind: null }))
        : json({ schedules: [schedule({ paused_reason: "Paused — you haven't opened the last 3 results",
                                       paused_kind: "unopened" })] }));
    vi.stubGlobal("fetch", f);
    render(<SchedulesSection />);
    const row = await screen.findByTestId("schedule-row");
    expect(row).toHaveTextContent("Paused — you haven't opened the last 3 results");
    await userEvent.click(within(row).getByRole("button", { name: /resume/i }));
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/schedules/s1/resume", expect.objectContaining({ method: "POST" }));
  });

  it("deletes a schedule", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? json({ ok: true }) : json({ schedules: [schedule()] }));
    vi.stubGlobal("fetch", f);
    render(<SchedulesSection />);
    const row = await screen.findByTestId("schedule-row");
    await userEvent.click(within(row).getByRole("button", { name: /delete this schedule/i }));
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/schedules/s1", expect.objectContaining({ method: "DELETE" }));
  });

  it("the new-schedule form: pick a note, a job, a cadence, a cap, then save", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/trigger")) return json({ skill: null, skills: [
        { skill: "flashcards", title: "Flashcards", usd: 0.04, runnable: null },
        { skill: "compare-sources", title: "Compare sources", usd: null, runnable: "comparing needs at least two sources" },
      ] });
      if (url.includes("/quote")) return json({ price_mode: "batch", usd: 0.02, live_usd: 0.04, model: "m" });
      if (init?.method === "POST" && url.endsWith("/schedules")) return json(schedule());
      return json({ schedules: [] });
    });
    vi.stubGlobal("fetch", f);
    render(<SchedulesSection />);
    await screen.findByTestId("schedules-empty");
    await userEvent.click(screen.getByRole("button", { name: /new schedule/i }));

    const form = screen.getByTestId("new-schedule-form");
    expect(within(form).getByRole("button", { name: /^save$/i })).toBeDisabled();

    await userEvent.selectOptions(within(form).getByLabelText("Note"), "n1");
    await waitFor(() => expect(within(form).getByLabelText("Job")).not.toBeDisabled());
    await screen.findByText(/Half price · ≈\$0\.02 a run/);
    await userEvent.click(within(form).getByRole("button", { name: /^save$/i }));  // default cap $1.00 stays

    expect(f).toHaveBeenCalledWith("/api/ws/jobs/schedules", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ note_id: "n1", skill: "flashcards",
        cadence: { frequency: "weekly", time_of_day: "22:00",
          start_date: new Date().toISOString().slice(0, 10), weekdays: [7] },
        month_cap_usd: 1 }),
    }));
  });

  it("cannot save on a skill that cannot run here, and says why", async () => {
    const f = vi.fn(async (url: string) => url.includes("/trigger")
      ? json({ skill: null, skills: [{ skill: "compare-sources", title: "Compare sources", usd: null,
                                       runnable: "comparing needs at least two sources" }] })
      : json({ schedules: [] }));
    vi.stubGlobal("fetch", f);
    render(<SchedulesSection />);
    await userEvent.click(await screen.findByRole("button", { name: /new schedule/i }));
    const form = screen.getByTestId("new-schedule-form");
    await userEvent.selectOptions(within(form).getByLabelText("Note"), "n1");
    await waitFor(() => expect(within(form).getByLabelText("Job")).not.toBeDisabled());
    expect(await screen.findByText(/comparing needs at least two sources/)).toBeTruthy();
    expect(within(form).getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("cancelling the form discards it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ schedules: [] })));
    render(<SchedulesSection />);
    await userEvent.click(await screen.findByRole("button", { name: /new schedule/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByTestId("new-schedule-form")).toBeNull();
  });

  it("shows an error from the server instead of failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: { error: "Not signed in" } }, 401)));
    render(<SchedulesSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Not signed in");
  });
});
