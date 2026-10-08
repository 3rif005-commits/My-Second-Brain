import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SendToNotionPanel } from "./SendToNotionPanel";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const CONNECTED = { connected: true, workspace_name: "WS", root: { id: "r", title: "SB-TEST-root", url: "https://n/r" } };
const item = (over = {}) => ({
  note_id: "n1", title: "Lecture 10", state: "new", kind: "note", fidelity: "exact", losses: [], est_requests: 5,
  notion_url: null, released: false, selected: true, restore: false, moved: false, path: "", needs: null, resolution: null,
  mapping_id: null, ...over,
});
const plan = (items: unknown[]) => ({ items, counts: {}, nothing_to_send: false, est_requests: 10 });

function route(map: Record<string, (body: any, path: string) => Response>) {
  const calls: { path: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/ws/notion", "");
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ path, body });
    const key = Object.keys(map).sort((a, b) => b.length - a.length).find((k) => path.startsWith(k));
    return key ? map[key](body, path) : json({}, 404);
  }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("review panel with several items", () => {
  it("groups them in tabs with counts and sends only the ticked ones", async () => {
    const items = [
      item({ note_id: "c1", kind: "collection", title: "Physics" }), item({ note_id: "a", title: "Lenses", path: "Physics" }),
      item({ note_id: "b", title: "Mirrors", path: "Physics", state: "changed" }),
      item({ note_id: "u", title: "Unchanged one", state: "unchanged", selected: false }),
    ];
    const calls = route({ "/status": () => json(CONNECTED), "/plan": (b) => json(plan(items.map((i) => ({ ...i, selected: i.state === "unchanged" ? false : !b.exclude.includes(i.note_id) })))),
      "/send": () => json({ status: "succeeded", requests: 9, plan: plan(items), items: [] }) });
    render(<SendToNotionPanel scope={{ collection_ids: ["c1"] }} title="Physics" onClose={() => {}} />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["New 2", "Changed 1", "Unchanged 1"]);
    expect(screen.getByRole("button", { name: "Send 3 items" })).toBeTruthy();
    expect(screen.getAllByTestId("notion-item")).toHaveLength(2);
    await userEvent.click(screen.getByRole("tab", { name: "Changed 1" }));
    expect(screen.getByText("Mirrors")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "New 2" }));
    await userEvent.click(screen.getByLabelText("Send Lenses"));                // untick one
    expect(screen.getByRole("button", { name: "Send 2 items" })).toBeTruthy();
    await waitFor(() => expect(calls.filter((c) => c.path === "/plan").at(-1)?.body.exclude).toEqual(["a"]));
  });

  it("shows what changed in Notion and needs a second click to overwrite", async () => {
    const needs = { reason: "edited_in_notion", edited_at: "2026-10-09T10:00:00Z", foreign_blocks: 1,
      diff: [{ op: "same", text: "a" }, { op: "notion", text: "typed in Notion" }, { op: "ours", text: "mine" }] };
    const calls = route({ "/status": () => json(CONNECTED),
      "/plan": (b) => json(plan([b.resolutions?.n1 ? item({ state: "changed", resolution: b.resolutions.n1 }) : item({ state: "needs_you", needs })])) });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    const diff = await screen.findByTestId("notion-diff");
    expect(within(diff).getByText("typed in Notion")).toBeTruthy();
    expect(within(diff).getByText("mine")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();           // held back
    await userEvent.click(screen.getByRole("button", { name: /Overwrite with Second Brain/ }));
    expect(calls.some((c) => c.body?.resolutions?.n1)).toBe(false);              // first click only asks
    await userEvent.click(screen.getByRole("button", { name: /Yes, overwrite/ }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/plan").at(-1)?.body.resolutions).toEqual({ n1: "overwrite" }));
    expect(await screen.findByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("keep-both and skip send the right resolution", async () => {
    const needs = { reason: "edited_in_notion", diff: [] };
    const calls = route({ "/status": () => json(CONNECTED), "/plan": () => json(plan([item({ state: "needs_you", needs })])) });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /Keep both/ }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/plan").at(-1)?.body.resolutions).toEqual({ n1: "copy" }));
  });

  it("an unreachable page offers Create it again / Forget it", async () => {
    route({ "/status": () => json(CONNECTED), "/plan": () => json(plan([item({ state: "needs_you", needs: { reason: "unreachable" } })])) });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    expect(await screen.findByRole("button", { name: "Create it again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Forget it/ })).toBeTruthy();
  });

  it("a deleted note is listed unticked and ticking it sends it to the archive list", async () => {
    const calls = route({ "/status": () => json(CONNECTED),
      "/plan": (b) => json(plan([item({ state: "deleted", selected: b.archive_ids.includes("n1") })])) });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    const box = await screen.findByLabelText("Send Lecture 10");
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await userEvent.click(box);
    await waitFor(() => expect(calls.filter((c) => c.path === "/plan").at(-1)?.body.archive_ids).toEqual(["n1"]));
    expect(await screen.findByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("several items run in the background with progress, then summarise and offer Retry failed", async () => {
    const items = [item({ note_id: "a", title: "A" }), item({ note_id: "b", title: "B" })];
    let polls = 0;
    const calls = route({
      "/status": () => json(CONNECTED), "/plan": () => json(plan(items)),
      "/send": () => json({ status: "queued", run_id: "run1", items: [], requests: 0, plan: plan(items) }),
      "/runs/run1/retry": () => json({ status: "queued", run_id: "run2" }),
      "/runs/run2": () => json({ id: "run2", status: "succeeded", items: [{ id: "i1", kind: "note", local_id: "b", title: "B", status: "done", action: "create", message: "Sent.", error_class: null }] }),
      "/runs/run1": () => json({ id: "run1", status: ++polls < 2 ? "running" : "partial", items: [
        { id: "i0", kind: "note", local_id: "a", title: "A", status: "done", action: "create", message: "Sent.", error_class: null },
        { id: "i1", kind: "note", local_id: "b", title: "B", status: polls < 2 ? "running" : "failed", action: "create", message: "Notion isn't responding.", error_class: "retryable" }] }),
    });
    render(<SendToNotionPanel scope={{ note_ids: ["a", "b"] }} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Send 2 items" }));
    expect(calls.find((c) => c.path === "/send")?.body.background).toBe(true);
    const result = await screen.findByTestId("notion-result", {}, { timeout: 4000 });
    expect(result).toHaveTextContent("1 sent to Notion · 1 with a problem");
    await userEvent.click(screen.getByRole("button", { name: "Retry failed" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/runs/run1/retry")).toBe(true));
  });
});
