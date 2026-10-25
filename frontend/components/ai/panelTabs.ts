// The AI panel's conversation tabs. Each tab is its own Chat, kept mounted while
// another is shown, so an answer or job keeps running in a tab you left. Pure
// functions over a plain object (persisted in localStorage) so every move is tested.

export interface PanelTab {
  id: string;
  /** The stored thread, once the first message has been sent (or one was opened). */
  threadId: string | null;
  /** What the tab says: the conversation's first question. */
  title: string;
}

export interface PanelTabs { tabs: PanelTab[]; active: string }

/** Where the panel sits: down the right edge, or along the bottom under the page. */
export type DockSide = "right" | "bottom";

export const MAX_TABS = 8;
export const NEW_TAB_TITLE = "New chat";

const newId = () => Math.random().toString(36).slice(2, 10);

export function freshTabs(): PanelTabs {
  const id = newId();
  return { tabs: [{ id, threadId: null, title: NEW_TAB_TITLE }], active: id };
}

/** A new, empty conversation, shown. At the limit, the oldest tab not shown makes room. */
export function addTab(s: PanelTabs): PanelTabs {
  const blank = s.tabs.find((t) => !t.threadId && t.title === NEW_TAB_TITLE);
  if (blank) return { ...s, active: blank.id };
  let tabs = s.tabs;
  if (tabs.length >= MAX_TABS) {
    const drop = tabs.find((t) => t.id !== s.active);
    tabs = tabs.filter((t) => t !== drop);
  }
  const id = newId();
  return { tabs: [...tabs, { id, threadId: null, title: NEW_TAB_TITLE }], active: id };
}

/** Close a tab; its neighbour is shown, as in a browser. The last tab closed leaves a fresh one. */
export function closePanelTab(s: PanelTabs, id: string): PanelTabs {
  const idx = s.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return s;
  const tabs = s.tabs.filter((t) => t.id !== id);
  if (!tabs.length) return freshTabs();
  const active = s.active === id ? tabs[Math.min(idx, tabs.length - 1)].id : s.active;
  return { tabs, active };
}

export function showTab(s: PanelTabs, id: string): PanelTabs {
  return s.tabs.some((t) => t.id === id) ? { ...s, active: id } : s;
}

export function patchTab(s: PanelTabs, id: string, patch: Partial<Omit<PanelTab, "id">>): PanelTabs {
  let changed = false;
  const tabs = s.tabs.map((t) => {
    if (t.id !== id) return t;
    const next = { ...t, ...patch };
    changed = next.threadId !== t.threadId || next.title !== t.title;
    return next;
  });
  return changed ? { ...s, tabs } : s;
}

/** Restore saved tabs, or null when the stored value is not a set of them. */
export function readPanelTabs(raw: string | null): PanelTabs | null {
  try {
    const v = JSON.parse(raw ?? "null");
    if (!v || !Array.isArray(v.tabs)) return null;
    const tabs: PanelTab[] = v.tabs
      .filter((t: PanelTab) => t && typeof t.id === "string")
      .slice(0, MAX_TABS)
      .map((t: PanelTab) => ({
        id: t.id,
        threadId: typeof t.threadId === "string" ? t.threadId : null,
        title: typeof t.title === "string" && t.title ? t.title : NEW_TAB_TITLE,
      }));
    if (!tabs.length) return null;
    const active = tabs.some((t) => t.id === v.active) ? v.active : tabs[0].id;
    return { tabs, active };
  } catch {
    return null;
  }
}

export function readDockSide(raw: string | null): DockSide {
  return raw === "bottom" ? "bottom" : "right";
}
