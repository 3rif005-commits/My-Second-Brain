import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The MCP Apps card's "Review in Second Brain" link lands here with
// ?change=<id> (5.4) — mocked the same way ListView.test.tsx's own
// useSearchParams stub is, so the highlight effect can be driven by URL.
let mockSearch = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import ConnectedAppsPage from "./page";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const change = (id: string, over: Record<string, unknown> = {}) => ({
  id, app: "Claude", action: "update", note_id: "n1", reason: "fix a typo",
  note_title: "Lecture 10", current_text: "old", new_title: null, new_text: "new", created_at: "2026-09-29T10:00:00Z",
  ...over,
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mockSearch = ""; });

describe("Connected apps — the ?change= deep link", () => {
  it("scrolls to and highlights the matching pending change", async () => {
    mockSearch = "change=ch2";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      apps: [], pending: [change("ch1"), change("ch2")], setup: "",
    })));
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<ConnectedAppsPage />);
    await screen.findAllByTestId("pending-change");

    const card = document.getElementById("change-ch2");
    expect(card).toBeTruthy();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(card?.className).toContain("ring-indigo-400");
    expect(document.getElementById("change-ch1")?.className).not.toContain("ring-indigo-400");
  });

  it("does nothing when nothing matches the id, or no id is given", async () => {
    mockSearch = "change=does-not-exist";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ apps: [], pending: [change("ch1")], setup: "" })));
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<ConnectedAppsPage />);
    await screen.findAllByTestId("pending-change");
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.getElementById("change-ch1")?.className).not.toContain("ring-indigo-400");
  });
});
