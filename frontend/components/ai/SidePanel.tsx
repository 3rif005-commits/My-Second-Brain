"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, PanelBottom, PanelRight, Plus, X } from "lucide-react";
import { Chat, type WorkspaceBinding } from "./Chat";
import {
  NEW_TAB_TITLE, addTab, closePanelTab, freshTabs, patchTab, readPanelTabs, showTab,
  type DockSide, type PanelTabs,
} from "./panelTabs";

const TABS_KEY = "ai-panel-tabs";

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
  onHeightChange, left = 0, workspace, focusNonce, prefill,
}: SidePanelProps) {
  const [tabs, setTabs] = usePanelTabs();
  const bottom = side === "bottom";

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

  const iconBtn = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-icon hover:bg-surface-hover hover:text-ink transition-colors";

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={onToggle} aria-hidden />
      )}

      <div
        className={[
          "fixed z-40 flex flex-col bg-surface-chip",
          bottom ? "bottom-0 right-0 border-t border-line" : "inset-y-0 right-0",
          "transition-[transform,visibility,left] duration-200 ease-in-out",
          // Invisible once slid away: still mounted, but out of reach of Tab
          // and of screen readers.
          open ? "translate-x-0 translate-y-0 visible"
            : bottom ? "translate-y-full invisible" : "translate-x-full invisible",
        ].join(" ")}
        style={bottom ? { left, height } : { width }}
        aria-label="AI assistant panel"
        role="complementary"
      >
        {/* Resize handle on the edge facing the page — desktop only */}
        <div
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
        </div>

        {/* Conversation tabs */}
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line pl-2 pr-1">
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
            <button
              type="button"
              onClick={() => onSideChange(bottom ? "right" : "bottom")}
              aria-label={bottom ? "Dock on the right" : "Dock at the bottom"}
              title={bottom ? "Dock on the right" : "Dock at the bottom"}
              className={`${iconBtn} hidden md:flex`}
            >
              {bottom ? <PanelRight size={15} /> : <PanelBottom size={15} />}
            </button>
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
