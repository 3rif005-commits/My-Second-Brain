import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const open = vi.fn();
let state: string | null = null;
let connected = true;
vi.mock("@/context/NotionContext", () => ({
  useNotion: () => ({ connected, stateOf: () => state, open, selection: new Set(), isSelected: () => false }),
}));

import { NotionDot } from "./NotionDot";
import { NotionChip } from "./NotionChip";
import { RowMenu } from "./RowMenu";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); open.mockClear(); state = null; connected = true; });

describe("NotionDot", () => {
  it("is silent for something never sent and speaks plainly otherwise", () => {
    const { container, rerender } = render(<NotionDot state={null} />);
    expect(container.firstChild).toBeNull();
    for (const [s, word] of [["changed", /Changed since the last send/], ["failed", /failed/], ["needs_you", /changed in Notion/],
                             ["private", /Private/], ["synced", /In sync/], ["paused", /paused/]] as const) {
      rerender(<NotionDot state={s} />);
      expect(screen.getByRole("img", { name: word })).toBeTruthy();
    }
    rerender(<NotionDot state="deleted" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("NotionChip", () => {
  it("shows nothing when Notion is not connected", () => {
    connected = false;
    const { container } = render(<NotionChip noteId="n1" />);
    expect(container.firstChild).toBeNull();
  });
  it("says Not in Notion for a note never sent, and opens the panel on click", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ connected: true, state: "never_sent" })));
    render(<NotionChip noteId="n1" />);
    await userEvent.click(screen.getByRole("button", { name: /Not in Notion/ }));
    expect(open).toHaveBeenCalledWith({ note_ids: ["n1"] });
  });
  it("shows the state and a link to the page when it is in sync", async () => {
    state = "synced";
    vi.stubGlobal("fetch", vi.fn(async () => json({ connected: true, state: "synced", notion_url: "https://www.notion.so/abc" })));
    render(<NotionChip noteId="n1" />);
    expect(screen.getByTestId("notion-chip")).toHaveAttribute("data-state", "synced");
    await waitFor(() => expect(screen.getByRole("link", { name: "Open in Notion" })).toHaveAttribute("href", "https://www.notion.so/abc"));
  });
});

describe("RowMenu", () => {
  it("opens the review panel scoped to the right kind of item", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ rules: [] })));
    render(<RowMenu target={{ kind: "collection", id: "c1", title: "Physics", x: 10, y: 10 }} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("menuitem", { name: /Send to Notion/ }));
    expect(open).toHaveBeenCalledWith({ collection_ids: ["c1"] }, "Physics");
  });
  it("offers to keep a database in sync and sends the rule", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return json(url.endsWith("/rules") && !init?.method ? { rules: [] } : { id: "r1" });
    }));
    render(<RowMenu target={{ kind: "database", id: "d1", title: "Tasks", x: 0, y: 0 }} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("menuitem", { name: /Keep in sync/ }));
    await waitFor(() => expect(calls).toContain("POST /api/ws/notion/rules"));
  });
});
