"use client";

import { useEffect, useRef, useState } from "react";
import { AppWindow, Bot, PanelBottom, PanelRight, Plus, X } from "lucide-react";
import { Chat, type WorkspaceBinding } from "./Chat";
import {
  NEW_TAB_TITLE, addTab, clampFloat, closePanelTab, freshTabs, patchTab, readPanelTabs, showTab,
  type DockSide, type FloatRect, type PanelTabs,
} from "./panelTabs";

const TABS_KEY = "ai-panel-tabs";

const DOCKS: { side: DockSide; label: string; icon: React.ReactNode }[] = [
  { side: "right", label: "Dock on the right", icon: <PanelRight size={14} /> },
  { side: "bottom", label: "Dock at the bottom", icon: <PanelBottom size={14} /> },
  { side: "float", label: "Float as a window", icon: <AppWindow size={14} /> },
];

/** Which edges a floating-window handle moves. */
type Edges = { n?: boolean; s?: boolean; e?: boolean; w?: boolean };
const FLOAT_HANDLES: { edges: Edges; className: string; cursor: string }[] = [
  { edges: { e: true }, className: "inset-y-3 -right-1 w-2", cursor: "ew-resize" },
  { edges: { w: true }, className: "inset-y-3 -left-1 w-2", cursor: "ew-resize" },
  { edges: { s: true }, className: "inset-x-3 -bottom-1 h-2", cursor: "ns-resize" },
  { edges: { n: true }, className: "inset-x-3 -top-1 h-2", cursor: "ns-resize" },
  { edges: { s: true, e: true }, className: "-bottom-1 -right-1 size-4", cursor: "nwse-resize" },
  { edges: { s: true, w: true }, className: "-bottom-1 -left-1 size-4", cursor: "nesw-resize" },
  { edges: { n: true, e: true }, className: "-top-1 -right-1 size-4", cursor: "nesw-resize" },
  { edges: { n: true, w: true }, className: "-top-1 -left-1 size-4", cursor: "nwse-resize" },
];

interface SidePanelProps {
  open: boolean;
  onToggle: () => void;
  /** Down the right edge (full height), or along the bottom under the page (full width). */
  side?: DockSide;
  onSideChange?: (side: DockSide) => void;
  width?: number;
  onWidthChange?: (w: number) => void;
  height?: number;
  onHeightChange?: (h: number) => void;
  /** At the bottom: where the panel starts, so it sits under the page, not the sidebar. */
  left?: string | number;
  /** Floating: where the window is and how big. */
  floatRect?: FloatRect;
  onFloatRectChange?: (r: FloatRect) => void;
  /** Set on a workspace note: the panel works on that note. */
  workspace?: WorkspaceBinding;
  /** Bumped by ⌘K: focus the input. */
  focusNonce?: number;
  /** Text to put in the input (a new nonce each time). */
  prefill?: { text: string; nonce: number } | null;
}

/** Conversation tabs, as this device left them. */
function usePanelTabs() {
  const [state, setState] = useState<PanelTabs>(freshTabs);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const saved = readPanelTabs(window.localStorage.getItem(TABS_KEY));
      if (saved) setState(saved);
    } catch { /* private mode */ }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try { window.localStorage.setItem(TABS_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }, [state]);
  return [state, setState] as const;
}

export function SidePanel({
  open, onToggle, side = "right", onSideChange, width = 360, onWidthChange, height = 320,
  onHeightChange, left = 0, floatRect, onFloatRectChange, workspace, focusNonce, prefill,
}: SidePanelProps) {
  const [tabs, setTabs] = usePanelTabs();
  const bottom = side === "bottom";
  const float = side === "float" && !!floatRect;

  // A job asked for from the editor and text handed in ("Ask AI" on a selection)
  // go to the tab shown when they arrive, and only to it: every tab is a live Chat.
  const requestOwner = useRef<{ nonce: number; tab: string } | null>(null);
  const request = workspace?.request ?? null;
  if (request && requestOwner.current?.nonce !== request.nonce) {
    requestOwner.current = { nonce: request.nonce, tab: tabs.active };
  }
  const prefillOwner = useRef<{ nonce: number; tab: string } | null>(null);
  if (prefill && prefillOwner.current?.nonce !== prefill.nonce) {
    prefillOwner.current = { nonce: prefill.nonce, tab: tabs.active };
  }

  function onResizeStart(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startW = width, startH = height;
    function onMove(ev: PointerEvent) {
      // The panel grows away from its edge: left for the right dock, up for the bottom one.
      if (bottom) onHeightChange?.(startH + startY - ev.clientY);
      else onWidthChange?.(startW + startX - ev.clientX);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = bottom ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /** Floating: drag the tab bar to move the window, or a handle to move those edges. */
  function onFloatPointerDown(e: React.PointerEvent, edges: Edges | "move") {
    if (!floatRect || e.button !== 0) return;
    if (edges === "move" && (e.target as Element).closest("button, [role=tab]")) return;
    e.preventDefault();
    const start = floatRect, x0 = e.clientX, y0 = e.clientY;
    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      let { left: l, top: t, width: w, height: h } = start;
      if (edges === "move") { l += dx; t += dy; }
      else {
        // Moving the left or top edge keeps the opposite edge still.
        if (edges.e) w += dx;
        if (edges.s) h += dy;
        if (edges.w) { w = Math.max(300, w - dx); l = start.left + start.width - w; }
        if (edges.n) { h = Math.max(240, h - dy); t = start.top + start.height - h; }
      }
      onFloatRectChange?.(clampFloat({ left: l, top: t, width: w, height: h }, window.innerWidth, window.innerHeight));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = edges === "move" ? "grabbing"
      : FLOAT_HANDLES.find((hd) => hd.edges === edges)?.cursor ?? "";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const iconBtn = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-icon hover:bg-surface-hover hover:text-ink transition-colors";

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={onToggle} aria-hidden />
      )}

      <div
        className={float ? [
          // Over the page, where you put it; the page keeps its full size.
          "fixed z-40 flex flex-col overflow-hidden rounded-xl border border-line bg-surface-chip shadow-float",
          "transition-[opacity,visibility] duration-150",
          open ? "visible opacity-100" : "invisible opacity-0",
        ].join(" ") : [
          "fixed z-40 flex flex-col bg-surface-chip",
          bottom ? "bottom-0 right-0 border-t border-line" : "inset-y-0 right-0",
          "transition-[transform,visibility,left] duration-200 ease-in-out",
          // Invisible once slid away: still mounted, but out of reach of Tab
          // and of screen readers.
          open ? "translate-x-0 translate-y-0 visible"
            : bottom ? "translate-y-full invisible" : "translate-x-full invisible",
        ].join(" ")}
        style={float ? floatRect : bottom ? { left, height } : { width }}
        aria-label="AI assistant panel"
        role="complementary"
      >
        {/* Floating: every edge and corner resizes */}
        {float && FLOAT_HANDLES.map((hd, i) => (
          <div
            key={i}
            aria-hidden
            onPointerDown={(e) => onFloatPointerDown(e, hd.edges)}
            className={`absolute z-20 ${hd.className}`}
            style={{ cursor: hd.cursor }}
          />
        ))}

        {/* Docked: a resize handle on the edge facing the page — desktop only */}
        {!float && <div
          role="separator"
          aria-orientation={bottom ? "horizontal" : "vertical"}
          aria-label="Resize the AI panel"
          onPointerDown={onResizeStart}
          className={[
            "absolute z-10 hidden md:flex items-center justify-center group",
            bottom ? "inset-x-0 -top-1.5 h-3 cursor-row-resize" : "inset-y-0 left-0 w-3 cursor-col-resize",
          ].join(" ")}
        >
          <div className={`${bottom ? "h-px w-full" : "w-px h-full"} bg-accent-200/60 dark:bg-accent-900/40 group-hover:bg-accent-400 dark:group-hover:bg-accent-500 transition-colors duration-150`} />
        </div>}

        {/* Conversation tabs */}
        <div
          onPointerDown={float ? (e) => onFloatPointerDown(e, "move") : undefined}
          onDoubleClick={float ? (e) => { if (!(e.target as Element).closest("button, [role=tab]")) onSideChange?.("right"); } : undefined}
          title={float ? "Drag to move · double-click to dock" : undefined}
          className={`flex h-9 shrink-0 items-center gap-0.5 border-b border-line pl-2 pr-1 ${float ? "cursor-grab" : ""}`}
        >
          <div role="tablist" aria-label="Conversations" className="ws-scroll-x flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {tabs.tabs.map((t) => {
              const shown = t.id === tabs.active;
              return (
                <div
                  key={t.id}
                  role="tab"
                  aria-selected={shown}
                  tabIndex={0}
                  title={t.title}
                  onClick={() => setTabs((s) => showTab(s, t.id))}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setTabs((s) => showTab(s, t.id)); }}
                  onAuxClick={(e) => { if (e.button === 1) setTabs((s) => closePanelTab(s, t.id)); }}
                  className={[
                    "group/tab flex h-7 min-w-[72px] max-w-[180px] shrink cursor-pointer items-center gap-1 rounded-md pl-2 pr-0.5 text-xs",
                    shown ? "bg-surface text-ink shadow-sm" : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
                  ].join(" ")}
                >
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <button
                    type="button"
                    aria-label={`Close ${t.title}`}
                    onClick={(e) => { e.stopPropagation(); setTabs((s) => closePanelTab(s, t.id)); }}
                    className={`flex size-5 shrink-0 items-center justify-center rounded text-ink-icon hover:bg-surface-active hover:text-ink ${shown ? "" : "opacity-0 group-hover/tab:opacity-100"}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => setTabs(addTab)} aria-label="New chat tab" title="New chat tab" className={iconBtn}>
            <Plus size={15} />
          </button>
          {onSideChange && (
            <div role="group" aria-label="Where the AI panel sits" className="mx-0.5 hidden items-center rounded-md bg-surface-hover/60 p-0.5 md:flex">
              {DOCKS.map((d) => (
                <button
                  key={d.side}
                  type="button"
                  onClick={() => onSideChange(d.side)}
                  aria-label={d.label}
                  aria-pressed={side === d.side}
                  title={d.label}
                  className={`flex size-6 items-center justify-center rounded transition-colors ${side === d.side
                    ? "bg-surface text-ink shadow-sm" : "text-ink-icon hover:text-ink"}`}
                >
                  {d.icon}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={onToggle} aria-label="Close AI panel" title="Close (Ctrl+J)" className={iconBtn}>
            <X size={15} />
          </button>
        </div>

        {/* Every tab's Chat stays mounted while closed or hidden, so a running job,
            its cards and the conversation survive switching tabs and closing the panel. */}
        <div className="relative min-h-0 flex-1">
          {tabs.tabs.map((t) => {
            const shown = t.id === tabs.active;
            return (
              <div key={t.id} className={shown ? "absolute inset-0 flex flex-col" : "hidden"}>
                <Chat
                  threadId={t.threadId}
                  onThreadIdChange={(id) => setTabs((s) => patchTab(s, t.id, { threadId: id }))}
                  onTitle={(title) => setTabs((s) => patchTab(s, t.id, { title: title.trim() || NEW_TAB_TITLE }))}
                  active={open && shown}
                  workspace={workspace && {
                    ...workspace,
                    request: requestOwner.current?.tab === t.id ? request : null,
                  }}
                  focusNonce={shown ? focusNonce : undefined}
                  prefill={prefillOwner.current?.tab === t.id ? prefill : null}
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** The AI button while the panel is closed — bottom-right, on every page,
 *  like Notion AI's. An app-wide control, so it lives apart from the page's
 *  own actions at the top (user decision, 2026-09-24). */
export function SidePanelToggleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open AI panel"
      title="Ask AI (⌘J)"
      className="no-print fixed bottom-4 right-4 z-30 flex size-10 items-center justify-center rounded-full
        bg-surface-elevated text-ink shadow-float hover:bg-surface-sidebar active:scale-95
        transition-[background,transform] duration-instant"
    >
      <Bot size={20} />
    </button>
  );
}
