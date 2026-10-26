// What a workspace session shows where: up to three panes, each a row of tabs.
// A tab is a source ("s:<id>"), a note ("n:<id>") or the AI ("ask"). Any tab
// can sit in any pane (redesign 2026-10-25, "any tab on either side").
//
// Pure functions over a plain object so every move is unit-tested and the
// shell only wires them up. The session's own note ("home") owns the sources;
// other notes and sources from other notes can be brought in beside it.

export type TabKey = string;
/** How many windows can float at once; one more sends the oldest back to its pane. */
export const MAX_FLOAT = 4;
export const ASK: TabKey = "ask";
export const srcKey = (id: string): TabKey => `s:${id}`;
export const noteKey = (id: string): TabKey => `n:${id}`;

export function parseKey(key: TabKey): { kind: "source" | "note" | "ask"; id: string } {
  if (key === ASK) return { kind: "ask", id: "" };
  return { kind: key.startsWith("n:") ? "note" : "source", id: key.slice(2) };
}

export interface Pane { tabs: TabKey[]; active: TabKey | null }

export interface SessionLayout {
  panes: Pane[];
  /** The pane the user is in (blue underline; "here" for the picker). */
  focus: number;
  /** The note captures and AI results go to: the note last worked in. */
  target: string;
  /** Notes brought into this session besides its own. */
  notes: string[];
  /** Sources from other notes, opened here. */
  foreign: string[];
  /** Notes and sources lifted out of the panes into windows over them, the one in front last. */
  floating: TabKey[];
}

export function defaultLayout(home: string, sourceIds: string[]): SessionLayout {
  const panes: Pane[] = sourceIds.length
    ? [{ tabs: sourceIds.map(srcKey), active: srcKey(sourceIds[0]) },
       { tabs: [noteKey(home)], active: noteKey(home) }]
    : [{ tabs: [noteKey(home)], active: noteKey(home) }];
  return { panes, focus: panes.length - 1, target: home, notes: [], foreign: [], floating: [] };
}

export function paneOf(l: SessionLayout, key: TabKey): number {
  return l.panes.findIndex((p) => p.tabs.includes(key));
}

/** Drops empty panes and keeps focus and every pane's active tab valid. */
function tidy(l: SessionLayout): SessionLayout {
  const panes = l.panes
    .filter((p) => p.tabs.length > 0)
    .map((p) => ({ tabs: p.tabs, active: p.active && p.tabs.includes(p.active) ? p.active : p.tabs[0] }));
  const focus = Math.max(0, Math.min(l.focus, panes.length - 1));
  return { ...l, panes, focus };
}

function withTarget(l: SessionLayout, key: TabKey | null): SessionLayout {
  if (!key) return l;
  const k = parseKey(key);
  return k.kind === "note" ? { ...l, target: k.id } : l;
}

/** Make `key` the shown tab of pane `i`, and that pane the focused one. */
export function activate(l: SessionLayout, i: number, key: TabKey): SessionLayout {
  if (!l.panes[i]?.tabs.includes(key)) return l;
  const panes = l.panes.map((p, j) => (j === i ? { ...p, active: key } : p));
  return withTarget({ ...l, panes, focus: i }, key);
}

/** Focus pane `i` (a click inside it). A note shown there becomes the target. */
export function focusPane(l: SessionLayout, i: number): SessionLayout {
  if (!l.panes[i] || l.focus === i) return l;
  return withTarget({ ...l, focus: i }, l.panes[i].active);
}

/** The pane "beside" the focused one: a new pane when there is room, else the next one. */
function besideIndex(l: SessionLayout, maxPanes: number): number {
  if (l.panes.length < maxPanes) return l.panes.length;
  if (l.panes.length === 1) return 0;
  return (l.focus + 1) % l.panes.length;
}

/**
 * Open `key`. Already open somewhere: it is shown there (or moved to `where`
 * when a pane is asked for explicitly). `where`: a pane index, "here" (the
 * focused pane) or "beside".
 */
export function openTab(l: SessionLayout, key: TabKey, where: number | "here" | "beside", maxPanes: number): SessionLayout {
  // A floating tab is already in view; only an explicit pane puts it back.
  if (l.floating.includes(key)) return typeof where === "number" ? dockFloat(l, key, where, maxPanes) : focusFloat(l, key);
  const at = paneOf(l, key);
  if (at >= 0 && (where === "here" || where === "beside")) {
    if (where === "here" && at !== l.focus) return moveTab(l, key, l.focus, maxPanes);
    return activate(l, at, key);
  }
  const to = where === "here" ? l.focus : where === "beside" ? besideIndex(l, maxPanes) : where;
  if (at >= 0) return moveTab(l, key, to, maxPanes);
  const panes = l.panes.map((p) => ({ ...p, tabs: [...p.tabs] }));
  const idx = Math.min(to, panes.length, maxPanes - 1);
  if (!panes[idx]) panes.push({ tabs: [], active: null });
  panes[idx].tabs.push(key);
  panes[idx].active = key;
  return withTarget(tidy({ ...l, panes, focus: idx }), key);
}

/** Move a tab to pane `to` (an index one past the end makes a new pane, room permitting). */
export function moveTab(l: SessionLayout, key: TabKey, to: number, maxPanes: number): SessionLayout {
  const from = paneOf(l, key);
  if (from < 0) return l;
  const panes = l.panes.map((p) => ({ ...p, tabs: [...p.tabs] }));
  let dest = Math.min(to, panes.length, maxPanes - 1);
  if (dest === from && panes[from].tabs.length === 1) return activate(l, from, key);
  if (!panes[dest]) panes.push({ tabs: [], active: null });
  panes[from].tabs = panes[from].tabs.filter((t) => t !== key);
  if (panes[from].active === key) panes[from].active = panes[from].tabs[0] ?? null;
  panes[dest].tabs.push(key);
  panes[dest].active = key;
  // Removing an emptied pane before `dest` shifts it left.
  if (panes[from].tabs.length === 0 && from < dest) dest -= 1;
  return withTarget(tidy({ ...l, panes, focus: dest }), key);
}

/** ⇄ — to the next pane, or to a new one beside when this is the only pane. */
export function moveToOtherSide(l: SessionLayout, key: TabKey, maxPanes: number): SessionLayout {
  const from = paneOf(l, key);
  if (from < 0) return l;
  if (l.panes.length === 1) return maxPanes > 1 ? moveTab(l, key, 1, maxPanes) : l;
  return moveTab(l, key, from + 1 < l.panes.length ? from + 1 : from - 1, maxPanes);
}

/** Close a tab. It stays in the session (the picker lists it). A pane left empty goes away. */
export function closeTab(l: SessionLayout, key: TabKey): SessionLayout {
  if (l.floating.includes(key)) return retarget({ ...l, floating: l.floating.filter((f) => f !== key) }, key);
  const from = paneOf(l, key);
  if (from < 0) return l;
  const panes = l.panes.map((p, j) => {
    if (j !== from) return p;
    const idx = p.tabs.indexOf(key);
    const tabs = p.tabs.filter((t) => t !== key);
    // Show the neighbour, as a browser does.
    const active = p.active === key ? (tabs[Math.min(idx, tabs.length - 1)] ?? null) : p.active;
    return { tabs, active };
  });
  return retarget(tidy({ ...l, panes }), key);
}

/** The note `key` went away: writing moves to another open note, if there is one. */
function retarget(l: SessionLayout, key: TabKey): SessionLayout {
  const k = parseKey(key);
  if (k.kind !== "note" || l.target !== k.id) return l;
  const open = [...l.panes.flatMap((p) => p.tabs), ...l.floating];
  const other = open.map(parseKey).find((t) => t.kind === "note");
  // No note open: the target stays, and is reopened when something goes to it.
  return other ? { ...l, target: other.id } : l;
}

/** Can this tab float? A note or a source, and not the last tab in the panes (they'd be empty). */
export function canFloat(l: SessionLayout, key: TabKey): boolean {
  return parseKey(key).kind !== "ask" && paneOf(l, key) >= 0 && l.panes.flatMap((p) => p.tabs).length > 1;
}

/** Lift a tab out of its pane into a window, in front. With the limit reached,
 *  the oldest window takes the lifted tab's place in its pane. */
export function floatTab(l: SessionLayout, key: TabKey): SessionLayout {
  if (!canFloat(l, key)) return l;
  const from = paneOf(l, key);
  const full = l.floating.length >= MAX_FLOAT;
  const oldest = full ? l.floating[0] : null;
  const panes = l.panes.map((p, j) => {
    if (j !== from) return p;
    const idx = p.tabs.indexOf(key);
    const tabs = p.tabs.filter((t) => t !== key);
    if (oldest) tabs.splice(idx, 0, oldest);
    const active = p.active === key ? (oldest ?? tabs[Math.min(idx, tabs.length - 1)] ?? null) : p.active;
    return { tabs, active };
  });
  const floating = [...l.floating.filter((f) => f !== oldest), key];
  return withTarget(tidy({ ...l, panes, floating }), key);
}

/** Put a floating tab back as the shown tab of pane `to` (one past the end: a new pane). */
export function dockFloat(l: SessionLayout, key: TabKey, to: number, maxPanes: number): SessionLayout {
  if (!l.floating.includes(key)) return l;
  const panes = l.panes.map((p) => ({ ...p, tabs: [...p.tabs] }));
  const idx = Math.max(0, Math.min(to, panes.length, maxPanes - 1));
  if (!panes[idx]) panes.push({ tabs: [], active: null });
  panes[idx].tabs.push(key);
  panes[idx].active = key;
  return withTarget(tidy({ ...l, panes, focus: idx, floating: l.floating.filter((f) => f !== key) }), key);
}

/** A floating window was clicked: it comes to the front, and a note there is the one being written in. */
export function focusFloat(l: SessionLayout, key: TabKey): SessionLayout {
  if (!l.floating.includes(key)) return l;
  const inFront = l.floating[l.floating.length - 1] === key;
  const noted = parseKey(key).kind !== "note" || noteKey(l.target) === key;
  if (inFront && noted) return l;
  return withTarget({ ...l, floating: [...l.floating.filter((f) => f !== key), key] }, key);
}

/** A narrower window: panes past the limit fold into the last one that fits. */
export function fitPanes(l: SessionLayout, maxPanes: number): SessionLayout {
  if (l.panes.length <= maxPanes) return l;
  const keep = l.panes.slice(0, maxPanes).map((p) => ({ ...p, tabs: [...p.tabs] }));
  const last = keep[maxPanes - 1];
  for (const p of l.panes.slice(maxPanes)) last.tabs.push(...p.tabs.filter((t) => !last.tabs.includes(t)));
  return tidy({ ...l, panes: keep, focus: Math.min(l.focus, maxPanes - 1) });
}

/** Drop tabs whose thing no longer exists (a removed source, a trashed note). */
export function reconcile(l: SessionLayout, valid: (key: TabKey) => boolean, home: string): SessionLayout {
  const panes = l.panes.map((p) => ({ ...p, tabs: p.tabs.filter(valid) }));
  let next = tidy({ ...l, panes, floating: l.floating.filter(valid) });
  // Panes emptied under floating tabs: the first goes back into one.
  if (next.panes.length === 0 && next.floating.length) next = dockFloat(next, next.floating[0], 0, 1);
  if (next.panes.length === 0) next = { ...next, panes: [{ tabs: [noteKey(home)], active: noteKey(home) }], focus: 0 };
  if (!valid(noteKey(next.target))) next = { ...next, target: home };
  return next;
}

/** Restore a saved layout, or null when the stored value is not one. */
export function readLayout(raw: string | null): SessionLayout | null {
  try {
    const v = JSON.parse(raw ?? "null");
    if (!v || !Array.isArray(v.panes) || typeof v.target !== "string") return null;
    const panes: Pane[] = v.panes
      .filter((p: Pane) => p && Array.isArray(p.tabs))
      .map((p: Pane) => ({ tabs: p.tabs.filter((t) => typeof t === "string"), active: typeof p.active === "string" ? p.active : null }));
    return tidy({
      panes,
      focus: Number.isInteger(v.focus) ? v.focus : 0,
      target: v.target,
      notes: Array.isArray(v.notes) ? v.notes.filter((x: unknown) => typeof x === "string") : [],
      foreign: Array.isArray(v.foreign) ? v.foreign.filter((x: unknown) => typeof x === "string") : [],
      // A layout saved with one floating tab held a string.
      floating: (Array.isArray(v.floating) ? v.floating : typeof v.floating === "string" ? [v.floating] : [])
        .filter((f: unknown, i: number, all: unknown[]) =>
          typeof f === "string" && all.indexOf(f) === i && !panes.some((p) => p.tabs.includes(f)))
        .slice(-MAX_FLOAT),
    });
  } catch {
    return null;
  }
}
