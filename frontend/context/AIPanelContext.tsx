"use client";

// The one AI panel (user decision, 2026-09-24): a single panel, mounted once
// by the app layout, is the AI on every page — the workspace included. A page
// does not draw its own; it tells this panel what it is showing.
//
// Two contexts on purpose: pages use the stable controls (open, focus, bind)
// without re-rendering whenever the bound workspace changes, and only the
// panel reads the binding.
import { createContext, useContext } from "react";
import type { WorkspaceBinding } from "@/components/ai/Chat";

export interface AIPanelControls {
  isOpen: boolean;
  /** The panel's width while open on desktop (0 when closed or mobile). */
  width: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Open the panel and put the cursor in its input. */
  focus: () => void;
  /** Open the panel with this text in its input, ready to send or edit —
   *  "Try it" in Settings → Skills; anything that wants to hand the AI a
   *  starting point. */
  ask: (text: string) => void;
  /** A workspace note binds the panel to itself; null when it unmounts. */
  bindWorkspace: (b: Omit<WorkspaceBinding, "focusNonce"> | null) => void;
  /** The workspace's Ask tab: while an element is given, the panel sits exactly
   *  over it instead of at the window's edge. Still the same, always-mounted
   *  panel, so a running job and the conversation survive switching tabs. */
  dock: (el: HTMLElement | null) => void;
}

const noop = () => {};
export const AIPanelControlsContext = createContext<AIPanelControls>({
  isOpen: false, width: 0, open: noop, close: noop, toggle: noop, focus: noop, ask: noop,
  bindWorkspace: noop, dock: noop,
});

export function useAIPanel(): AIPanelControls {
  return useContext(AIPanelControlsContext);
}
