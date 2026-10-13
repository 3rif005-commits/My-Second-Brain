"use client";

// The workspace: three panels side by side — the sources, the note, and the AI
// (user decision, 2026-09-24). Sources and AI each collapse to a thin bar and
// resize by dragging; the note is always there. Jobs (study guide, flashcards,
// compare sources…) run from the AI panel as /commands or by asking; their
// results are previewed there and reach the note only on Insert / Replace.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Check, ExternalLink, PanelLeftClose, PanelLeftOpen,
  Pencil, Sparkles, Upload,
} from "lucide-react";
import { useToast } from "@/app/providers";
import { formatElapsed, jobTitle, sourceColor, takeStagedSources, wsApi, type Citation, type NoteSource, type SendAction } from "@/lib/workspace";
import type { ChatJob, JobRequest } from "@/lib/chatJobs";
import { DropZone } from "./DropZone";
import { NotePane, type NoteApplyApi, type NoteData } from "./NotePane";
import { SourceRail } from "./SourceRail";
import { SourceViewer } from "./SourceViewer";
import { useSynthesis } from "./useSynthesis";
import { useAIPanel } from "@/context/AIPanelContext";
import { DRAFT_EVENT, UNDO_EVENT, type NoteDraft, type UndoOutcome } from "@/lib/noteDraft";

const SPLIT_KEY = "workspace:splitPct";
const PANELS_KEY = "workspace:panels";
function readPanels(): { sources: boolean } {
  try {
    const v = JSON.parse(window.localStorage.getItem(PANELS_KEY) ?? "null");
    return { sources: v?.sources !== false };
  } catch { return { sources: true }; }
}

function savePanels(p: { sources: boolean }) {
  try { window.localStorage.setItem(PANELS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

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
  const [sources, setSources] = useState<NoteSource[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [jobRequest, setJobRequest] = useState<JobRequest | null>(null);
  // The AI is the app's one panel (context/AIPanelContext): the workspace
  // binds it to this note and opens it; it draws no AI of its own.
  const ai = useAIPanel();
  const chatOpen = ai.isOpen;
  const [splitPct, setSplitPct] = useState(45);

  const seekRef = useRef<((value: number) => void) | null>(null);
  const actionSinkRef = useRef<((a: SendAction) => void) | null>(null);
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
    const p = readPanels();
    setSourcesOpen(p.sources);
  }, []);
  useEffect(() => { savePanels({ sources: sourcesOpen }); }, [sourcesOpen]);

  // Three panels need room. When they would leave the note narrower than it
  // can be read at, the sources step aside (one click brings them back) —
  // the note in the middle is never the panel that gets squeezed.
  // Once the user reopens the sources themselves, that choice wins until the
  // AI panel is opened again.
  const userWantsSources = useRef(false);
  useEffect(() => { if (chatOpen) userWantsSources.current = false; }, [chatOpen]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const check = () => {
      // The AI panel sits outside this container: its width is already gone.
      if (chatOpen && sourcesOpen && !userWantsSources.current
          && el.clientWidth < 760) setSourcesOpen(false);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chatOpen, sourcesOpen, note]);

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
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
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
  colorIndexRef.current = colorIndex;
  citationRef.current = handleCitation;

  // ── empty shell ───────────────────────────────────────────────────────────
  if (!noteId || !note) {
    return (
      <div className="ws-canvas relative h-full" {...dragProps}>
        {noteId ? (
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

  return (
    <div className="ws-canvas relative h-full flex flex-col" {...dragProps}>
      {/* header */}
      <header className="flex items-center gap-2 pl-3 pr-3 h-[52px] shrink-0 group-data-[sidebar=collapsed]/shell:pl-12">
        <button
          onClick={() => router.push("/brain/workspace")}
          title="Start a new session"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-gray-400
            hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/5
            transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="min-w-0 flex-1 flex flex-col justify-center">
          {titleDraft !== null ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); }}
              className="w-full text-[15px] font-semibold tracking-tight bg-transparent outline-none
                text-gray-900 dark:text-gray-50 border-b-2 border-accent-500 pb-px"
            />
          ) : (
            <button
              onClick={() => setTitleDraft(note.title)}
              title="Rename this note"
              className="group/title flex items-center gap-1.5 min-w-0 text-left"
            >
              <span className="truncate text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
                {note.title}
              </span>
              <Pencil
                size={12}
                className="shrink-0 text-gray-300 dark:text-gray-600 opacity-0 group-hover/title:opacity-100 transition-opacity"
              />
            </button>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 leading-none mt-0.5">
            {sources.length > 0 && (
              <span className="flex items-center -space-x-0.5 shrink-0">
                {sources.slice(0, 5).map((s) => (
                  <span
                    key={s.id}
                    className="w-2 h-2 rounded-full ring-2 ring-surface dark:ring-surface"
                    style={{ backgroundColor: sourceColor(s.order_index) }}
                  />
                ))}
              </span>
            )}
            <span className="shrink-0">
              {sources.length} source{sources.length === 1 ? "" : "s"}
            </span>
            <StatusNote saving={saving} saved={savedFlash} synthesizing={false} />
          </div>
        </div>

        <a
          href={`/brain/${note.id}`}
          title="Open this note on its own page"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-gray-400
            hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <ExternalLink size={15} />
        </a>
      </header>

      {/* body: sources · note · AI */}
      <div ref={containerRef} className="flex-1 min-h-0 flex px-2 pb-2 gap-0">
        {sourcesOpen ? (
          <>
            <div
              className="ws-panel flex flex-col min-w-0 rounded-2xl overflow-hidden"
              // With the AI panel open the note is the middle of three: the
              // sources give way so it is never the one squeezed.
              style={{ width: `${splitPct}%`, maxWidth: chatOpen ? "32%" : undefined }}
            >
              <div className="flex items-center justify-end px-1.5 pt-1.5 -mb-1 shrink-0">
                <button onClick={() => setSourcesOpen(false)} title="Collapse the sources panel"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400
                    hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/5">
                  <PanelLeftClose size={14} />
                </button>
              </div>
              <SourceRail
                noteId={noteId}
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
              className="group/split w-2 shrink-0 cursor-col-resize flex items-center justify-center"
              title="Drag to resize"
            >
              <span className="w-[3px] h-8 rounded-full bg-gray-300/0 dark:bg-white/0
                group-hover/split:bg-accent-400 dark:group-hover/split:bg-accent-500 transition-colors" />
            </div>
          </>
        ) : (
          <button onClick={() => { userWantsSources.current = true; setSourcesOpen(true); }} title="Show the sources"
            className="ws-panel w-10 shrink-0 mr-2 rounded-2xl flex flex-col items-center gap-2 pt-3
              text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition-colors">
            <PanelLeftOpen size={15} />
            {sources.slice(0, 8).map((s) => (
              <span key={s.id} className="w-2 h-2 rounded-full" style={{ backgroundColor: sourceColor(s.order_index) }} />
            ))}
          </button>
        )}

        <div className="ws-panel relative flex-1 min-w-[320px] rounded-2xl overflow-hidden">
          <NotePane
            extraSlashItems={slashItems}
            note={note}
            sources={sources}
            activeSourceId={activeId}
            onJump={selectAndSeek}
            actionSinkRef={actionSinkRef}
            positionSinkRef={positionSinkRef}
            applyRef={applyRef}
            onApplied={syn.markApplied}
            onSavingChange={setSaving}
          />
        </div>

      </div>

      <DropOverlay show={dragOver} />

    </div>
  );
}
