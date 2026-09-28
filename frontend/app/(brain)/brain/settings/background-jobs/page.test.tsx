import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hooks/useNotes", () => ({ useNotes: () => ({ notes: [] }) }));

import BackgroundJobsSettings from "./page";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const SETTINGS = { monthly_cap_usd: 5, default_monthly_cap_usd: 5, min_usd: 0.01, max_usd: 1000, month_spent_usd: 0.43 };

/** Branches on the URL, like the real backend would — the page also mounts
 *  SchedulesSection, which fetches its own endpoint. */
function stub(extra?: (url: string, init?: RequestInit) => Response | undefined) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const hit = extra?.(url, init);
    if (hit) return hit;
    if (url.includes("/jobs/schedules")) return json({ schedules: [] });
    if (init?.method === "PUT") return json({ monthly_cap_usd: 0.01, month_spent_usd: 0.43 });
    return json(SETTINGS);
  });
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Settings → Background jobs", () => {
  it("shows the limit and what has been spent, and saves a new limit", async () => {
    const f = stub();
    render(<BackgroundJobsSettings />);

    const input = await screen.findByLabelText("Monthly limit in dollars");
    await waitFor(() => expect(input).toHaveValue("5"));
    expect(screen.getByTestId("spent-line")).toHaveTextContent("Spent so far this month: $0.43.");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();                       // nothing changed yet

    await userEvent.clear(input);
    await userEvent.type(input, "0.01");
    await userEvent.click(save);
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/settings", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ monthly_cap_usd: 0.01 }) }));
    expect(await screen.findByTestId("settings-note")).toHaveTextContent("Saved — the limit is $0.01 a month.");
  });

  it("does not let a nonsense amount be saved", async () => {
    stub();
    render(<BackgroundJobsSettings />);
    const input = await screen.findByLabelText("Monthly limit in dollars");
    await waitFor(() => expect(input).toHaveValue("5"));
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Enter an amount between \$0\.01 and \$1000\.00/)).toBeTruthy();
  });
});
