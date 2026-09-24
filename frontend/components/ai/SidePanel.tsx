"use client";

import { useRef } from "react";
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
}

export function SidePanel({ open, onToggle, width = 360, onWidthChange, workspace, focusNonce, prefill }: SidePanelProps) {
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
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={onToggle}
          aria-hidden
        />
      )}

      {/* Panel */}
      <div
        className={[
          "fixed inset-y-0 right-0 z-40 flex flex-col",
          // Distinct background: light lavender in light mode, deep blue-black in dark
          "bg-[#eeeefc] dark:bg-[#0f0f1a]",
          "transition-[transform,visibility] duration-200 ease-in-out",
          // Invisible once slid away: still mounted, but out of reach of Tab
          // and of screen readers.
          open ? "translate-x-0 visible" : "translate-x-full invisible",
        ].join(" ")}
        style={{ width }}
        aria-label="AI assistant panel"
        role="complementary"
      >
        {/* Resize handle — desktop only, on the left edge */}
        <div
          onMouseDown={onResizeStart}
          className="absolute left-0 inset-y-0 w-3 cursor-col-resize hidden md:flex items-center justify-center z-10 group"
        >
          {/* The actual visible line */}
          <div className="w-px h-full bg-indigo-200/60 dark:bg-indigo-900/40 group-hover:bg-indigo-400 dark:group-hover:bg-indigo-500 transition-colors duration-150" />
          {/* Drag grip dots — appear on hover */}
          <div className="absolute flex flex-col gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-[3px] h-[3px] rounded-full bg-indigo-400 dark:bg-indigo-500" />
            ))}
          </div>
        </div>

        {/* Indigo gradient accent at the top */}
        <div className="h-[3px] w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-400 shrink-0" />

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
      title="Ask AI (⌘K)"
      className="no-print fixed bottom-5 right-5 z-30 flex items-center justify-center w-11 h-11 rounded-full
        bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-indigo-500
        shadow-lg shadow-indigo-500/10 hover:shadow-xl hover:scale-105 active:scale-95
        transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <Bot size={20} />
    </button>
  );
}
