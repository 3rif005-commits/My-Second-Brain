import { describe, expect, it } from "vitest";
import {
  MAX_TABS, NEW_TAB_TITLE, addTab, closePanelTab, freshTabs, patchTab, readDockSide,
  readPanelTabs, showTab, type PanelTabs,
} from "./panelTabs";

const three = (): PanelTabs => ({
  tabs: [
    { id: "a", threadId: "t1", title: "What is entropy?" },
    { id: "b", threadId: "t2", title: "Summarise lecture 3" },
    { id: "c", threadId: null, title: "Quiz me" },
  ],
  active: "b",
});

describe("AI panel tabs", () => {
  it("adds an empty conversation and shows it", () => {
    const s = addTab(three());
    expect(s.tabs).toHaveLength(4);
    expect(s.active).toBe(s.tabs[3].id);
    expect(s.tabs[3]).toMatchObject({ threadId: null, title: NEW_TAB_TITLE });
  });

  it("reuses an untouched new tab instead of piling up blank ones", () => {
    const once = addTab(three());
    const twice = addTab({ ...once, active: "a" });
    expect(twice.tabs).toHaveLength(4);
    expect(twice.active).toBe(once.active);
  });

  it("at the limit drops the oldest tab that isn't shown", () => {
    let s = freshTabs();
    for (let i = 0; i < MAX_TABS + 2; i++) {
      s = patchTab(s, s.active, { threadId: `t${i}`, title: `q${i}` });
      s = addTab(s);
    }
    expect(s.tabs).toHaveLength(MAX_TABS);
    expect(s.tabs.some((t) => t.id === s.active)).toBe(true);
  });

  it("closing the shown tab shows its neighbour", () => {
    expect(closePanelTab(three(), "b").active).toBe("c");
    const last = closePanelTab({ ...three(), active: "c" }, "c");
    expect(last.active).toBe("b");
    expect(closePanelTab(three(), "a").active).toBe("b");      // another tab: shown one stays
  });

  it("closing the last tab leaves a fresh one", () => {
    const s = closePanelTab(freshTabs(), freshTabs().active);
    expect(s.tabs).toHaveLength(1);
    const only = closePanelTab(s, s.active);
    expect(only.tabs).toHaveLength(1);
    expect(only.tabs[0].title).toBe(NEW_TAB_TITLE);
  });

  it("patching with nothing new keeps the same object (no re-render, no save)", () => {
    const s = three();
    expect(patchTab(s, "a", { threadId: "t1" })).toBe(s);
    expect(patchTab(s, "a", { title: "Entropy" }).tabs[0].title).toBe("Entropy");
    expect(showTab(s, "zz")).toBe(s);
  });

  it("restores saved tabs and rejects junk", () => {
    expect(readPanelTabs(JSON.stringify(three()))).toEqual(three());
    expect(readPanelTabs(JSON.stringify({ tabs: [{ id: "x" }], active: "nope" })))
      .toEqual({ tabs: [{ id: "x", threadId: null, title: NEW_TAB_TITLE }], active: "x" });
    expect(readPanelTabs("{")).toBeNull();
    expect(readPanelTabs(JSON.stringify({ tabs: [] }))).toBeNull();
    expect(readPanelTabs(null)).toBeNull();
  });

  it("dock side defaults to the right", () => {
    expect(readDockSide("bottom")).toBe("bottom");
    expect(readDockSide(null)).toBe("right");
    expect(readDockSide("left")).toBe("right");
  });
});
