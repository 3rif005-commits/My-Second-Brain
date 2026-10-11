import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SendToNotionPanel } from "./SendToNotionPanel";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const CONNECTED = { connected: true, workspace_name: "Test WS", root: { id: "r", title: "SB-TEST-root", url: "https://n/r" } };
const item = (over = {}) => ({
  note_id: "n1", title: "Lecture 10", state: "new", kind: "note", fidelity: "exact", losses: [], est_requests: 5,
  notion_url: null, released: false, selected: true, restore: false, moved: false, path: "", needs: null, resolution: null,
  mapping_id: null, ...over,
});
const plan = (i = item()) => ({ items: [i], counts: {}, nothing_to_send: !["new", "changed"].includes(i.state), est_requests: 5 });

function route(map: Record<string, (body: unknown) => Response>) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/ws/notion", "");
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ path, body });
    const key = Object.keys(map).find((k) => path.startsWith(k));
    return key ? map[key](body) : json({}, 404);
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("SendToNotionPanel", () => {
  it("shows the destination and an Exact pill, and sends only after Send is pressed", async () => {
    const calls = route({
      "/status": () => json(CONNECTED),
      "/plan": () => json(plan()),
      "/send": () => json({ status: "succeeded", requests: 5, plan: plan(), items: [
        { note_id: "n1", title: "Lecture 10", status: "done", action: "create", message: "Sent.", notion_url: "https://www.notion.so/abc", losses: [] }] }),
    });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    expect(await screen.findByTestId("notion-item")).toHaveTextContent("Lecture 10");
    expect(screen.getByTestId("fidelity-pill")).toHaveTextContent("Exact");
    expect(screen.getByText("SB-TEST-root")).toBeTruthy();
    expect(calls.some((c) => c.path.startsWith("/send"))).toBe(false);          // dry run only so far
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    const result = await screen.findByTestId("notion-result");
    expect(result).toHaveTextContent("Sent to Notion");
    expect(screen.getByRole("link", { name: /Open in Notion/ })).toHaveAttribute("href", "https://www.notion.so/abc");
  });

  it("lists losses in plain words", async () => {
    route({ "/status": () => json(CONNECTED), "/plan": () => json(plan(item({
      fidelity: "lossy", losses: [{ level: "lossy", what: "Text alignment (center).", fallback: "Notion has no alignment.", code: "text_align" }] }))) });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    expect(await screen.findByText("Text alignment (center).")).toBeTruthy();
    expect(screen.getByTestId("fidelity-pill")).toHaveTextContent("1 lossy");
  });

  it("says Nothing to send for an unchanged note and offers no Send button", async () => {
    route({ "/status": () => json(CONNECTED), "/plan": () => json(plan(item({ state: "unchanged" }))) });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    expect(await screen.findByTestId("nothing-to-send")).toHaveTextContent("Nothing to send");
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("blocks a private note until 'Send once anyway', which re-plans with the release", async () => {
    const calls = route({
      "/status": () => json(CONNECTED),
      "/plan": (b) => json(plan((b as { released: string[] }).released.length ? item({ released: true }) : item({ state: "private" }))),
    });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    await screen.findByText(/Private items never leave/);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Send once anyway" }));
    await screen.findByRole("button", { name: "Send" });
    expect((calls.filter((c) => c.path === "/plan").at(-1)?.body as { released: string[] }).released).toEqual(["n1"]);
  });

  it("connects and picks the page inside the panel, then shows the note (no trip to Settings)", async () => {
    let connected = false;
    const calls = route({
      "/status": () => json(connected ? CONNECTED : { connected: false }),
      "/connect": () => { connected = true; return json({ connected: true, workspace_name: "Test WS", pages: [{ id: "r", title: "SB-TEST-root", url: "https://n/r" }] }); },
      "/root": () => json(CONNECTED),
      "/plan": () => json(plan()),
    });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    expect(await screen.findByTestId("notion-not-connected")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Settings/ })).toBeNull();
    await userEvent.type(screen.getByLabelText("Notion token"), "ntn_secret_token");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await userEvent.click(await screen.findByRole("button", { name: /SB-TEST-root/ }));
    expect(await screen.findByTestId("notion-item")).toHaveTextContent("Lecture 10");
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(calls.some((c) => c.path.startsWith("/send"))).toBe(false);
  });

  it("Escape closes without sending", async () => {
    const onClose = vi.fn();
    const calls = route({ "/status": () => json(CONNECTED), "/plan": () => json(plan()) });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={onClose} />);
    await screen.findByTestId("notion-item");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(calls.some((c) => c.path.startsWith("/send"))).toBe(false);
  });

  it("shows a server error in an alert", async () => {
    route({ "/status": () => json({ detail: { error: "Notion is not connected." } }, 409) });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Notion is not connected."));
  });

  it("moves focus into the dialog, traps Tab inside it and gives focus back to the opener on close", async () => {
    route({ "/status": () => json(CONNECTED), "/plan": () => json(plan()) });
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    await screen.findByTestId("notion-item");
    expect(screen.getByRole("dialog")).toHaveFocus();
    const dialog = screen.getByRole("dialog");
    const focusables = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input:not([disabled])")];
    focusables[focusables.length - 1].focus();
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("Sync tab: switch on keeps the note in sync (adds a rule), switch off removes it", async () => {
    const calls = route({
      "/status": () => json(CONNECTED),
      "/plan": () => json(plan()),
      "/rules/r1": () => json({ deleted: "r1" }),
      "/rules": (b) => (b ? json({ id: "r1", scope_kind: "note", scope_id: "n1", mode: "on_change", include: {} }) : json({ rules: [] })),
      "/notes/n1": () => json({ connected: true, state: "synced", paused: false, notion_url: "https://www.notion.so/abc" }),
    });
    render(<SendToNotionPanel scope={{ note_ids: ["n1"] }} onClose={() => {}} />);
    await screen.findByTestId("notion-item");
    await userEvent.click(screen.getByRole("button", { name: "Sync tab" }));
    const sw = await screen.findByRole("switch", { name: "Keep this note in sync" });
    await waitFor(() => expect(sw).toBeEnabled());
    await userEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    expect(calls.some((c) => c.path === "/rules" && (c.body as { mode: string })?.mode === "on_change")).toBe(true);
    await userEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByRole("link", { name: /Open in Notion/ })).toHaveAttribute("href", "https://www.notion.so/abc");
  });
});
