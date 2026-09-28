import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityPage } from "./ActivityPage";
import type { Activity, ActivityJob } from "@/lib/backgroundJobs";

const job = (over: Partial<ActivityJob> = {}): ActivityJob => ({
  id: "j1", note_id: "n1", skill: "flashcards", focus: "", status: "applied", trigger: "run_later",
  price_mode: "normal", run_after: new Date().toISOString(), shown_estimate_usd: 0.04, actual_usd: 0.041,
  model: "claude-haiku-4-5", ran_late: false, error: null, cancel_reason: null, result_title: null,
  created_at: new Date().toISOString(), finished_at: new Date().toISOString(), note_title: "Lecture 10",
  live_equivalent_usd: null, result_meta: { input_tokens: 800, output_tokens: 400 }, started_at: null,
  applied_at: null, discarded_at: null, ...over,
});

const activity = (over: Partial<Activity> = {}): Activity => ({
  open: [], history: [], month_spent_usd: 0.43, monthly_cap_usd: 5, saved_usd: 0, ...over });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function stub(data: Activity, extra?: (url: string, init?: RequestInit) => Response | undefined) {
  const f = vi.fn(async (url: string, init?: RequestInit) =>
    extra?.(url, init) ?? (url.includes("/detail") ? json({ sources: [{ id: "s1", title: "Slides.pdf" }] }) : json(data)));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("ActivityPage", () => {
  it("says what to do when nothing has ever run", async () => {
    stub(activity());
    render(<ActivityPage />);
    expect(await screen.findByTestId("activity-empty")).toHaveTextContent(/Nothing has run in the background yet/);
  });

  it("shows the month's spend against the limit, and the saving only when there is one", async () => {
    stub(activity({ saved_usd: 0.39, history: [job()] }));
    render(<ActivityPage />);
    expect(await screen.findByTestId("month-line")).toHaveTextContent("This month: $0.43 of $5.00 · saved $0.39");
  });

  it("puts what needs you first, with the reason and the way out", async () => {
    stub(activity({ open: [
      job({ id: "b", status: "budget_blocked", error: "Not started — about $1.60 would pass your $5.00 monthly limit ($3.50 spent this month)", actual_usd: null }),
      job({ id: "r", status: "ready", skill: "study-guide" }),
      job({ id: "q", status: "queued", run_after: new Date(Date.now() + 3 * 3_600_000).toISOString(), actual_usd: null }),
    ] }));
    render(<ActivityPage />);
    const needs = await screen.findByTestId("needs-you");
    expect(needs).toHaveTextContent(/monthly limit \(\$3\.50 spent this month\)/);
    expect(within(needs).getByRole("link", { name: /change limit/i })).toHaveAttribute("href", "/brain/settings/background-jobs");
    expect(screen.getByTestId("ready")).toHaveTextContent("Study guide");
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/brain/workspace/n1?job=r");
    expect(screen.getByTestId("in-progress")).toHaveTextContent(/Queued · runs/);
  });

  it("dismissing a problem, cancelling a queued job and running it now call the API", async () => {
    const f = stub(activity({ open: [
      job({ id: "b", status: "failed", error: "boom", actual_usd: null }),
      job({ id: "q", status: "queued", run_after: new Date(Date.now() + 3_600_000).toISOString(), actual_usd: null }),
    ] }));
    render(<ActivityPage />);
    await userEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/b/discard", expect.objectContaining({ method: "POST" }));
    await userEvent.click(screen.getByRole("button", { name: /run now/i }));
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/q/run-now", expect.objectContaining({ method: "POST" }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/q/cancel", expect.objectContaining({ method: "POST" }));
  });

  it("lists the history and expands a row to the honest details", async () => {
    stub(activity({ history: [job({ price_mode: "batch", actual_usd: 0.041, live_equivalent_usd: 0.082,
      started_at: new Date().toISOString() })] }));
    render(<ActivityPage />);
    const row = await screen.findByTestId("history-row");
    expect(row).toHaveTextContent("Flashcards");
    expect(row).toHaveTextContent("Lecture 10");
    expect(row).toHaveTextContent("Run later");
    expect(row).toHaveTextContent("Applied");
    expect(row).toHaveTextContent("$0.04");
    await userEvent.click(row);
    const detail = await screen.findByTestId("history-detail");
    expect(detail).toHaveTextContent("Paid $0.04 · the same job run now would be $0.08 · saved $0.04");
    expect(detail).toHaveTextContent("claude-haiku-4-5");
    expect(detail).toHaveTextContent("1,200 tokens");
    await waitFor(() => expect(detail).toHaveTextContent("Made from: Slides.pdf"));
  });

  it("asks the server for the filter the user picked", async () => {
    const f = stub(activity({ history: [job()] }));
    render(<ActivityPage />);
    await screen.findByTestId("history-row");
    await userEvent.selectOptions(screen.getByLabelText("Job"), "flashcards");
    const asked = (part: string) => f.mock.calls.some((c) => String(c[0]).includes(part));
    await waitFor(() => expect(asked("skill=flashcards")).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText("Period"), "90");
    await waitFor(() => expect(asked("days=90")).toBe(true));
  });

  it("deletes a row from the history", async () => {
    const f = stub(activity({ history: [job()] }));
    render(<ActivityPage />);
    await userEvent.click(await screen.findByRole("button", { name: /delete from history/i }));
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/j1", expect.objectContaining({ method: "DELETE" }));
  });

  it("shows an error from the server instead of failing silently", async () => {
    stub(activity(), () => json({ detail: { error: "Not signed in" } }, 401));
    render(<ActivityPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Not signed in");
  });
});
