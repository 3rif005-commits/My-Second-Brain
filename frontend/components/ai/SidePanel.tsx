"use client";

import { useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { Chat, type WorkspaceBinding } from "./Chat";
import { useAIThread } from "@/context/AIThreadContext";

interface SidePanelProps {
  open: boolean;
  onToggle: () => void;
  width?: number;
  onWidthChange?: (w: number) => void;
  /** Set on a workspace note: the panel works on that note. */
  workspace?: WorkspaceBinding;
  /** Bumped by ⌘K: focus the input. */
  focusNonce?: number;
  /** Text to put in the input (a new nonce each time). */
  prefill?: { text: string; nonce: number } | null;
  /** In a workspace session the panel never takes the window's edge: it sits
   *  over `dockEl` (the session's Ask tab) and is hidden while there is none. */
  docked?: boolean;
  dockEl?: HTMLElement | null;
}

/** The dock's box on screen, kept current as it resizes or the window does. */
function useDockRect(el: HTMLElement | null | undefined) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!el) { setRect(null); return; }
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect((prev) => (prev && prev.left === r.left && prev.top === r.top
        && prev.width === r.width && prev.height === r.height)
        ? prev : { left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The dock can move without resizing (the sidebar sliding in), so also follow
    // the page's own size and catch the end of any transition.
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    document.addEventListener("transitionend", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("transitionend", measure, true);
    };
  }, [el]);
  return rect;
}

export function SidePanel({ open, onToggle, width = 360, onWidthChange, workspace, focusNonce, prefill, docked, dockEl }: SidePanelProps) {
  const dockRect = useDockRect(docked ? dockEl : null);
  const shown = open && (!docked || dockRect !== null);
  const { activeThreadId, setActiveThreadId } = useAIThread();
  const startX = useRef(0);
  const startWidth = useRef(width);

  function onResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    startX.current = e.clientX;
    startWidth.current = width;

    function onMove(e: MouseEvent) {
      // Dragging LEFT increases panel width (panel is on the right)
      const delta = startX.current - e.clientX;
      onWidthChange?.(startWidth.current + delta);
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <>
      {/* Mobile backdrop */}
      {open && !docked && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={onToggle}
          aria-hidden
        />
      )}

      {/* Panel */}
      <div
        className={docked ? [
          // Over the session's Ask tab: no slide, no edge, the page's own surface.
          "fixed z-30 flex flex-col bg-surface",
          shown ? "visible" : "invisible",
        ].join(" ") : [
          "fixed inset-y-0 right-0 z-40 flex flex-col",
          // Distinct background: light lavender in light mode, deep blue-black in dark
          "bg-surface-chip dark:bg-surface-chip",
          "transition-[transform,visibility] duration-200 ease-in-out",
          // Invisible once slid away: still mounted, but out of reach of Tab
          // and of screen readers.
          open ? "translate-x-0 visible" : "translate-x-full invisible",
        ].join(" ")}
        style={docked
          ? (dockRect ? { left: dockRect.left, top: dockRect.top, width: dockRect.width, height: dockRect.height }
                      : { left: 0, top: 0, width: 0, height: 0 })
          : { width }}
        aria-label="AI assistant panel"
        role="complementary"
      >
        {/* Resize handle — desktop only, on the left edge */}
        {!docked && <div
          onMouseDown={onResizeStart}
          className="absolute left-0 inset-y-0 w-3 cursor-col-resize hidden md:flex items-center justify-center z-10 group"
        >
          {/* The actual visible line */}
          <div className="w-px h-full bg-accent-200/60 dark:bg-accent-900/40 group-hover:bg-accent-400 dark:group-hover:bg-accent-500 transition-colors duration-150" />
          {/* Drag grip dots — appear on hover */}
          <div className="absolute flex flex-col gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-[3px] h-[3px] rounded-full bg-accent-400 dark:bg-accent-500" />
            ))}
          </div>
        </div>}

        {/* Indigo gradient accent at the top */}
        {!docked && <div className="h-px w-full bg-line shrink-0" />}

        {/* Chat — stays mounted while closed, so a running job, its cards and
            the conversation survive closing and reopening the panel. */}
        <Chat
          threadId={activeThreadId}
          onThreadIdChange={setActiveThreadId}
          onClose={onToggle}
          workspace={workspace}
          focusNonce={focusNonce}
          prefill={prefill}
        />
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
