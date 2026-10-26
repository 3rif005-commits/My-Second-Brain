import { describe, expect, it } from "vitest";
import {
  ASK, activate, canFloat, closeTab, defaultLayout, dockFloat, fitPanes, floatTab, focusFloat, focusPane,
  moveTab, moveToOtherSide, noteKey, openTab, readLayout, reconcile, srcKey,
} from "./sessionLayout";

const base = () => defaultLayout("home", ["a", "b"]);

describe("defaultLayout", () => {
  it("puts the sources left and the session's note right, writing in the note", () => {
    const l = base();
    expect(l.panes).toEqual([
      { tabs: ["s:a", "s:b"], active: "s:a" },
      { tabs: ["n:home"], active: "n:home" },
    ]);
    expect(l.focus).toBe(1);
    expect(l.target).toBe("home");
  });
  it("is one pane when there are no sources", () => {
    expect(defaultLayout("home", []).panes).toEqual([{ tabs: ["n:home"], active: "n:home" }]);
  });
});

describe("openTab", () => {
  it("opens a new note here, and makes it the writing target", () => {
    const l = openTab(base(), noteKey("old"), "here", 2);
    expect(l.panes[1]).toEqual({ tabs: ["n:home", "n:old"], active: "n:old" });
    expect(l.target).toBe("old");
  });
  it("opens beside: a new pane while there is room", () => {
    const l = openTab(defaultLayout("home", []), srcKey("x"), "beside", 2);
    expect(l.panes).toHaveLength(2);
    expect(l.panes[1]).toEqual({ tabs: ["s:x"], active: "s:x" });
    expect(l.focus).toBe(1);
    expect(l.target).toBe("home");   // a source never becomes the target
  });
  it("beside with no room goes to the other pane", () => {
    const l = openTab(base(), srcKey("x"), "beside", 2);
    expect(l.panes[0].tabs).toContain("s:x");
  });
  it("an already open tab is just shown where it is", () => {
    const l = openTab(base(), srcKey("b"), "beside", 2);
    expect(l.panes[0].active).toBe("s:b");
    expect(l.panes[0].tabs).toEqual(["s:a", "s:b"]);
  });
  it("'here' brings an open tab over to the focused pane", () => {
    const l = openTab(base(), srcKey("b"), "here", 2);
    expect(l.panes[1].tabs).toEqual(["n:home", "s:b"]);
    expect(l.panes[0].tabs).toEqual(["s:a"]);
  });
});

describe("moveTab / moveToOtherSide", () => {
  it("moves a source across so two sources sit side by side", () => {
    const l = moveToOtherSide(base(), srcKey("b"), 2);
    expect(l.panes[0]).toEqual({ tabs: ["s:a"], active: "s:a" });
    expect(l.panes[1]).toEqual({ tabs: ["n:home", "s:b"], active: "s:b" });
    expect(l.focus).toBe(1);
  });
  it("moving a pane's last tab removes that pane and keeps the index right", () => {
    let l = openTab(base(), ASK, 2, 3);           // three panes: sources | note | ask
    l = moveTab(l, noteKey("home"), 2, 3);         // note joins the AI
    expect(l.panes).toHaveLength(2);
    expect(l.panes[1].tabs).toEqual([ASK, "n:home"]);
    expect(l.focus).toBe(1);
  });
  it("from a single pane, ⇄ opens a second pane when there is room", () => {
    const l = moveToOtherSide(defaultLayout("home", []), noteKey("home"), 2);
    expect(l.panes).toHaveLength(1);           // the only tab: nothing to split
    const two = moveToOtherSide(openTab(defaultLayout("home", []), srcKey("x"), "here", 2), srcKey("x"), 2);
    expect(two.panes).toHaveLength(2);
    expect(two.panes[1].tabs).toEqual(["s:x"]);
  });
});

describe("closeTab", () => {
  it("shows the neighbour, and an emptied pane goes away", () => {
    let l = closeTab(base(), srcKey("a"));
    expect(l.panes[0]).toEqual({ tabs: ["s:b"], active: "s:b" });
    l = closeTab(l, srcKey("b"));
    expect(l.panes).toEqual([{ tabs: ["n:home"], active: "n:home" }]);
    expect(l.focus).toBe(0);
  });
  it("closing the target note moves the target to another open note", () => {
    let l = openTab(base(), noteKey("old"), "here", 2);
    l = closeTab(l, noteKey("old"));
    expect(l.target).toBe("home");
  });
});

describe("focus and activate", () => {
  it("clicking into a pane that shows a note makes that note the target", () => {
    let l = openTab(base(), noteKey("old"), 0, 2);  // old note on the left
    l = focusPane(activate(l, 1, noteKey("home")), 0);
    expect(l.target).toBe("old");
  });
});

describe("fitPanes / reconcile / readLayout", () => {
  it("folds a third pane into the second on a narrower window", () => {
    const l = fitPanes(openTab(base(), ASK, 2, 3), 2);
    expect(l.panes).toHaveLength(2);
    expect(l.panes[1].tabs).toEqual(["n:home", ASK]);
  });
  it("drops tabs whose thing is gone and never leaves zero panes", () => {
    const l = reconcile(base(), (k) => k.startsWith("n:"), "home");
    expect(l.panes).toEqual([{ tabs: ["n:home"], active: "n:home" }]);
    const none = reconcile(base(), () => false, "home");
    expect(none.panes).toEqual([{ tabs: ["n:home"], active: "n:home" }]);
  });
  it("reads back what it wrote, and refuses junk", () => {
    const l = openTab(base(), noteKey("old"), "beside", 3);
    expect(readLayout(JSON.stringify(l))).toEqual(l);
    expect(readLayout("{nope")).toBeNull();
    expect(readLayout(JSON.stringify({ panes: 3 }))).toBeNull();
  });
});

describe("a floating tab", () => {
  // sources | home, other — "other" brought in beside the session's note
  const two = () => openTab(base(), noteKey("other"), "here", 3);

  it("leaves its pane, and is the one written in", () => {
    const l = floatTab(two(), noteKey("other"));
    expect(l.floating).toBe("n:other");
    expect(l.panes[1]).toEqual({ tabs: ["n:home"], active: "n:home" });
    expect(l.target).toBe("other");
  });
  it("never leaves the panes empty, and the AI never floats here", () => {
    const one = defaultLayout("home", []);
    expect(canFloat(one, noteKey("home"))).toBe(false);
    expect(floatTab(one, noteKey("home"))).toBe(one);
    expect(canFloat({ ...base(), panes: [...base().panes, { tabs: [ASK], active: ASK }] }, ASK)).toBe(false);
  });
  it("a source floats too, and leaves the writing target alone", () => {
    const l = floatTab(base(), srcKey("a"));
    expect(l.floating).toBe("s:a");
    expect(l.panes[0]).toEqual({ tabs: ["s:b"], active: "s:b" });
    expect(l.target).toBe("home");
    expect(focusFloat(l)).toBe(l);
  });
  it("a pane holding only it goes away", () => {
    const l = floatTab(base(), noteKey("home"));
    expect(l.panes).toEqual([{ tabs: ["s:a", "s:b"], active: "s:a" }]);
    expect(l.floating).toBe("n:home");
  });
  it("swaps places with the note floating before it", () => {
    let l = floatTab(two(), noteKey("other"));
    l = floatTab(l, noteKey("home"));
    expect(l.floating).toBe("n:home");
    expect(l.panes[1]).toEqual({ tabs: ["n:other"], active: "n:other" });
    expect(l.target).toBe("home");
  });
  it("docks back as the shown tab of a pane", () => {
    const l = dockFloat(floatTab(two(), noteKey("other")), 0, 3);
    expect(l.floating).toBeNull();
    expect(l.panes[0]).toEqual({ tabs: ["s:a", "s:b", "n:other"], active: "n:other" });
    expect(l.focus).toBe(0);
  });
  it("opening it again keeps it floating; an explicit pane docks it", () => {
    const f = { ...floatTab(two(), noteKey("other")), target: "home" };
    const here = openTab(f, noteKey("other"), "here", 3);
    expect(here.floating).toBe("n:other");
    expect(here.target).toBe("other");
    expect(here.panes.flatMap((p) => p.tabs)).not.toContain("n:other");
    expect(openTab(f, noteKey("other"), 1, 3).panes[1].active).toBe("n:other");
  });
  it("closing it hands writing to an open note; clicking it takes writing back", () => {
    const f = floatTab(two(), noteKey("other"));
    const closed = closeTab(f, noteKey("other"));
    expect(closed.floating).toBeNull();
    expect(closed.target).toBe("home");
    expect(focusFloat({ ...f, target: "home" }).target).toBe("other");
  });
  it("is dropped when its note is gone, and docked when nothing else is left", () => {
    const f = floatTab(two(), noteKey("other"));
    expect(reconcile(f, (k) => k !== "n:other", "home").floating).toBeNull();
    const only = reconcile(f, (k) => k === "n:other", "home");
    expect(only.floating).toBeNull();
    expect(only.panes).toEqual([{ tabs: ["n:other"], active: "n:other" }]);
  });
  it("survives a reload", () => {
    const f = floatTab(two(), noteKey("other"));
    expect(readLayout(JSON.stringify(f))).toEqual(f);
  });
});
