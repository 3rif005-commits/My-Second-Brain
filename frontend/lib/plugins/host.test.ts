import { describe, expect, it, vi } from "vitest";
import { Channel, createPluginAPI, panels } from "./host";

const manifest = { id: "demo", name: "Demo", version: "1.0.0" };

describe("Channel — pages open and close under plugins", () => {
  it("reports pages already open, then new ones, and runs each cleanup on close", () => {
    const ch = new Channel<string>();
    const closeA = ch.publish("a", "A");
    const seen: string[] = [];
    const closed: string[] = [];
    ch.subscribe((h) => {
      seen.push(h);
      return () => closed.push(h);
    });
    const closeB = ch.publish("b", "B");
    expect(seen).toEqual(["A", "B"]);
    closeA();
    expect(closed).toEqual(["A"]);
    closeB();
    expect(closed).toEqual(["A", "B"]);
  });

  it("unsubscribing runs the cleanups of pages still open", () => {
    const ch = new Channel<string>();
    ch.publish("a", "A");
    const cleanup = vi.fn();
    const off = ch.subscribe(() => cleanup);
    off();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("re-publishing a key closes the previous handle first", () => {
    const ch = new Channel<string>();
    const closed: string[] = [];
    ch.subscribe((h) => () => closed.push(h));
    const stale = ch.publish("a", "A1");
    ch.publish("a", "A2");
    expect(closed).toEqual(["A1"]);
    stale(); // the old unpublish must not close the new handle
    expect(closed).toEqual(["A1"]);
  });

  it("a throwing subscriber does not stop the others", () => {
    const ch = new Channel<string>();
    const ok = vi.fn();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    ch.subscribe(() => {
      throw new Error("boom");
    });
    ch.subscribe(ok);
    ch.publish("a", "A");
    expect(ok).toHaveBeenCalledWith("A");
    err.mockRestore();
  });
});

describe("createPluginAPI — dispose undoes everything a plugin registered", () => {
  it("removes its panels, styles and page subscriptions", () => {
    const { api, dispose } = createPluginAPI(manifest);
    const onClose = vi.fn();
    api.workspace.onNoteOpen(() => onClose);
    api.ui.addPanel("p", () => null);
    api.ui.addStyle(".x{}");
    expect(panels.list().some((p) => p.key === "demo:p")).toBe(true);
    expect(document.querySelector('style[data-plugin="demo"]')).not.toBeNull();

    dispose();
    expect(panels.list().some((p) => p.key === "demo:p")).toBe(false);
    expect(document.querySelector('style[data-plugin="demo"]')).toBeNull();
  });

  it("keeps storage per plugin", () => {
    const a = createPluginAPI(manifest).api;
    const b = createPluginAPI({ ...manifest, id: "other" }).api;
    a.storage.set("k", { n: 1 });
    expect(a.storage.get("k")).toEqual({ n: 1 });
    expect(b.storage.get("k")).toBeUndefined();
  });
});
