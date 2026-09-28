import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const showToast = vi.fn();
vi.mock("@/app/providers", () => ({ useToast: () => ({ showToast }) }));
vi.mock("./panelSources", () => ({ readNote: vi.fn().mockResolvedValue({ title: "Lecture 10", empty: false }) }));

import { BackgroundJobs } from "./BackgroundJobs";
import type { BgJob } from "@/lib/backgroundJobs";

const job = (over: Partial<BgJob> = {}): BgJob => ({
  id: "j1", note_id: "n1", skill: "flashcards", focus: "", status: "queued", trigger: "run_later",
  price_mode: "normal", run_after: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  shown_estimate_usd: 0.04, actual_usd: null, model: null, ran_late: false, error: null,
  cancel_reason: null, result_title: null, created_at: new Date().toISOString(), finished_at: null, ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const props = {
  noteId: "n1", noteTitle: "Lecture 10", pageNoteId: "n1", inWorkspace: true, refreshKey: 0,
  onApply: vi.fn().mockResolvedValue(undefined), onUndo: vi.fn().mockResolvedValue("undone"),
  onOpen: vi.fn(), onAgain: vi.fn(),
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("BackgroundJobs", () => {
  it("renders nothing when there are no open jobs", async () => {
    const f = vi.fn().mockResolvedValue(json({ jobs: [] }));
    vi.stubGlobal("fetch", f);
    const { container } = render(<BackgroundJobs {...props} />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("shows a queued job with when it runs, and cancels it", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/cancel")) return json(job({ status: "cancelled" }));
      return json({ jobs: [job()] });
    });
    vi.stubGlobal("fetch", f);
    render(<BackgroundJobs {...props} />);

    expect(await screen.findByText(/Queued · runs/)).toBeTruthy();
    expect(screen.getByText("Flashcards")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/j1/cancel", expect.objectContaining({ method: "POST" }));
  });

  it("says why a job failed and lets the user dismiss it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ jobs: [
      job({ status: "failed", error: "Flashcards: no sources are ready yet." })] })));
    render(<BackgroundJobs {...props} />);
    expect(await screen.findByText(/Failed — Flashcards: no sources are ready yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dismiss/ })).toBeTruthy();
  });

  it("opens a ready result as the normal result card, labelled Background", async () => {
    const ready = job({ status: "ready", finished_at: new Date(Date.now() - 3 * 3_600_000).toISOString() });
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.endsWith("/jobs/j1")
        ? json({ ...ready, result_html: "<h2>Cards</h2>", source_ids: ["s1"], result_meta: {} })
        : json({ jobs: [ready] })));
    render(<BackgroundJobs {...props} />);

    expect(await screen.findByTestId("job-badge")).toBeTruthy();
    expect(screen.getByTestId("job-badge").textContent).toContain("Background · ready 3h ago");
    expect(screen.getByRole("button", { name: /Insert into this note/ })).toBeTruthy();
  });

  it("applies a ready result through the panel's own path, then tells the server", async () => {
    const ready = job({ status: "ready", finished_at: new Date().toISOString() });
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/applied")) return json({ ...ready, status: "applied" });
      if (url.endsWith("/jobs/j1")) return json({ ...ready, result_html: "<p>x</p>", source_ids: [], result_meta: {} });
      return json({ jobs: [ready] });
    });
    vi.stubGlobal("fetch", f);
    render(<BackgroundJobs {...props} />);

    await userEvent.click(await screen.findByRole("button", { name: /Insert into this note/ }));
    await waitFor(() => expect(props.onApply).toHaveBeenCalledWith(
      expect.objectContaining({ skill: "flashcards" }), "n1"));
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/ws/jobs/j1/applied",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ note_id: "n1" }) })));
    expect(await screen.findByText(/In “Lecture 10”/)).toBeTruthy();
  });
});

describe("BackgroundJobs — batch and price decisions", () => {
  it("says a batch job was sent, and warns that cancelling may still be charged", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("/cancel") ? json(job({ status: "cancelled" }))
        : json({ jobs: [job({ status: "submitted", price_mode: "batch" })] }));
    vi.stubGlobal("fetch", f);
    render(<BackgroundJobs {...props} />);
    expect(await screen.findByText(/Sent · half price · usually under an hour, at most 24 hours/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    // a toast: the card itself is gone as soon as the job is cancelled
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/still charged/), "info"));   // calm, not an error
  });

  it("does not warn about charges when a live job is cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/cancel") ? json(job({ status: "cancelled" }))
        : json({ jobs: [job({ status: "queued" })] })));
    showToast.mockClear();
    render(<BackgroundJobs {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/ws/jobs/j1/cancel", expect.anything()));
    expect(showToast).not.toHaveBeenCalled();          // nothing had started, nothing to be charged
  });

  it("asks before running at a higher price, and the button names the price", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("/accept-price") ? json(job({ status: "queued" })) : json({ jobs: [job({
        status: "needs_you", error: "Price went up: about $0.08 now (was about $0.04)",
        result_meta: { was_usd: 0.04, now_usd: 0.08, now_mode: "normal" } })] }));
    vi.stubGlobal("fetch", f);
    render(<BackgroundJobs {...props} />);
    expect(await screen.findByText(/Price went up: about \$0\.08 now/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Run at $0.08" }));
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/j1/accept-price", expect.objectContaining({ method: "POST" }));
  });

  it("lets the user turn a price decision down", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("/discard") ? json(job({ status: "discarded" })) : json({ jobs: [job({
        status: "needs_you", error: "Price went up", result_meta: { now_usd: 0.08 } })] }));
    vi.stubGlobal("fetch", f);
    render(<BackgroundJobs {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/j1/discard", expect.objectContaining({ method: "POST" }));
  });
});

describe("BackgroundJobs — after Insert", () => {
  const readyJob = job({ status: "ready", finished_at: new Date().toISOString() });
  const server = (jobsAfterApply: BgJob[]) => {
    let applied = false;
    return vi.fn(async (url: string) => {
      if (url.endsWith("/applied")) { applied = true; return json({ ...readyJob, status: "applied" }); }
      if (url.endsWith("/jobs/j1")) return json({ ...readyJob, result_html: "<p>x</p>", source_ids: [], result_meta: {} });
      return json({ jobs: applied ? jobsAfterApply : [readyJob] });
    });
  };

  it("keeps the card and its Undo when the next refresh no longer lists the job", async () => {
    vi.stubGlobal("fetch", server([]));                       // the server stops listing an applied job
    const { rerender } = render(<BackgroundJobs {...props} refreshKey={0} />);
    await userEvent.click(await screen.findByRole("button", { name: /Insert into this note/ }));
    await screen.findByText(/In “Lecture 10”/);
    rerender(<BackgroundJobs {...props} refreshKey={1} />);   // a refresh, as the poll would do
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes("status=")).length).toBeGreaterThan(1));
    expect(screen.getByText(/In “Lecture 10”/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Undo/ })).toBeTruthy();
  });

  it("puts it back after an Undo, and inserting again does not record a second apply", async () => {
    const f = server([]);
    vi.stubGlobal("fetch", f);
    props.onApply.mockClear();
    render(<BackgroundJobs {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: /Insert into this note/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Undo/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Insert into this note/ }));
    await waitFor(() => expect(props.onApply).toHaveBeenCalledTimes(2));
    const recorded = f.mock.calls.filter((c) => String(c[0]).endsWith("/applied")).length;
    expect(recorded).toBe(1);
  });

  it("says so when putting it in the note fails, instead of doing nothing", async () => {
    vi.stubGlobal("fetch", server([]));
    showToast.mockClear();
    props.onApply.mockRejectedValueOnce(new Error("The note is read-only"));
    render(<BackgroundJobs {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: /Insert into this note/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("The note is read-only", "error"));
    expect(screen.queryByText(/In “/)).toBeNull();
  });
});

describe("BackgroundJobs — a job refused by the limit", () => {
  it("says why, points at the limit, and can be dismissed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ jobs: [job({ status: "budget_blocked",
      error: "Not started — about $0.03 would pass your $0.01 monthly limit ($1.50 spent this month)" })] })));
    render(<BackgroundJobs {...props} />);
    expect(await screen.findByText(/would pass your \$0\.01 monthly limit \(\$1\.50 spent this month\)/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Change limit" })).toHaveAttribute("href", "/brain/settings/background-jobs");
    expect(screen.getByRole("button", { name: /Dismiss/ })).toBeTruthy();
  });
});

describe("BackgroundJobs — a job just queued", () => {
  it("shows at once, before the list comes back, and is not shown twice when it does", async () => {
    let release: (v: Response) => void = () => {};
    const slow = new Promise<Response>((res) => { release = res; });
    vi.stubGlobal("fetch", vi.fn(() => slow));
    const seed = job({ id: "new", status: "queued" });
    render(<BackgroundJobs {...props} seed={seed} />);
    expect(await screen.findByText(/Queued · runs/)).toBeTruthy();          // the list has not answered yet
    release(json({ jobs: [seed] }));
    await waitFor(() => expect(screen.getAllByTestId("background-job-card")).toHaveLength(1));
  });

  it("ignores a job that belongs to another note", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ jobs: [] })));
    const { container } = render(<BackgroundJobs {...props} seed={job({ note_id: "other" })} />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});

describe("BackgroundJobs — a stale result", () => {
  it("warns when a source has changed since, before it is put in the note", async () => {
    const ready = job({ status: "ready", finished_at: new Date().toISOString() });
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.endsWith("/jobs/j1")
        ? json({ ...ready, result_html: "<p>x</p>", source_ids: ["s1"], result_meta: {},
                 stale: { reason: "changed", message: 'Made from an older version of "Slides.pdf".' } })
        : json({ jobs: [ready] })));
    render(<BackgroundJobs {...props} />);
    expect(await screen.findByTestId("stale-warning")).toHaveTextContent('Made from an older version of "Slides.pdf".');
    expect(screen.getByRole("button", { name: /Insert into this note/ })).toBeTruthy();   // still works
  });

  it("shows nothing extra when the sources have not changed", async () => {
    const ready = job({ status: "ready", finished_at: new Date().toISOString() });
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.endsWith("/jobs/j1")
        ? json({ ...ready, result_html: "<p>x</p>", source_ids: ["s1"], result_meta: {}, stale: null })
        : json({ jobs: [ready] })));
    render(<BackgroundJobs {...props} />);
    await screen.findByRole("button", { name: /Insert into this note/ });
    expect(screen.queryByTestId("stale-warning")).toBeNull();
  });
});
