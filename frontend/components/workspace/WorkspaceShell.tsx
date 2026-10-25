"use client";

// The workspace: three panels side by side — the sources, the note, and the AI
// (user decision, 2026-09-24). Sources and AI each collapse to a thin bar and
// resize by dragging; the note is always there. Jobs (study guide, flashcards,
// compare sources…) run from the AI panel as /commands or by asking; their
// results are previewed there and reach the note only on Insert / Replace.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Check, FileText, Link2, Pencil, PenLine, Sparkles, Upload,
} from "lucide-react";
import { Button, Tabs } from "@/components/ui";
import { useToast } from "@/app/providers";
import { formatElapsed, jobTitle, sourceColor, takeStagedSources, wsApi, type Citation, type NoteSource, type SendAction } from "@/lib/workspace";
import type { ChatJob, JobRequest } from "@/lib/chatJobs";
import { DropZone } from "./DropZone";
import { NotePane, type NoteApplyApi, type NoteData } from "./NotePane";
import { SourceTabs } from "./SourceTabs";
import { NoteStarters, SessionMenu } from "./SessionChrome";
import { SourceViewer } from "./SourceViewer";
import type { Passage } from "./viewers/passageMarks";
import { useSynthesis } from "./useSynthesis";
import { useAIPanel } from "@/context/AIPanelContext";
import { DRAFT_EVENT, UNDO_EVENT, type NoteDraft, type UndoOutcome } from "@/lib/noteDraft";

const SPLIT_KEY = "workspace:splitPct";
/** Below this the source and the note can't both be read side by side. */
const TWO_PANE_MIN = 700;
/** From here the note and the AI fit side by side next to the source. */
const WIDE_MIN = 1180;
const ASK_WIDTH = 360;
type Layout = "one" | "two" | "wide";

interface WorkspaceShellProps {
  noteId: string | null;
}

/** What the shell is doing right now, in the header's meta line. */
function StatusNote({ saving, saved, synthesizing, job, startedAt }: {
  saving: boolean; saved: boolean; synthesizing: boolean;
  /** The skill this page started; null = the study guide or unknown. */
  job?: string | null;
  startedAt?: string | null;
}) {
  // Which job, and for how long: a two-minute run with a bare spinner reads
  // as hung, and "Writing the note…" was shown for every job alike.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!synthesizing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [synthesizing]);
  if (synthesizing) {
    const elapsed = formatElapsed(startedAt ? now - Date.parse(startedAt) : null);
    const label = job && job !== "study-guide" ? `${jobTitle(job)}…` : "Writing the note…";
    return (
      <span className="flex items-center gap-1 shrink-0 text-accent-500 dark:text-accent-400">
        <span className="text-gray-300 dark:text-gray-700">·</span>
        <Sparkles size={10} className="animate-pulse" />
        <span className="ws-shimmer font-medium">{label}</span>
        {elapsed && <span className="tabular-nums text-accent-400/80">{elapsed}</span>}
      </span>
    );
  }
  if (saving) {
    return (
      <span className="flex items-center gap-1 shrink-0">
        <span className="text-gray-300 dark:text-gray-700">·</span>
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Saving…
      </span>
    );
  }
  if (saved) {
    return (
      <span className="flex items-center gap-1 shrink-0 text-emerald-500">
        <span className="text-gray-300 dark:text-gray-700">·</span>
        <Check size={11} /> Saved
      </span>
    );
  }
  return null;
}

/** Full-bleed invitation shown while something is being dragged over the shell. */
function DropOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="ws-rise pointer-events-none absolute inset-0 z-50 flex items-center justify-center
      bg-accent-500/[0.06] backdrop-blur-[2px] p-6">
      <div className="ws-glass flex flex-col items-center gap-1.5 px-10 py-8 rounded-3xl
        !border-2 !border-dashed !border-accent-400/70">
        <span className="ws-accent w-12 h-12 rounded-2xl flex items-center justify-center mb-1">
          <Upload size={20} />
        </span>
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
          Drop to add sources
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          PDFs, notes, videos or a link — they all feed this one note
        </p>
      </div>
    </div>
  );
}

export function WorkspaceShell({ noteId }: WorkspaceShellProps) {
  const router = useRouter();
  const search = useSearchParams();
  const { showToast } = useToast();

  const [note, setNote] = useState<NoteData | null>(null);
  // the note couldn't be loaded (deleted, someone else's, or the API is down)
  const [missing, setMissing] = useState(false);
  const [sources, setSources] = useState<NoteSource[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Not remembered across visits: coming back to a hidden source and an empty
  // note read as a broken page.
  const [sourcesOpen, setSourcesOpen] = useState(true);
  // One-pane layout only: which pane shows while the AI is closed.
  const [pane, setPane] = useState<"source" | "note">("source");
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [follow, setFollow] = useState(true);
  const [jobRequest, setJobRequest] = useState<JobRequest | null>(null);
  // The AI is the app's one panel (context/AIPanelContext): the workspace
  // binds it to this note and opens it; it draws no AI of its own.
  const ai = useAIPanel();
  const askOpen = ai.isOpen;
  const [splitPct, setSplitPct] = useState(50);

  const seekRef = useRef<((value: number) => void) | null>(null);
  const actionSinkRef = useRef<((a: SendAction) => void) | null>(null);
  // Passages the note quotes; the PDF tints them. Kept identical when unchanged so a save
  // doesn't redraw every text layer.
  const [passages, setPassages] = useState<Passage[]>([]);
  const updatePassages = useCallback((next: Passage[]) => {
    setPassages((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);
  const positionSinkRef = useRef<((value: number) => void) | null>(null);
  const applyRef = useRef<NoteApplyApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // dragenter/dragleave fire for every child element the pointer crosses, so a
  // plain boolean makes the drop overlay strobe. Count the depth instead.
  const dragDepth = useRef(0);

  // Kept for the note pane's apply/undo plumbing; the synthesis buttons that
  // drove it are gone (jobs run from the AI panel now).
  const syn = useSynthesis({ noteId, sources, applyRef });

  // The jobs the AI panel offers — also the editor's "/" menu, which hands the
  // chosen job to the AI panel so its result arrives as a preview card too.
  // Fetched once here and handed to the AI panel (two fetches of the same
  // list, each thrown away whenever a source finished, took 27 s to show).
  // A newer answer replaces an older one; no answer is ever discarded unless
  // the note itself changed.
  const [chatJobs, setChatJobs] = useState<ChatJob[]>([]);
  const jobsFor = useRef<string | null>(null);
  useEffect(() => { jobsFor.current = noteId; setChatJobs([]); }, [noteId]);
  useEffect(() => {
    if (!noteId) return;
    const forNote = noteId;
    fetch(`/api/ws/notes/${forNote}/chat/skills`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && jobsFor.current === forNote) setChatJobs(d.skills ?? []); })
      .catch(() => {});
  }, [noteId, syn.readyKey]);
  const openAi = ai.open;
  const askChat = useCallback((skill: string) => {
    openAi();
    setJobRequest({ skill, nonce: Date.now() });
  }, [openAi]);
  const slashItems = useMemo(
    () => chatJobs.filter((j) => !j.runnable).map((j) => ({
      title: jobTitle(j.skill),
      group: "Skills",
      subtext: j.description,
      aliases: [j.skill, "skill"],
      icon: "✨",
      onItemClick: () => askChat(j.skill),
    })),
    [chatJobs, askChat],
  );

  const insertResult = useCallback((html: string, sourceIds: string[], mode: "append" | "replace") => {
    const api = applyRef.current;
    if (!api) return;
    // "Insert" into an empty note is a replace: appending left an empty line
    // above the title. A note with anything in it gets the result at the end.
    api.apply(html, sourceIds, mode === "append" && !api.hasUserEdits() ? "replace" : mode);
  }, []);

  // The AI panel hands its results over the same events a note page answers
  // (lib/noteDraft.ts), so one panel works on both.
  useEffect(() => {
    function onDraft(e: Event) {
      const { draft, respond } = (e as CustomEvent<{ draft: NoteDraft; respond: (ok: boolean) => void }>).detail;
      if (draft.noteId !== noteId || !applyRef.current) return;
      respond(true);
      insertResult(draft.html, draft.sourceIds, "append");
      // Show where it landed, unless the note is already beside the AI.
      if (layoutRef.current !== "wide") { closeAiRef.current(); setPane("note"); }
    }
    function onUndo(e: Event) {
      const { noteId: target, respond } = (e as CustomEvent<{ noteId: string; respond: (o: UndoOutcome) => void }>).detail;
      if (target !== noteId) return;
      respond(applyRef.current?.undoApply() ? "undone" : "edited");
    }
    window.addEventListener(DRAFT_EVENT, onDraft);
    window.addEventListener(UNDO_EVENT, onUndo);
    return () => {
      window.removeEventListener(DRAFT_EVENT, onDraft);
      window.removeEventListener(UNDO_EVENT, onUndo);
    };
  }, [noteId, insertResult]);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadSources = useCallback(async () => {
    if (!noteId) return;
    const rows = await wsApi.listSources(noteId).catch(() => null);
    if (rows) setSources(rows);
  }, [noteId]);

  useEffect(() => {
    setMissing(false);
    if (!noteId) { setNote(null); setSources([]); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/notes/${noteId}`).catch(() => null);
      if (cancelled) return;
      if (!res?.ok) { setMissing(true); return; }
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

  // A brief "Saved" after every autosave settles — otherwise the header goes
  // silent the moment the work finishes and the save reads as never happening.
  const wasSaving = useRef(false);
  useEffect(() => {
    const settled = wasSaving.current && !saving;
    wasSaving.current = saving;
    if (!settled) return;
    setSavedFlash(true);
    const timer = setTimeout(() => setSavedFlash(false), 2000);
    return () => clearTimeout(timer);
  }, [saving]);

  // ── split divider ─────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(SPLIT_KEY));
    if (stored >= 25 && stored <= 70) setSplitPct(stored);
  }, []);

  // The layout follows the room the shell actually has (the app sidebar may be
  // open): one pane at a time, source + note/AI tabs, or all three side by side.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setLayoutWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [note]);
  const layout: Layout = layoutWidth >= WIDE_MIN ? "wide" : layoutWidth >= TWO_PANE_MIN || layoutWidth === 0 ? "two" : "one";

  // The Ask tab is where the app's one AI panel docks; "AI open" means "Ask
  // showing", so ⌘J and every "ask the AI" in the app land on this tab.
  const dock = ai.dock;
  const askSlotRef = useCallback((el: HTMLDivElement | null) => dock(el), [dock]);
  useEffect(() => () => dock(null), [dock]);
  const closeAi = ai.close;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const closeAiRef = useRef(closeAi);
  closeAiRef.current = closeAi;
  const showSource = useCallback(() => {
    if (layout === "one") { closeAi(); setPane("source"); }
    else setSourcesOpen(true);
  }, [layout, closeAi]);

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
    // Deferred attaches are inert until this call. If it fails, the sources are
    // safely attached but idle, so say so and leave the rail's retry to restart them.
    if (defer && landed) {
      try {
        await wsApi.processSources(landed);
      } catch {
        showToast("Sources attached, but processing didn’t start — use the retry "
                  + "arrow on a source to begin.");
      }
    }
    setBusy(false);
    if (!noteId && landed) router.replace(`/brain/workspace/${landed}`);
    else await loadSources();
  }, [noteId, router, loadSources, showToast]);

  const addFiles = useCallback((files: File[]) =>
    addInputs(files.map((file) => ({ file }))), [addInputs]);
  const addUrl = useCallback((url: string) =>
    addInputs([{ url }]), [addInputs]);

  // Files picked by /brain's Import button before this shell existed. Claimed
  // once on mount — takeStagedSources() clears them, so React's double-invoked
  // effects in development cannot upload the same file twice.
  useEffect(() => {
    const staged = takeStagedSources();
    if (staged.length) addFiles(staged);
  }, [addFiles]);

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

  // ── the one AI panel, bound to this note ─────────────────────────────────
  const bindWorkspace = ai.bindWorkspace;
  // Read at bind time; set during render below, where they are defined.
  const colorIndexRef = useRef<Map<string, number>>(new Map());
  const citationRef = useRef<(c: Citation) => void>(() => {});
  const noteTitle = note?.title;
  useEffect(() => {
    if (!noteId || !noteTitle) return;
    bindWorkspace({
      noteId, title: noteTitle, jobs: chatJobs, colorIndex: colorIndexRef.current,
      onCitation: (c) => citationRef.current(c), onSourcesAdded: () => void loadSources(),
      request: jobRequest,
    });
  }, [noteId, noteTitle, chatJobs, jobRequest, sources, bindWorkspace, loadSources]);
  useEffect(() => () => bindWorkspace(null), [bindWorkspace]);

  // ── whole-shell drag & drop ───────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    if (e.defaultPrevented) return;   // already taken inside the note (photo into a live block)
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) { addFiles(files); return; }
    const text = e.dataTransfer.getData("text/uri-list")
      || e.dataTransfer.getData("text/plain");
    if (text?.startsWith("http")) addUrl(text.trim());
  }, [addFiles, addUrl]);

  const dragProps = useMemo(() => ({
    // Over the AI panel a drop attaches to the conversation instead.
    onDragEnter: (e: React.DragEvent) => {
      if ((e.target as Element).closest?.("[data-ai-panel]")) return;
      dragDepth.current += 1; setDragOver(true);
    },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); },
    onDragLeave: (e: React.DragEvent) => {
      if ((e.target as Element).closest?.("[data-ai-panel]")) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    },
    // Capture phase: runs even when the note takes the drop itself and stops it there
    // (a .glb into the editor, a photo into a live block), so the overlay never sticks.
    onDropCapture: () => { dragDepth.current = 0; setDragOver(false); },
    onDrop,
  }), [onDrop]);

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

  // Switching sources swaps the viewer, and the outgoing viewer's seek function
  // is still in the ref at that instant — so a naive setActiveId-then-seek either
  // seeks the pane that is unmounting or is lost. Clear the ref at the switch and
  // wait for the incoming viewer to register its own.
  const seekWhenReady = useCallback((value: number) => {
    if (seekRef.current) { seekRef.current(value); return; }
    const timer = setInterval(() => {
      if (seekRef.current) { seekRef.current(value); clearInterval(timer); }
    }, 200);
    // Long enough for a sleeping free-plan backend (~1 min to wake) to serve the source.
    setTimeout(() => clearInterval(timer), 60000);
  }, []);

  const selectAndSeek = useCallback((sourceId: string, value: number) => {
    if (sourceId !== activeId) {
      seekRef.current = null;
      setActiveId(sourceId);
    }
    seekWhenReady(value);
  }, [activeId, seekWhenReady]);

  // Not a timer owned by this effect: setActiveId changes activeId and the 2 s source poll
  // changes `sources`, both re-run the effect, and its cleanup used to kill the wait for the
  // viewer while the "handled" guard stopped a new one, so a cold ?p=150 opened on page 1.
  useEffect(() => {
    if (!deepLink || !deepLinkKey || handledDeepLink.current === deepLinkKey) return;
    if (!sources.some((s) => s.id === deepLink.sid)) return;
    handledDeepLink.current = deepLinkKey;
    if (deepLink.value === null || Number.isNaN(deepLink.value)) {
      if (deepLink.sid !== activeId) { seekRef.current = null; setActiveId(deepLink.sid); }
      return;
    }
    selectAndSeek(deepLink.sid, deepLink.value);
  }, [deepLink, deepLinkKey, sources, activeId, selectAndSeek]);

  const handleCitation = useCallback((c: Citation) => {
    showSource();
    selectAndSeek(c.resource_id, c.anchor_start);
  }, [selectAndSeek, showSource]);

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
  colorIndexRef.current = colorIndex;
  citationRef.current = handleCitation;

  // ── empty shell ───────────────────────────────────────────────────────────
  if (!noteId || !note) {
    return (
      <div className="ws-canvas relative h-full" {...dragProps}>
        {noteId && missing ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-gray-400">
            This session couldn&apos;t be opened. It may have been deleted.
            <button
              onClick={() => router.push("/brain/workspace")}
              className="px-3 py-1.5 rounded-lg text-gray-700 dark:text-gray-200 bg-black/5 dark:bg-white/10
                hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
            >
              Start a new session
            </button>
          </div>
        ) : noteId ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-gray-400">
            <span className="w-5 h-5 rounded-full border-2 border-accent-400 border-t-transparent animate-spin" />
            Opening your session…
          </div>
        ) : (
          <DropZone onAddFiles={addFiles} onAddUrl={addUrl} busy={busy} />
        )}
        <DropOverlay show={dragOver} />
      </div>
    );
  }

  const sourcePane = (
    <section aria-label="Source" className="flex h-full min-w-0 flex-col bg-surface-sidebar">
      <SourceTabs
        sources={sources}
        activeId={activeId}
        onSelect={setActiveId}
        onAddFiles={addFiles}
        onAddUrl={addUrl}
        onRemove={removeSource}
        onCollapse={layout === "one" ? undefined : () => setSourcesOpen(false)}
        busy={busy}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <SourceViewer
          source={activeSource}
          onPosition={(v) => positionSinkRef.current?.(v)}
          onAction={(a) => actionSinkRef.current?.(a)}
          seekRef={seekRef}
          passages={passages}
          onRetry={retrySource}
        />
      </div>
    </section>
  );

  const notePane = (
    <NotePane
      extraSlashItems={slashItems}
      note={note}
      sources={sources}
      activeSourceId={activeId}
      onJump={(sid, v) => { showSource(); selectAndSeek(sid, v); }}
      actionSinkRef={actionSinkRef}
      positionSinkRef={positionSinkRef}
      applyRef={applyRef}
      onApplied={syn.markApplied}
      onSavingChange={setSaving}
      onPassages={updatePassages}
      follow={follow}
      starters={(focusEditor) => (
        <NoteStarters
          jobs={chatJobs}
          sourceCount={sources.length}
          onJob={askChat}
          onWrite={focusEditor}
        />
      )}
    />
  );

  // Note / Ask tabs (two-pane), or Source / Note / Ask (one pane).
  const rightTab: "note" | "ask" = askOpen ? "ask" : "note";
  const paneTabs = layout === "one"
    ? (
      <Tabs
        label="Pane"
        value={askOpen ? "ask" : pane}
        onChange={(v) => { if (v === "ask") ai.open(); else { closeAi(); setPane(v); } }}
        items={[
          { value: "source", label: "Source", icon: <FileText /> },
          { value: "note", label: "Note", icon: <PenLine /> },
          { value: "ask", label: "Ask AI", icon: <Sparkles /> },
        ]}
      />
    ) : layout === "two" ? (
      <Tabs
        label="Note or AI"
        value={rightTab}
        onChange={(v) => (v === "ask" ? ai.open() : closeAi())}
        items={[
          { value: "note", label: "Note", icon: <PenLine /> },
          { value: "ask", label: "Ask AI", icon: <Sparkles /> },
        ]}
      />
    ) : (
      <span className="flex items-center gap-1.5 px-2 text-sm font-medium text-ink"><PenLine size={15} /> Note</span>
    );

  // With the AI beside it, the note keeps at least a readable column.
  const sourceWidth = layout === "wide" && askOpen
    ? Math.min((splitPct / 100) * layoutWidth, layoutWidth - ASK_WIDTH - 440)
    : `${splitPct}%`;
  const showNote = layout === "wide" || (layout === "two" ? !askOpen : !askOpen && pane === "note");
  const showAsk = askOpen;
  const showSourcePane = layout === "one" ? !askOpen && pane === "source" : sourcesOpen;

  return (
    <div className="relative h-full flex flex-col bg-surface" {...dragProps}>
      {/* header */}
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line pl-2 pr-2 group-data-[sidebar=collapsed]/shell:pl-11">
        <Button variant="ghost" icon={<ArrowLeft />} onClick={() => router.push("/brain/workspace")}
          title="All study sessions">
          Sessions
        </Button>
        <span className="mx-1.5 h-[18px] w-px shrink-0 bg-line" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {titleDraft !== null ? (
            <input
              autoFocus
              aria-label="Session title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setTitleDraft(null); }}
              className="w-full min-w-0 border-b border-accent bg-transparent text-sm font-semibold text-ink outline-none"
            />
          ) : (
            <button
              onClick={() => setTitleDraft(note.title)}
              title="Rename this session"
              className="group/title flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-surface-hover"
            >
              <span className="truncate text-sm font-semibold text-ink">{note.title}</span>
              <Pencil size={12} className="shrink-0 text-ink-icon opacity-0 group-hover/title:opacity-100" />
            </button>
          )}
          <span className="shrink-0 text-xs text-ink-tertiary">
            <StatusNote saving={saving} saved={savedFlash} synthesizing={false} />
          </span>
        </div>
        <SessionMenu
          noteId={noteId}
          sourcesHidden={layout !== "one" && !sourcesOpen}
          onShowSources={() => setSourcesOpen(true)}
        />
      </header>

      {/* body */}
      <div ref={containerRef} className="flex min-h-0 flex-1">
        {layout === "one" ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-11 shrink-0 items-center border-b border-line px-2">{paneTabs}</div>
            <div className="relative min-h-0 flex-1">
              {/* Hidden, never unmounted: a video keeps playing and the note keeps
                  its editor for the AI's Insert. */}
              <div className={showSourcePane ? "absolute inset-0" : "hidden"}>{sourcePane}</div>
              <div className={showNote ? "absolute inset-0" : "hidden"}>{notePane}</div>
              {showAsk && <div ref={askSlotRef} data-ask-slot className="absolute inset-0" />}
            </div>
          </div>
        ) : (
          <>
            <div className={sourcesOpen ? "min-w-0 shrink-0" : "hidden"} style={{ width: sourceWidth }}>{sourcePane}</div>
            {sourcesOpen ? (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize the source"
                  onMouseDown={() => { draggingRef.current = true; document.body.style.cursor = "col-resize"; }}
                  onDoubleClick={() => { setSplitPct(50); window.localStorage.removeItem(SPLIT_KEY); }}
                  className="group/split relative w-px shrink-0 cursor-col-resize bg-line"
                  title="Drag to resize · double-click to reset"
                >
                  <span className="absolute inset-y-0 -left-1.5 -right-1.5 group-hover/split:bg-accent/30" />
                </div>
              </>
            ) : null}

            <section aria-label="Note" className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-[38px] shrink-0 items-center gap-1 border-b border-line px-2">
                {paneTabs}
                <span className="flex-1" />
                <Button
                  variant="ghost"
                  icon={<Link2 />}
                  aria-pressed={follow}
                  className={follow ? "text-accent" : ""}
                  title={follow ? "Following the source: the note scrolls with the page or video" : "Not following the source"}
                  onClick={() => setFollow((v) => !v)}
                >
                  Follow
                </Button>
                {layout === "wide" && !askOpen && (
                  <Button variant="ghost" icon={<Sparkles />} onClick={() => ai.focus()}>Ask AI</Button>
                )}
              </div>
              <div className="relative min-h-0 flex-1">
                <div className={showNote ? "absolute inset-0" : "hidden"}>{notePane}</div>
                {layout === "two" && showAsk && <div ref={askSlotRef} data-ask-slot className="absolute inset-0" />}
              </div>
            </section>

            {layout === "wide" && showAsk && (
              <div ref={askSlotRef} data-ask-slot className="shrink-0 border-l border-line"
                style={{ width: ASK_WIDTH }} />
            )}
          </>
        )}
      </div>

      <DropOverlay show={dragOver} />

    </div>
  );
}
