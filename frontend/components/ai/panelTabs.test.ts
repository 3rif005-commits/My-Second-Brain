import { describe, expect, it } from "vitest";
import {
  FLOAT_MIN, MAX_TABS, NEW_TAB_TITLE, addTab, clampFloat, closePanelTab, defaultFloat, freshTabs,
  patchTab, readDockSide, readFloatRect, readPanelTabs, showTab, type PanelTabs,
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

  it("always opens another tab, even beside an empty one (a + that did nothing read as broken)", () => {
    const once = addTab(three());
    const twice = addTab(once);
    expect(twice.tabs).toHaveLength(5);
    expect(twice.active).toBe(twice.tabs[4].id);
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
    expect(readDockSide("float")).toBe("float");
    expect(readDockSide(null)).toBe("right");
    expect(readDockSide("left")).toBe("right");
  });
});

describe("the floating AI window", () => {
  it("starts bottom-right, inside the window", () => {
    const r = defaultFloat(1300, 650);
    expect(r.left + r.width).toBe(1284);
    expect(r.top + r.height).toBe(634);
  });

  it("never gets smaller than usable, nor bigger than the window", () => {
    expect(clampFloat({ left: 10, top: 10, width: 50, height: 50 }, 1300, 650))
      .toMatchObject({ width: FLOAT_MIN.width, height: FLOAT_MIN.height });
    expect(clampFloat({ left: 0, top: 0, width: 5000, height: 5000 }, 1300, 650))
      .toMatchObject({ width: 1300, height: 650 });
  });

  it("keeps its tab bar reachable when dragged off screen or the window shrinks", () => {
    const off = clampFloat({ left: 2000, top: 2000, width: 400, height: 500 }, 1300, 650);
    expect(off.left).toBeLessThanOrEqual(1300 - 80);
    expect(off.top).toBeLessThanOrEqual(650 - 36);
    const left = clampFloat({ left: -1000, top: -50, width: 400, height: 500 }, 1300, 650);
    expect(left.left + left.width).toBeGreaterThanOrEqual(80);
    expect(left.top).toBe(0);
  });

  it("restores a saved spot, clamped to this window, or falls back to the default", () => {
    expect(readFloatRect(JSON.stringify({ left: 100, top: 50, width: 400, height: 500 }), 1300, 650))
      .toEqual({ left: 100, top: 50, width: 400, height: 500 });
    expect(readFloatRect(JSON.stringify({ left: 1250, top: 50, width: 400, height: 500 }), 900, 650).left)
      .toBe(900 - 80);
    expect(readFloatRect("junk", 1300, 650)).toEqual(defaultFloat(1300, 650));
    expect(readFloatRect(null, 1300, 650)).toEqual(defaultFloat(1300, 650));
  });
});
