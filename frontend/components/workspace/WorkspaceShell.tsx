"use client";

// The compact workspace shell: one note, the sources attached to it, and every
// tool that acts on them — in one tight layout. Left column = source rail +
// viewer (resizable, remembered); right column = the note in the ordinary block
// editor; chat is a drawer over the note, never a third column.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { useToast } from "@/app/providers";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { wsApi, type Citation, type NoteSource, type SendAction } from "@/lib/workspace";
import { DropZone } from "./DropZone";
import { NotePane, type NoteApplyApi, type NoteData } from "./NotePane";
import { SourceRail } from "./SourceRail";
import { SourceViewer } from "./SourceViewer";
import { useSynthesis } from "./useSynthesis";
import { WorkspaceChat } from "./WorkspaceChat";

const SPLIT_KEY = "workspace:splitPct";

interface WorkspaceShellProps {
  noteId: string | null;
}

export function WorkspaceShell({ noteId }: WorkspaceShellProps) {
  const router = useRouter();
  const search = useSearchParams();
  const { showToast } = useToast();

  const [note, setNote] = useState<NoteData | null>(null);
  const [sources, setSources] = useState<NoteSource[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [splitPct, setSplitPct] = useState(45);

  const seekRef = useRef<((value: number) => void) | null>(null);
  const actionSinkRef = useRef<((a: SendAction) => void) | null>(null);
  const positionSinkRef = useRef<((value: number) => void) | null>(null);
  const applyRef = useRef<NoteApplyApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const syn = useSynthesis({ noteId, sources, applyRef });

  // ── load ──────────────────────────────────────────────────────────────────
  const loadSources = useCallback(async () => {
    if (!noteId) return;
    const rows = await wsApi.listSources(noteId).catch(() => null);
    if (rows) setSources(rows);
  }, [noteId]);

  useEffect(() => {
    if (!noteId) { setNote(null); setSources([]); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/notes/${noteId}`);
      if (!res.ok || cancelled) return;
      const n = await res.json();
      setNote({ id: n.id, title: n.title ?? "Untitled", content: n.content ?? [] });
    })();
    loadSources();
    return () => { cancelled = true; };
  }, [noteId, loadSources]);

  // poll while any source is still working
  const pending = sources.some((s) => s.status === "queued" || s.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(loadSources, 2000);
    return () => clearInterval(timer);
  }, [pending, loadSources]);

  // pick a sensible active source
  useEffect(() => {
    if (activeId && sources.some((s) => s.id === activeId)) return;
    const firstReady = sources.find((s) => s.status === "ready") ?? sources[0];
    setActiveId(firstReady?.id ?? null);
  }, [sources, activeId]);

  // the note's title can be upgraded server-side when the draft lands
  useEffect(() => {
    if (!noteId || syn.synthesis?.status !== "ready") return;
    fetch(`/api/notes/${noteId}`).then((r) => r.ok ? r.json() : null).then((n) => {
      if (n?.title) setNote((prev) => prev ? { ...prev, title: n.title } : prev);
    }).catch(() => {});
  }, [noteId, syn.synthesis?.status]);

  // ── split divider ─────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(SPLIT_KEY));
    if (stored >= 25 && stored <= 70) setSplitPct(stored);
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const box = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - box.left) / box.width) * 100;
      setSplitPct(Math.min(70, Math.max(25, pct)));
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      setSplitPct((p) => { window.localStorage.setItem(SPLIT_KEY, String(Math.round(p))); return p; });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ── add / remove sources ──────────────────────────────────────────────────
  const addInputs = useCallback(async (
    items: { file?: File; url?: string }[]
  ) => {
    setBusy(true);
    const defer = items.length > 1;
    let landed = noteId;
    for (const item of items) {
      try {
        const r = await wsApi.addSource({ ...item, noteId: landed, defer });
        landed = r.note_id;
      } catch (e) {
        showToast(e instanceof Error ? e.message
          : `Could not add ${item.file?.name ?? item.url ?? "source"}`);
      }
    }
    // Deferred attaches are inert until this call, which is what makes a
    // three-file drop produce one synthesis across all three.
    if (defer && landed) await wsApi.processSources(landed).catch(() => {});
    setBusy(false);
    if (!noteId && landed) router.replace(`/brain/workspace/${landed}`);
    else await loadSources();
  }, [noteId, router, loadSources, showToast]);

  const addFiles = useCallback((files: File[]) =>
    addInputs(files.map((file) => ({ file }))), [addInputs]);
  const addUrl = useCallback((url: string) =>
    addInputs([{ url }]), [addInputs]);

  const removeSource = useCallback(async (s: NoteSource) => {
    await wsApi.deleteSource(s.id).catch((e) =>
      showToast(e instanceof Error ? e.message : "Could not remove that source"));
    if (activeId === s.id) setActiveId(null);
    await loadSources();
  }, [activeId, loadSources, showToast]);

  const retrySource = useCallback(async (s: NoteSource) => {
    await wsApi.reprocessSource(s.id).catch(() => {});
    await loadSources();
  }, [loadSources]);

  // ── whole-shell drag & drop ───────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) { addFiles(files); return; }
    const text = e.dataTransfer.getData("text/uri-list")
      || e.dataTransfer.getData("text/plain");
    if (text?.startsWith("http")) addUrl(text.trim());
  }, [addFiles, addUrl]);

  // ── deep link: ?source=<id>&t=|p=|s= ──────────────────────────────────────
  const deepLink = useMemo(() => {
    const sid = search.get("source");
    if (!sid) return null;
    const t = search.get("t"), p = search.get("p"), s = search.get("s");
    const raw = t ?? p ?? s;
    return { sid, value: raw !== null ? parseFloat(raw) : null };
  }, [search]);

  const deepLinkKey = deepLink ? `${deepLink.sid}:${deepLink.value ?? ""}` : null;
  const handledDeepLink = useRef<string | null>(null);

  useEffect(() => {
    if (!deepLink || !deepLinkKey || handledDeepLink.current === deepLinkKey) return;
    if (!sources.some((s) => s.id === deepLink.sid)) return;
    handledDeepLink.current = deepLinkKey;
    if (deepLink.sid !== activeId) seekRef.current = null;
    setActiveId(deepLink.sid);
    if (deepLink.value === null || Number.isNaN(deepLink.value)) return;
    const timer = setInterval(() => {
      if (seekRef.current) {
        seekRef.current(deepLink.value as number);
        clearInterval(timer);
      }
    }, 300);
    const stop = setTimeout(() => clearInterval(timer), 15000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [deepLink, deepLinkKey, sources, activeId]);

  // Switching sources swaps the viewer, and the outgoing viewer's seek function
  // is still in the ref at that instant — so a naive setActiveId-then-seek either
  // seeks the pane that is unmounting or is lost. Clear the ref at the switch and
  // wait for the incoming viewer to register its own.
  const seekWhenReady = useCallback((value: number) => {
    if (seekRef.current) { seekRef.current(value); return; }
    const timer = setInterval(() => {
      if (seekRef.current) { seekRef.current(value); clearInterval(timer); }
    }, 200);
    setTimeout(() => clearInterval(timer), 8000);
  }, []);

  const selectAndSeek = useCallback((sourceId: string, value: number) => {
    if (sourceId !== activeId) {
      seekRef.current = null;
      setActiveId(sourceId);
    }
    seekWhenReady(value);
  }, [activeId, seekWhenReady]);

  const handleCitation = useCallback((c: Citation) => {
    selectAndSeek(c.resource_id, c.anchor_start);
  }, [selectAndSeek]);

  // ── title ─────────────────────────────────────────────────────────────────
  async function saveTitle() {
    const next = (titleDraft ?? "").trim();
    setTitleDraft(null);
    if (!note || !next || next === note.title) return;
    setNote({ ...note, title: next });
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    }).catch(() => {});
  }

  const activeSource = sources.find((s) => s.id === activeId) ?? null;
  const colorIndex = useMemo(
    () => new Map(sources.map((s) => [s.id, s.order_index])), [sources]);

  // ── empty shell ───────────────────────────────────────────────────────────
  if (!noteId || !note) {
    return (
      <div
        className={`h-full ${dragOver ? "ring-2 ring-inset ring-indigo-400" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {noteId ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            Loading session…
          </div>
        ) : (
          <DropZone onAddFiles={addFiles} onAddUrl={addUrl} busy={busy} />
        )}
      </div>
    );
  }

  return (
    <div
      className={`h-full flex flex-col bg-white dark:bg-gray-900 ${
        dragOver ? "ring-2 ring-inset ring-indigo-400" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <button
          onClick={() => router.push("/brain/workspace")}
          title="New session"
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <ArrowLeft size={15} />
        </button>
        {titleDraft !== null ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); }}
            className="text-sm font-semibold bg-transparent border-b border-indigo-400 outline-none text-gray-900 dark:text-gray-100 min-w-0 flex-1"
          />
        ) : (
          <button
            onClick={() => setTitleDraft(note.title)}
            title="Rename this note"
            className="text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-indigo-600 truncate"
          >
            {note.title}
          </button>
        )}
        <span className="text-[11px] text-gray-400 shrink-0">
          {sources.length} source{sources.length === 1 ? "" : "s"}
        </span>
        <span className="text-[11px] text-gray-400 shrink-0 ml-auto">
          {saving ? "Saving…" : syn.running ? "Writing the note…" : ""}
        </span>
        <button
          onClick={syn.requestSynthesis}
          disabled={syn.running || syn.readyCount === 0}
          title="Rewrite the note from the current sources"
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors disabled:opacity-40 ${
            syn.stale
              ? "border-indigo-300 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
              : "border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          <RefreshCw size={11} className={syn.running ? "animate-spin" : ""} />
          {syn.stale ? `Re-synthesize (${syn.readyCount} sources)` : "Re-synthesize"}
        </button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          title="Ask about these sources"
          className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            chatOpen
              ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300"
              : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          <MessageSquare size={14} />
        </button>
        <a
          href={`/brain/${note.id}`}
          title="Open this note on its own page"
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* synthesis failure banner */}
      {syn.synthesis?.status === "failed" && syn.synthesis.error && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border-b border-amber-200 dark:border-amber-900 shrink-0">
          <span className="flex-1 min-w-0 truncate">
            Couldn’t write the note: {syn.synthesis.error}
          </span>
          <button onClick={syn.requestSynthesis} className="underline shrink-0">Retry</button>
          <button onClick={syn.dismissError} className="shrink-0">✕</button>
        </div>
      )}

      {/* body */}
      <div ref={containerRef} className="flex-1 min-h-0 flex">
        <div className="flex flex-col min-w-0 border-r border-gray-200 dark:border-gray-800"
             style={{ width: `${splitPct}%` }}>
          <SourceRail
            sources={sources}
            activeId={activeId}
            onSelect={setActiveId}
            onAddFiles={addFiles}
            onAddUrl={addUrl}
            onRemove={removeSource}
            onRetry={retrySource}
            busy={busy}
          />
          <div className="flex-1 min-h-0 flex flex-col">
            <SourceViewer
              source={activeSource}
              onPosition={(v) => positionSinkRef.current?.(v)}
              onAction={(a) => actionSinkRef.current?.(a)}
              seekRef={seekRef}
            />
          </div>
        </div>

        <div
          onMouseDown={() => { draggingRef.current = true; document.body.style.cursor = "col-resize"; }}
          className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-indigo-300 dark:hover:bg-indigo-700 transition-colors"
          title="Drag to resize"
        />

        <div className="relative flex-1 min-w-0">
          <NotePane
            note={note}
            sources={sources}
            activeSourceId={activeId}
            onJump={selectAndSeek}
            actionSinkRef={actionSinkRef}
            positionSinkRef={positionSinkRef}
            applyRef={applyRef}
            onApplied={() => {}}
            onSavingChange={setSaving}
          />
          {chatOpen && (
            <WorkspaceChat
              noteId={note.id}
              colorIndex={colorIndex}
              onCitation={handleCitation}
              onClose={() => setChatOpen(false)}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={syn.askMode}
        title="This note has your own edits in it"
        description="Replace everything with the new draft, or keep what you wrote and add the new draft at the end? Dismissing this keeps your note."
        confirmLabel="Replace everything"
        cancelLabel="Keep my note, add at the end"
        danger
        onConfirm={() => syn.chooseMode("replace")}
        onCancel={() => syn.chooseMode("append")}
      />
    </div>
  );
}
