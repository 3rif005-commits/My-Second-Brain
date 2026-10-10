"use client";

// One place that knows about Notion for the whole brain layout: the mirror map (sidebar dots, header
// chip), which items are multi-selected, and the one review panel any entry point can open.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  NOTION_CHANGED, notionApi, type ItemKind, type MirrorCode, type MirrorMap, type Scope,
} from "@/lib/notion";
import { SendToNotionPanel } from "@/components/notion/SendToNotionPanel";

export interface NotionCtx {
  connected: boolean;
  paused: boolean;
  mirror: MirrorMap | null;
  /** State of one note or folder, or null when it was never sent (no dot). */
  stateOf: (kind: "note" | "collection", id: string) => MirrorCode | null;
  refresh: () => void;
  open: (scope: Scope, title?: string) => void;
  selection: ReadonlySet<string>;
  isSelected: (kind: ItemKind, id: string) => boolean;
  toggleSelect: (kind: ItemKind, id: string) => void;
  clearSelection: () => void;
  sendSelection: () => void;
}

const NotionContext = createContext<NotionCtx>({
  connected: false, paused: false, mirror: null, stateOf: () => null, refresh: () => {}, open: () => {},
  selection: new Set(), isSelected: () => false, toggleSelect: () => {}, clearSelection: () => {}, sendSelection: () => {},
});

export function useNotion() {
  return useContext(NotionContext);
}

const key = (kind: ItemKind, id: string) => `${kind}:${id}`;

export function NotionProvider({ children }: { children: React.ReactNode }) {
  const [mirror, setMirror] = useState<MirrorMap | null>(null);
  const [panel, setPanel] = useState<{ scope: Scope; title?: string } | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const mounted = useRef(true);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(() => {
    notionApi.mirror().then((m) => { if (mounted.current) setMirror(m); }).catch(() => {});
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const on = () => refresh();
    window.addEventListener(NOTION_CHANGED, on);
    window.addEventListener("focus", on);
    return () => { mounted.current = false; window.removeEventListener(NOTION_CHANGED, on); window.removeEventListener("focus", on); };
  }, [refresh]);

  // The dots follow what you edit: a note changes the moment it is saved, so look again when you move around.
  useEffect(() => { refresh(); }, [pathname, refresh]);

  const stateOf = useCallback((kind: "note" | "collection", id: string) => {
    if (!mirror?.connected) return null;
    return (kind === "note" ? mirror.notes[id] : mirror.collections[id]) ?? null;
  }, [mirror]);

  const toggleSelect = useCallback((kind: ItemKind, id: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      const k = key(kind, id);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  const sendSelection = useCallback(() => {
    const scope: Scope = { note_ids: [], only_collection_ids: [], database_ids: [] };
    selection.forEach((k) => {
      const [kind, ...rest] = k.split(":");
      const id = rest.join(":");
      if (kind === "note") scope.note_ids!.push(id);
      else if (kind === "collection") scope.collection_ids = [...(scope.collection_ids ?? []), id];
      else if (kind === "database") scope.database_ids!.push(id);
    });
    setPanel({ scope, title: `${selection.size} selected` });
  }, [selection]);

  // ⌘⇧N: send the note you are looking at.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "n") {
        const m = pathname?.match(/^\/brain\/([0-9a-f-]{36})$/);
        if (m) { e.preventDefault(); setPanel({ scope: { note_ids: [m[1]] } }); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname]);

  const value = useMemo<NotionCtx>(() => ({
    connected: !!mirror?.connected, paused: !!mirror?.paused, mirror, stateOf, refresh,
    open: (scope, title) => setPanel({ scope, title }),
    selection, isSelected: (kind, id) => selection.has(key(kind, id)), toggleSelect,
    clearSelection: () => setSelection(new Set()), sendSelection,
  }), [mirror, stateOf, refresh, selection, toggleSelect, sendSelection]);

  return (
    <NotionContext.Provider value={value}>
      {children}
      {panel && (
        <SendToNotionPanel scope={panel.scope} title={panel.title}
          onClose={() => { setPanel(null); refresh(); }}
          onSent={() => { setSelection(new Set()); refresh(); }}
          onOpenSettings={() => { setPanel(null); router.push("/brain/settings/notion"); }} />
      )}
    </NotionContext.Provider>
  );
}
