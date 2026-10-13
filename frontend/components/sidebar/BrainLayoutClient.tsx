"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { LAST_PAGE_KEY, rememberLastPage, rememberSettingsReturn } from "@/lib/settingsReturn";
import { useRouter } from "next/navigation";
import { usePreferences } from "@/app/providers";
import { createClient } from "@/lib/supabase/client";
import { PREFS_KEY, loadPreferences, type Preferences } from "@/lib/preferences";
import { Sidebar } from "./Sidebar";
import { Logo } from "@/components/brand/Logo";
import { SearchModal } from "@/components/search/SearchModal";
import { SidePanel, SidePanelToggleButton } from "@/components/ai/SidePanel";
import { AIThreadProvider } from "@/context/AIThreadContext";
import { NotionProvider } from "@/context/NotionContext";
import { AIPanelControlsContext, type AIPanelControls } from "@/context/AIPanelContext";
import type { WorkspaceBinding } from "@/components/ai/Chat";
import { IngestStreamDialog } from "@/components/ingestion/IngestStreamDialog";
import type { IngestSource } from "@/components/ingestion/IngestDropzone";

const AI_PANEL_DEFAULT_WIDTH = 360;
const AI_PANEL_MIN_WIDTH = 280;
const AI_PANEL_MAX_WIDTH = 600;
// Notion's sidebar: 270px by default, resizable by dragging its right edge.
const SIDEBAR_DEFAULT_WIDTH = 270;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;

function applySidebarWidth(px: number) {
  document.documentElement.style.setProperty("--sidebar-width", `${px}px`);
}

export function BrainLayoutClient({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [aiOpen, setAiOpen] = useState<boolean | null>(null);
  const [aiPanelWidth, setAiPanelWidth] = useState(AI_PANEL_DEFAULT_WIDTH);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [ingestSource, setIngestSource] = useState<IngestSource | null>(null);
  // One AI for the whole app (user decision, 2026-09-24): this layout mounts
  // the only AI panel. Every page — the workspace included — uses it; a
  // workspace note binds it to itself (AIPanelContext). ⌘J opens and focuses
  // it everywhere. The workspace owns file drops (they become sources), so
  // the app-wide drop-to-import steps aside there.
  const pathname = usePathname() ?? "";
  const inWorkspace = pathname.startsWith("/brain/workspace");
  // Preferences follow the account: on a device with none saved yet, adopt the
  // copy stored in the user's metadata (Settings → Preferences writes it).
  const { updatePreferences } = usePreferences();
  useEffect(() => {
    let hasLocal = false;
    try {
      hasLocal = !!localStorage.getItem(PREFS_KEY);
    } catch {
      // ignore
    }
    if (hasLocal) return;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        const remote = data.user?.user_metadata?.preferences as Partial<Preferences> | undefined;
        if (remote && typeof remote === "object") updatePreferences(remote);
      })
      .catch(() => {});
  }, [updatePreferences]);

  // "Open on start" (Settings → Preferences): the first time this tab lands on
  // Home, go to the last visited page instead when that is the user's choice.
  const router = useRouter();
  useEffect(() => {
    rememberLastPage(pathname);
    // Read storage directly: this runs before the provider has loaded preferences.
    if (pathname !== "/brain" || loadPreferences().startPage !== "last") return;
    try {
      if (sessionStorage.getItem("sb-started")) return;
      sessionStorage.setItem("sb-started", "1");
      const last = localStorage.getItem(LAST_PAGE_KEY);
      if (last) router.replace(last);
    } catch {
      // ignore
    }
  }, [pathname, router]);

  useEffect(() => {
    rememberSettingsReturn(pathname + (typeof window !== "undefined" ? window.location.search : ""));
  }, [pathname]);
  const inWorkspaceRef = useRef(inWorkspace);
  inWorkspaceRef.current = inWorkspace;
  const [workspaceBinding, setWorkspaceBinding] = useState<Omit<WorkspaceBinding, "focusNonce"> | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-open");
    setOpen(stored !== null ? stored === "true" : window.innerWidth >= 768);
    const sidebarWidth = parseInt(localStorage.getItem("sidebar-width") ?? "");
    if (sidebarWidth >= SIDEBAR_MIN_WIDTH && sidebarWidth <= SIDEBAR_MAX_WIDTH) applySidebarWidth(sidebarWidth);

    const aiStored = localStorage.getItem("ai-panel-open");
    let aiInitial = aiStored !== null ? aiStored === "true" : false;

    const widthStored = localStorage.getItem("ai-panel-width");
    if (widthStored) {
      const w = parseInt(widthStored);
      if (w >= AI_PANEL_MIN_WIDTH && w <= AI_PANEL_MAX_WIDTH) setAiPanelWidth(w);
    }

    // ?ai=open in URL → auto-open AI panel and strip the param
    const params = new URLSearchParams(window.location.search);
    if (params.get("ai") === "open") {
      aiInitial = true;
      params.delete("ai");
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname;
      window.history.replaceState(null, "", newUrl);
    }
    setAiOpen(aiInitial);

    // Track desktop vs mobile for the push-layout logic
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      // ⌘J: the AI panel. A toggle: open (cursor in the input), or close if it is
      // open. Closing only hides it, so the conversation is there when it opens again.
      if (mod && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (aiOpenRef.current) closeAi();
        else focusAi();
      }
      // ⌘K (Notion's quick find), and ⌘P kept for existing muscle memory.
      if (mod && !e.shiftKey && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "p")) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      // Ctrl/⌘+\ folds the sidebar, as in Notion.
      if (mod && e.key === "\\") {
        e.preventDefault();
        toggleRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      if (inWorkspaceRef.current) return;       // the workspace attaches it as a source
      // Dropped on the AI panel: it attaches the file to the conversation.
      if ((e.target as Element | null)?.closest?.("[data-ai-panel]")) return;
      const file = e.dataTransfer?.files?.[0];
      if (file) setIngestSource({ type: "file", file });
    }
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, []);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-open", String(next));
      return next;
    });
  }
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  // Drag the sidebar's right edge to resize it (12px hit area, shell.md §1).
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width")) || SIDEBAR_DEFAULT_WIDTH;
    let width = startWidth;
    function onMove(ev: PointerEvent) {
      width = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, startWidth + ev.clientX - startX));
      applySidebarWidth(width);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      localStorage.setItem("sidebar-width", String(width));
    }
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function toggleAi() {
    setAiOpen((prev) => {
      const next = !prev;
      localStorage.setItem("ai-panel-open", String(next));
      return next;
    });
  }

  const aiOpenRef = useRef(false);
  aiOpenRef.current = aiOpen ?? false;
  const closeAi = useCallback(() => {
    setAiOpen(false);
    localStorage.setItem("ai-panel-open", "false");
  }, []);
  const openAi = useCallback(() => {
    setAiOpen(true);
    localStorage.setItem("ai-panel-open", "true");
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const focusAi = useCallback(() => { openAi(); setFocusNonce(Date.now()); }, [openAi]);
  const askAi = useCallback((text: string) => {
    openAi();
    setPrefill({ text, nonce: Date.now() });
    setFocusNonce(Date.now());
  }, [openAi]);

  function handleAiWidthChange(width: number) {
    const clamped = Math.max(AI_PANEL_MIN_WIDTH, Math.min(AI_PANEL_MAX_WIDTH, Math.round(width)));
    setAiPanelWidth(clamped);
    localStorage.setItem("ai-panel-width", String(clamped));
  }

  const isOpen = open ?? true;
  const isAiOpen = aiOpen ?? false;

  const controls = useMemo<AIPanelControls>(() => ({
    isOpen: isAiOpen,
    width: isAiOpen && isDesktop ? aiPanelWidth : 0,
    open: openAi,
    toggle: toggleAi,
    focus: focusAi,
    ask: askAi,
    bindWorkspace: setWorkspaceBinding,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isAiOpen, isDesktop, aiPanelWidth, openAi, focusAi, askAi]);

  return (
    <AIThreadProvider>
    <NotionProvider>
    <AIPanelControlsContext.Provider value={controls}>
      <div className="print-layout flex h-screen overflow-hidden bg-surface">

        {/* Mobile backdrop for notes sidebar */}
        {isOpen && (
          <div
            className="no-print fixed inset-0 z-20 bg-surface-backdrop md:hidden"
            onClick={toggle}
          />
        )}

        {/* Notes sidebar */}
        <div
          className={[
            "no-print transition-[width,transform] duration-200 ease-in-out flex-shrink-0",
            "fixed inset-y-0 left-0 z-30",
            "md:relative md:inset-auto md:z-auto",
            isOpen
              ? "translate-x-0 md:w-[var(--sidebar-width)]"
              : "-translate-x-full md:translate-x-0 md:w-0",
          ].join(" ")}
          style={{ overflow: isOpen ? "visible" : "hidden" }}
        >
          <Sidebar onToggle={toggle} onSearchOpen={() => setSearchOpen(true)} />
          {isOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onPointerDown={startResize}
              onDoubleClick={() => { applySidebarWidth(SIDEBAR_DEFAULT_WIDTH); localStorage.removeItem("sidebar-width"); }}
              className="absolute inset-y-0 -right-1.5 z-10 hidden w-3 cursor-col-resize md:block after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-line-strong"
            />
          )}
        </div>

        {/* Desktop: floating reopen button for notes sidebar */}
        {!isOpen && (
          <Tooltip content="Lock sidebar open" shortcut="Ctrl+\" side="right" align="start">
            <button
              onClick={toggle}
              aria-label="Open sidebar"
              className="no-print fixed left-3 top-2.5 z-40 hidden size-6 items-center justify-center rounded-md text-ink-icon transition-colors hover:bg-surface-active md:flex"
            >
              <Menu size={18} />
            </button>
          </Tooltip>
        )}

        {/* Main area — shifts right on desktop when AI panel is open */}
        <main
          className="print-main group/shell flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden"
          data-sidebar={isOpen ? "open" : "collapsed"}
          style={{
            marginRight: isAiOpen && isDesktop ? aiPanelWidth : 0,
            transition: "margin-right 200ms ease-in-out",
          }}
        >
          {/* Mobile-only top bar */}
          <div className="no-print flex h-11 shrink-0 items-center gap-2 bg-surface px-3 md:hidden">
            <button
              onClick={toggle}
              aria-label="Open menu"
              className="flex size-7 items-center justify-center rounded-md text-ink-icon transition-colors hover:bg-surface-active"
            >
              <Menu size={20} />
            </button>
            <Logo size={20} className="shrink-0 rounded" />
            <span className="text-sm font-medium text-ink">My Second Brain</span>
          </div>

          {children}
        </main>

        {/* THE AI panel — fixed right, width matches content margin */}
        <SidePanel
          open={isAiOpen}
          onToggle={toggleAi}
          width={aiPanelWidth}
          onWidthChange={handleAiWidthChange}
          workspace={workspaceBinding && pathname.startsWith("/brain/workspace/")
            ? { ...workspaceBinding, focusNonce } : undefined}
          focusNonce={focusNonce}
          prefill={prefill}
        />

        {/* The AI button, bottom-right, while the panel is closed */}
        {!isAiOpen && <SidePanelToggleButton onClick={toggleAi} />}

        <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      </div>
      <IngestStreamDialog
        source={ingestSource}
        onClose={() => setIngestSource(null)}
      />
    </AIPanelControlsContext.Provider>
    </NotionProvider>
    </AIThreadProvider>
  );
}
