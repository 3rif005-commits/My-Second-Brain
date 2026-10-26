"use client";

// The workspace: a study session about one topic. Its own note owns the
// sources; other notes and sources from other notes can be brought in beside
// it. Up to three panes (two on a 921 px window, one on a narrow one), each a
// row of tabs, and any tab — a source, a note, the AI — can sit in any pane
// (redesign 2026-10-25; layout logic in sessionLayout.ts). The note last worked
// in is the writing target: captures, "Add to note" and AI results go there.
// The AI is the app's one panel, its own window docked right or bottom across
// every pane (not a tab in one), with a tab per conversation. A note can float
// or a source can float as a window over the panes too (FloatingTab).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Pencil, Sparkles, Upload } from "lucide-react";
import { useToast } from "@/app/providers";
import { Button } from "@/components/ui";
import {
  formatElapsed, jobTitle, sourceColor, takeStagedSources, wsApi,
  type Citation, type NoteSource, type SendAction,
} from "@/lib/workspace";
import type { ChatJob, JobRequest } from "@/lib/chatJobs";
import { DropZone } from "./DropZone";
import { NotePane, type NoteApplyApi, type NoteData } from "./NotePane";
import { SourceViewer } from "./SourceViewer";
import { PaneTabs, TAB_MIME, type TabView } from "./PaneTabs";
import { OpenPicker, type PickerItem } from "./OpenPicker";
import { NoteStarters, SessionMenu } from "./SessionChrome";
import { FloatingTab } from "./FloatingTab";
import { WritingTargetContext } from "./writingTarget";
import type { Passage } from "./viewers/passageMarks";
import { useSynthesis } from "./useSynthesis";
import {
  ASK, activate, canFloat, closeTab, defaultLayout, dockFloat, fitPanes, floatTab, focusFloat, focusPane,
  moveTab, moveToOtherSide, noteKey, openTab, paneOf, parseKey, readLayout, reconcile, srcKey,
  type SessionLayout,
} from "./sessionLayout";
import { useAIPanel } from "@/context/AIPanelContext";
import { DRAFT_EVENT, UNDO_EVENT, type NoteDraft, type UndoOutcome } from "@/lib/noteDraft";

const SPLIT_KEY = "workspace:splitPct";
/** Below this, one pane at a time. */
const TWO_PANE_MIN = 700;
/** From here, three panes fit. */
const WIDE_MIN = 1180;
type Mode = "one" | "two" | "wide";
/** Ctrl+K inside a session opens the picker (BrainLayoutClient sends it). */
export const OPEN_PICKER_EVENT = "workspace:open-picker";

interface WorkspaceShellProps {
  noteId: string | null;
}

interface NoteRefs {
  apply: MutableRefObject<NoteApplyApi | null>;
  action: MutableRefObject<((a: SendAction) => void) | null>;
  position: MutableRefObject<((value: number) => void) | null>;
}

const KIND_LABEL: Record<string, string> = {
  pdf: "PDF", youtube: "YouTube", video: "video", website: "web page", document: "document",
};

const short = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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
  const ai = useAIPanel();

  const [note, setNote] = useState<NoteData | null>(null);          // the session's own note
  const [missing, setMissing] = useState(false);
  const [sources, setSources] = useState<NoteSource[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [follow, setFollow] = useState(true);
  const [jobRequest, setJobRequest] = useState<JobRequest | null>(null);
  const [splitPct, setSplitPct] = useState(50);
  const [lay, setLay] = useState<SessionLayout | null>(null);
  const [pickerPane, setPickerPane] = useState<number | null>(null);
  const [otherNotes, setOtherNotes] = useState<Record<string, NoteData>>({});
  const [foreignSources, setForeignSources] = useState<Record<string, NoteSource>>({});
  const [passagesByNote, setPassagesByNote] = useState<Record<string, Passage[]>>({});
  const [lastSourceId, setLastSourceId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // dragenter/dragleave fire for every child the pointer crosses: count depth.
  const dragDepth = useRef(0);

  // ── layout mode from the room the shell has ───────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setLayoutWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [note]);
  const mode: Mode = layoutWidth >= WIDE_MIN ? "wide" : layoutWidth >= TWO_PANE_MIN || layoutWidth === 0 ? "two" : "one";
  const maxPanes = mode === "wide" ? 3 : mode === "two" ? 2 : 1;
  // A narrow window still keeps two panes' worth of tabs (it shows one at a time).
  const stateMax = Math.max(2, maxPanes);
  const stateMaxRef = useRef(stateMax);
  stateMaxRef.current = stateMax;
  const layRef = useRef(lay);
  layRef.current = lay;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // ── per-note and per-source connections ───────────────────────────────────
  const noteRefs = useRef(new Map<string, NoteRefs>());
  const refsFor = useCallback((id: string): NoteRefs => {
    let r = noteRefs.current.get(id);
    if (!r) {
      r = { apply: { current: null }, action: { current: null }, position: { current: null } };
      noteRefs.current.set(id, r);
    }
    return r;
  }, []);
  const seekRefs = useRef(new Map<string, MutableRefObject<((v: number) => void) | null>>());
  const seekRefFor = useCallback((id: string) => {
    let r = seekRefs.current.get(id);
    if (!r) { r = { current: null }; seekRefs.current.set(id, r); }
    return r;
  }, []);

  const homeApplyRef = useMemo(() => refsFor(noteId ?? "_none").apply, [noteId, refsFor]);
  // Kept for the note pane's apply/undo plumbing (jobs run from the AI panel).
  const syn = useSynthesis({ noteId, sources, applyRef: homeApplyRef });

  // ── the AI's jobs (also the editor's "/" skills) ──────────────────────────
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
  const closeAi = ai.close;
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

  // ── load the session ──────────────────────────────────────────────────────
  const loadSources = useCallback(async () => {
    if (!noteId) return;
    const rows = await wsApi.listSources(noteId).catch(() => null);
    if (rows) setSources(rows);
    setSourcesLoaded(true);
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

  const pending = sources.some((s) => s.status === "queued" || s.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(loadSources, 2000);
    return () => clearInterval(timer);
  }, [pending, loadSources]);

  // The layout: as it was left on this device, else sources | note.
  const storageKey = noteId ? `workspace:tabs:${noteId}` : null;
  const knownSources = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!noteId || !note || !sourcesLoaded || lay) return;
    let saved: SessionLayout | null = null;
    try { saved = readLayout(storageKey ? window.localStorage.getItem(storageKey) : null); } catch { /* private mode */ }
    const ready = [...sources].sort((a, b) => Number(b.status === "ready") - Number(a.status === "ready"));
    setLay(saved ?? defaultLayout(noteId, ready.map((s) => s.id)));
    knownSources.current = new Set(sources.map((s) => s.id));
  }, [noteId, note, sourcesLoaded, sources, lay, storageKey]);
  useEffect(() => {
    if (!lay || !storageKey) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(lay)); } catch { /* private mode */ }
  }, [lay, storageKey]);

  // A source added (here, in the AI panel, by a drop) opens as a tab: in the pane
  // its + was pressed in, else beside the other sources.
  const newSourcePane = useRef<number | null>(null);
  useEffect(() => {
    if (!lay || !knownSources.current) return;
    const fresh = sources.filter((s) => !knownSources.current!.has(s.id));
    if (!fresh.length) return;
    for (const s of fresh) knownSources.current.add(s.id);
    setLay((l) => {
      if (!l) return l;
      let next = l;
      for (const s of fresh) {
        const withSource = next.panes.findIndex((p) => p.tabs.some((t) => parseKey(t).kind === "source"));
        const where = newSourcePane.current ?? (withSource >= 0 ? withSource : "beside");
        next = openTab(next, srcKey(s.id), where, stateMaxRef.current);
      }
      return next;
    });
    newSourcePane.current = null;
  }, [sources, lay]);

  // Things that went away (a removed source, a trashed note) lose their tabs.
  useEffect(() => {
    if (!lay || !noteId || !sourcesLoaded) return;
    const home = new Set(sources.map((s) => s.id));
    const valid = (key: string) => {
      const k = parseKey(key);
      if (k.kind === "ask") return false;
      if (k.kind === "source") return home.has(k.id) || lay.foreign.includes(k.id);
      return k.id === noteId || lay.notes.includes(k.id);
    };
    const next = reconcile(lay, valid, noteId);
    if (JSON.stringify(next) !== JSON.stringify(lay)) setLay(next);
  }, [sources, lay, noteId, sourcesLoaded]);

  // Fewer panes fit: fold the extra ones in (a narrow window only hides them).
  useEffect(() => {
    if (mode === "one" || !layRef.current || layRef.current.panes.length <= maxPanes) return;
    keepNoteContent();
    setLay((l) => (l && l.panes.length > maxPanes ? fitPanes(l, maxPanes) : l));
  }, [mode, maxPanes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notes and foreign sources brought in: fetch what their tabs need.
  useEffect(() => {
    if (!lay) return;
    for (const id of lay.notes) {
      if (otherNotes[id]) continue;
      setOtherNotes((m) => ({ ...m, [id]: { id, title: "…", content: [] } }));
      fetch(`/api/notes/${id}`).then((r) => (r.ok ? r.json() : null)).then((n) => {
        if (!n) {
          setLay((l) => (l ? { ...l, notes: l.notes.filter((x) => x !== id) } : l));
          return;
        }
        setOtherNotes((m) => ({ ...m, [id]: { id: n.id, title: n.title ?? "Untitled", content: n.content ?? [] } }));
      }).catch(() => {});
    }
    for (const id of lay.foreign) {
      if (foreignSources[id]) continue;
      wsApi.getSource(id).then((s) => setForeignSources((m) => ({ ...m, [id]: s })))
        .catch(() => setLay((l) => (l ? { ...l, foreign: l.foreign.filter((x) => x !== id) } : l)));
    }
  }, [lay, otherNotes, foreignSources]);

  // "Saved" for a moment after every autosave settles.
  const wasSaving = useRef(false);
  useEffect(() => {
    const settled = wasSaving.current && !saving;
    wasSaving.current = saving;
    if (!settled) return;
    setSavedFlash(true);
    const timer = setTimeout(() => setSavedFlash(false), 2000);
    return () => clearTimeout(timer);
  }, [saving]);

  // ── lookups ───────────────────────────────────────────────────────────────
  const sourceById = useMemo(() => {
    const m = new Map<string, NoteSource>();
    for (const s of sources) m.set(s.id, s);
    for (const [id, s] of Object.entries(foreignSources)) if (!m.has(id)) m.set(id, s);
    return m;
  }, [sources, foreignSources]);
  const allSources = useMemo(() => [...sourceById.values()], [sourceById]);
  const noteById = useCallback((id: string): NoteData | null =>
    (id === noteId ? note : otherNotes[id] ?? null), [noteId, note, otherNotes]);
  const target = lay?.target ?? noteId ?? "";
  const targetTitle = noteById(target)?.title ?? "the note";
  const allPassages = useMemo(() => Object.values(passagesByNote).flat(), [passagesByNote]);

  // ── the AI ────────────────────────────────────────────────────────────────
  // The app's one AI panel, beside or under every pane: ⌘J, Ask AI on a
  // selection and the header button all open it. Layouts saved before it left
  // the panes may still hold an Ask tab; reconcile drops it.
  const aiOpen = ai.isOpen;

  // ── user actions on tabs ──────────────────────────────────────────────────
  /** A note moved to another pane or the floating window opens a new editor there,
   *  from the content it is handed: hand it what the editor holds now, not what
   *  the note held when the session opened. */
  const keepNoteContent = useCallback(() => {
    for (const [id, r] of noteRefs.current) {
      const doc = r.apply.current?.document();
      if (!doc?.length) continue;
      if (id === noteId) setNote((n) => (n && n.id === id ? { ...n, content: doc } : n));
      else setOtherNotes((m) => (m[id] ? { ...m, [id]: { ...m[id], content: doc } } : m));
    }
  }, [noteId]);

  const activateTab = useCallback((key: string, pane: number) => {
    const l = layRef.current;
    if (!l) return;
    if (parseKey(key).kind === "source") setLastSourceId(parseKey(key).id);
    setLay((x) => (x ? activate(x, pane, key) : x));
  }, []);

  const closeTabUser = useCallback((key: string) => {
    setLay((l) => (l ? closeTab(l, key) : l));
  }, []);

  const moveTabUser = useCallback((key: string) => {
    keepNoteContent();
    setLay((l) => (l ? moveToOtherSide(l, key, stateMaxRef.current) : l));
  }, [keepNoteContent]);

  const dropTab = useCallback((key: string, pane: number) => {
    keepNoteContent();
    setLay((l) => (l ? moveTab(l, key, pane, stateMaxRef.current) : l));
  }, [keepNoteContent]);

  const floatTabUser = useCallback((key: string) => {
    keepNoteContent();
    setLay((l) => (l ? floatTab(l, key) : l));
  }, [keepNoteContent]);

  /** Back into the pane you're in. */
  const dockFloatUser = useCallback((key: string) => {
    keepNoteContent();
    setLay((l) => (l ? dockFloat(l, key, l.focus, stateMaxRef.current) : l));
  }, [keepNoteContent]);

  /** Open a session item (or a note from anywhere) from the picker. */
  const openKey = useCallback((key: string, pane: number, beside: boolean) => {
    setPickerPane(null);
    const k = parseKey(key);
    if (k.kind === "ask") { openAi(); return; }
    if (k.kind === "source") setLastSourceId(k.id);
    keepNoteContent();
    setLay((l) => {
      if (!l) return l;
      let next = l;
      if (k.kind === "note" && k.id !== noteId && !l.notes.includes(k.id)) next = { ...next, notes: [...next.notes, k.id] };
      if (k.kind === "source" && !sourceById.has(k.id) && !l.foreign.includes(k.id)) next = { ...next, foreign: [...next.foreign, k.id] };
      return openTab(next, key, beside ? "beside" : pane, stateMaxRef.current);
    });
  }, [noteId, sourceById, openAi, keepNoteContent]);

  // ── where things go: the writing target ───────────────────────────────────
  /** Run `fn` with a note's editor connections, opening the note first when no
   *  pane holds it (only the target and shown notes are mounted). */
  const withNote = useCallback((id: string, fn: (r: NoteRefs) => void) => {
    const r = refsFor(id);
    if (r.action.current && r.apply.current) { fn(r); return; }
    setLay((l) => (l && paneOf(l, noteKey(id)) < 0 ? openTab(l, noteKey(id), "beside", stateMaxRef.current) : l));
    const started = Date.now();
    const timer = setInterval(() => {
      if (r.action.current && r.apply.current) { clearInterval(timer); fn(r); }
      else if (Date.now() - started > 10000) clearInterval(timer);
    }, 100);
  }, [refsFor]);

  /** Bring a note's tab to the front (after an insert lands in it). */
  const revealNote = useCallback((id: string) => {
    const l = layRef.current;
    if (!l) return;
    const key = noteKey(id);
    const p = paneOf(l, key);
    if (p < 0) return;   // floating (in view) or not open
    const visible = l.panes[p].active === key && (modeRef.current !== "one" || p === l.focus);
    if (visible) return;
    setLay((x) => (x ? activate(x, p, key) : x));
  }, []);

  const sendToTarget = useCallback((a: SendAction) => {
    const id = layRef.current?.target ?? noteId;
    if (!id) return;
    withNote(id, (r) => r.action.current?.(a));
    const l = layRef.current;
    const shown = l && (l.floating.includes(noteKey(id))
      || l.panes.some((p, i) => p.active === noteKey(id) && (modeRef.current !== "one" || i === l.focus)));
    if (!shown) showToast(`Added to ${short(noteById(id)?.title ?? "the note")}`, "info");
  }, [noteId, withNote, showToast, noteById]);

  // AI results go to the writing target too (the panel says which).
  const lastInserted = useRef<string | null>(null);
  useEffect(() => {
    function onDraft(e: Event) {
      const { draft, respond } = (e as CustomEvent<{ draft: NoteDraft; respond: (ok: boolean) => void }>).detail;
      if (draft.noteId !== noteId) return;
      respond(true);
      const id = layRef.current?.target ?? noteId!;
      withNote(id, (r) => {
        const api = r.apply.current;
        if (!api) return;
        // Into an empty note it's a replace (appending left an empty line above the title).
        api.apply(draft.html, draft.sourceIds, api.hasUserEdits() ? "append" : "replace");
        lastInserted.current = id;
        if (modeRef.current !== "wide") revealNote(id);
      });
    }
    function onUndo(e: Event) {
      const { noteId: t, respond } = (e as CustomEvent<{ noteId: string; respond: (o: UndoOutcome) => void }>).detail;
      if (t !== noteId) return;
      respond(refsFor(lastInserted.current ?? noteId!).apply.current?.undoApply() ? "undone" : "edited");
    }
    window.addEventListener(DRAFT_EVENT, onDraft);
    window.addEventListener(UNDO_EVENT, onUndo);
    return () => {
      window.removeEventListener(DRAFT_EVENT, onDraft);
      window.removeEventListener(UNDO_EVENT, onUndo);
    };
  }, [noteId, withNote, revealNote, refsFor]);

  // ── sources: open, seek ───────────────────────────────────────────────────
  const seekWhenReady = useCallback((sourceId: string, value: number) => {
    const ref = seekRefFor(sourceId);
    if (ref.current) { ref.current(value); return; }
    const timer = setInterval(() => {
      if (ref.current) { ref.current(value); clearInterval(timer); }
    }, 200);
    // Long enough for a sleeping free-plan backend (~1 min) to serve the source.
    setTimeout(() => clearInterval(timer), 60000);
  }, [seekRefFor]);

  /** Show a source (opening it if needed, never over the note being written or
   *  the AI when another pane will do) and seek it once its viewer is ready. */
  const selectAndSeek = useCallback((sourceId: string, value: number | null) => {
    const l = layRef.current;
    if (!l) return;
    const key = srcKey(sourceId);
    setLastSourceId(sourceId);
    // Floating, it's in view already: just seek it.
    if (l.floating.includes(key)) {
      if (value !== null && !Number.isNaN(value)) seekWhenReady(sourceId, value);
      return;
    }
    let pane = paneOf(l, key);
    if (pane < 0) {
      const tgt = noteKey(l.target);
      pane = l.panes.findIndex((p) => p.active && parseKey(p.active).kind === "source");
      if (pane < 0) pane = l.panes.findIndex((p) => p.active !== tgt);
    }
    setLay((x) => (x ? openTab(x, key, pane >= 0 ? pane : "beside", stateMaxRef.current) : x));
    if (value !== null && !Number.isNaN(value)) seekWhenReady(sourceId, value);
  }, [seekWhenReady]);

  // A citation to a brought-in note opens that note; to a source, its page or moment.
  const openNoteRef = useRef<(id: string) => void>(() => {});
  const handleCitation = useCallback((c: Citation) => {
    if (c.kind === "note" && c.note_id) openNoteRef.current(c.note_id);
    else selectAndSeek(c.resource_id, c.anchor_start);
  }, [selectAndSeek]);

  // Deep link: ?source=<id>&t=|p=|s=
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
    if (!lay || !deepLink || !deepLinkKey || handledDeepLink.current === deepLinkKey) return;
    if (!sources.some((s) => s.id === deepLink.sid)) return;
    handledDeepLink.current = deepLinkKey;
    selectAndSeek(deepLink.sid, deepLink.value);
  }, [lay, deepLink, deepLinkKey, sources, selectAndSeek]);

  // ── add / remove sources ──────────────────────────────────────────────────
  const addInputs = useCallback(async (items: { file?: File; url?: string }[]) => {
    setBusy(true);
    const defer = items.length > 1;
    let landed = noteId;
    const uploads = wsApi.startUploads(items);
    for (const [i, item] of items.entries()) {
      try {
        const r = await wsApi.attachSource({ ...item, uploaded: await uploads[i], noteId: landed, defer });
        landed = r.note_id;
      } catch (e) {
        showToast(e instanceof Error ? e.message : `Could not add ${item.file?.name ?? item.url ?? "source"}`);
      }
    }
    // Deferred attaches are inert until this call.
    if (defer && landed) {
      try { await wsApi.processSources(landed); }
      catch { showToast("Sources attached, but reading didn’t start — open one and press Start now."); }
    }
    setBusy(false);
    if (!noteId && landed) router.replace(`/brain/workspace/${landed}`);
    else await loadSources();
  }, [noteId, router, loadSources, showToast]);
  const addFiles = useCallback((files: File[]) => addInputs(files.map((file) => ({ file }))), [addInputs]);
  const addUrl = useCallback((url: string) => addInputs([{ url }]), [addInputs]);

  // Files picked by /brain's Import button before this shell existed.
  useEffect(() => {
    const staged = takeStagedSources();
    if (staged.length) addFiles(staged);
  }, [addFiles]);

  const retrySource = useCallback(async (s: NoteSource) => {
    await wsApi.reprocessSource(s.id).catch(() => {});
    await loadSources();
  }, [loadSources]);

  // ── the one AI panel, bound to this session ───────────────────────────────
  const bindWorkspace = ai.bindWorkspace;
  const colorIndexRef = useRef<Map<string, number>>(new Map());
  const citationRef = useRef<(c: Citation) => void>(() => {});
  const noteTitle = note?.title;
  const insertLabel = `Insert into ${short(targetTitle, 24)}`;
  const sessionNotesKey = (lay?.notes ?? []).join(",");
  useEffect(() => {
    if (!noteId || !noteTitle) return;
    bindWorkspace({
      noteId, title: noteTitle, jobs: chatJobs, colorIndex: colorIndexRef.current,
      onCitation: (c) => citationRef.current(c), onSourcesAdded: () => void loadSources(),
      request: jobRequest, insertLabel,
      sessionNoteIds: sessionNotesKey ? sessionNotesKey.split(",") : [],
    });
  }, [noteId, noteTitle, chatJobs, jobRequest, sources, bindWorkspace, loadSources, insertLabel, sessionNotesKey]);
  useEffect(() => () => bindWorkspace(null), [bindWorkspace]);
  colorIndexRef.current = useMemo(() => new Map(allSources.map((s) => [s.id, s.order_index])), [allSources]);
  citationRef.current = handleCitation;

  openNoteRef.current = (id: string) => {
    const l = layRef.current;
    if (!l) return;
    const at = paneOf(l, noteKey(id));
    if (at >= 0) { activateTab(noteKey(id), at); return; }
    openKey(noteKey(id), l.focus, true);
  };

  // Ctrl+K in a session: the picker, on the pane you're in.
  useEffect(() => {
    const open = () => setPickerPane(layRef.current?.focus ?? 0);
    window.addEventListener(OPEN_PICKER_EVENT, open);
    return () => window.removeEventListener(OPEN_PICKER_EVENT, open);
  }, []);

  // ── whole-shell drag & drop of files and links ────────────────────────────
  const isTabDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(TAB_MIME);
  const onDrop = useCallback((e: React.DragEvent) => {
    if (e.defaultPrevented || e.dataTransfer.types.includes(TAB_MIME)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) { addFiles(files); return; }
    const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (text?.startsWith("http")) addUrl(text.trim());
  }, [addFiles, addUrl]);
  const dragProps = useMemo(() => ({
    onDragEnter: (e: React.DragEvent) => {
      if (isTabDrag(e) || (e.target as Element).closest?.("[data-ai-panel]")) return;
      dragDepth.current += 1; setDragOver(true);
    },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); },
    onDragLeave: (e: React.DragEvent) => {
      if (isTabDrag(e) || (e.target as Element).closest?.("[data-ai-panel]")) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    },
    // Capture phase: runs even when the note takes the drop itself.
    onDropCapture: () => { dragDepth.current = 0; setDragOver(false); },
    onDrop,
  }), [onDrop]);

  // ── the divider between two panes ─────────────────────────────────────────
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(SPLIT_KEY));
    if (stored >= 25 && stored <= 75) setSplitPct(stored);
  }, []);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const box = containerRef.current.getBoundingClientRect();
      setSplitPct(Math.min(75, Math.max(25, ((e.clientX - box.left) / box.width) * 100)));
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      setSplitPct((p) => { window.localStorage.setItem(SPLIT_KEY, String(Math.round(p))); return p; });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // ── title ─────────────────────────────────────────────────────────────────
  async function saveTitle() {
    const next = (titleDraft ?? "").trim();
    setTitleDraft(null);
    if (!note || !next || next === note.title) return;
    setNote({ ...note, title: next });
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: next }),
    }).catch(() => {});
  }

  // ── empty shell ───────────────────────────────────────────────────────────
  if (!noteId || !note) {
    return (
      <div className="ws-canvas relative h-full" {...dragProps}>
        {noteId && missing ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-ink-secondary">
            This session couldn&apos;t be opened. It may have been deleted.
            <Button variant="secondary" onClick={() => router.push("/brain/workspace")}>Start a new session</Button>
          </div>
        ) : noteId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-ink-secondary">
            <span className="size-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Opening your session…
          </div>
        ) : (
          <DropZone onAddFiles={addFiles} onAddUrl={addUrl} busy={busy} />
        )}
        <DropOverlay show={dragOver} />
      </div>
    );
  }

  // ── tab views and pane contents ───────────────────────────────────────────
  const tabView = (key: string, pane: number, shown: boolean): TabView => {
    const k = parseKey(key);
    if (k.kind === "ask") return { key, pane, shown, kind: "ask", title: "Ask AI" };
    if (k.kind === "note") {
      return {
        key, pane, shown, kind: "note", title: noteById(k.id)?.title || "Untitled", isTarget: k.id === target,
        canFloat: !!lay && canFloat(lay, key),
      };
    }
    const s = sourceById.get(k.id);
    return {
      key, pane, shown, kind: "source", title: s?.title ?? "…", color: sourceColor(s?.order_index ?? 0),
      canFloat: !!lay && canFloat(lay, key),
      status: !s ? "working" : s.status === "failed" ? "failed" : s.status === "ready" ? null : "working",
    };
  };

  const openKeys = new Set([...(lay?.panes.flatMap((p) => p.tabs) ?? []), ...(lay?.floating ?? [])]);
  const sessionItems: PickerItem[] = lay ? [
    ...[noteId, ...lay.notes].filter((id) => !openKeys.has(noteKey(id)))
      .map((id) => ({ key: noteKey(id), kind: "note" as const, title: noteById(id)?.title || "Untitled",
        hint: id === noteId ? "this session's note" : "note" })),
    ...allSources.filter((s) => !openKeys.has(srcKey(s.id)))
      .map((s) => ({ key: srcKey(s.id), kind: "source" as const, title: s.title, color: sourceColor(s.order_index),
        hint: lay.foreign.includes(s.id) ? "from another note" : KIND_LABEL[s.kind] ?? "source" })),
    ...(aiOpen ? [] : [{ key: ASK, kind: "ask" as const, title: "Ask AI", hint: "Ctrl+J" }]),
  ] : [];
  const sessionNoteIds = new Set([noteId, ...(lay?.notes ?? [])]);

  const picker = (pane: number) => (
    <OpenPicker
      session={sessionItems}
      sessionNoteIds={sessionNoteIds}
      sessionSourceIds={new Set(allSources.map((s) => s.id))}
      onOpen={(key, beside) => openKey(key, pane, beside)}
      onOpenNote={(id, _title, beside) => openKey(noteKey(id), pane, beside)}
      onAddFiles={(files) => { newSourcePane.current = pane; addFiles(files); setPickerPane(null); }}
      onAddUrl={(url) => { newSourcePane.current = pane; addUrl(url); setPickerPane(null); }}
      onClose={() => setPickerPane(null)}
    />
  );

  const renderTab = (key: string, shown: boolean) => {
    const k = parseKey(key);
    if (k.kind === "ask") return null;
    if (k.kind === "source") {
      if (!shown) return null;
      const s = sourceById.get(k.id);
      return (
        <section key={key} aria-label="Source" className="absolute inset-0 flex min-w-0 flex-col bg-surface-sidebar">
          <SourceViewer
            source={s ?? null}
            onPosition={(v) => { if (follow) refsFor(target).position.current?.(v); }}
            onAction={sendToTarget}
            seekRef={seekRefFor(k.id)}
            passages={allPassages}
            onRetry={sources.some((x) => x.id === k.id) ? retrySource : undefined}
          />
        </section>
      );
    }
    // Every open note stays mounted, hidden when not shown: captures and AI results
    // need the target's editor, and unmounting a note just typed in could cut its
    // ~2 s autosave short.
    const n = noteById(k.id);
    if (!n || n.title === "…") return null;
    const refs = refsFor(k.id);
    const home = k.id === noteId;
    return (
      <div key={key} className={shown ? "absolute inset-0" : "hidden"}>
        <NotePane
          extraSlashItems={slashItems}
          note={n}
          sources={allSources}
          activeSourceId={lastSourceId}
          onJump={(sid, v) => selectAndSeek(sid, v)}
          actionSinkRef={refs.action}
          positionSinkRef={refs.position}
          applyRef={refs.apply}
          onApplied={home ? syn.markApplied : () => {}}
          onSavingChange={setSaving}
          onPassages={(p) => setPassagesByNote((m) => (JSON.stringify(m[k.id]) === JSON.stringify(p) ? m : { ...m, [k.id]: p }))}
          follow={follow}
          starters={home ? (focusEditor) => (
            <NoteStarters jobs={chatJobs} sourceCount={sources.length} onJob={askChat} onWrite={focusEditor} />
          ) : undefined}
        />
      </div>
    );
  };

  const panes = lay?.panes ?? [];
  const visibleCount = mode === "one" ? 1 : panes.length;
  const paneWidth = (i: number): React.CSSProperties =>
    visibleCount === 2 ? (i === 0 ? { width: `${splitPct}%` } : { flex: 1 }) : { flex: 1 };

  return (
    <WritingTargetContext.Provider value={{ title: targetTitle }}>
    <div className="relative flex h-full flex-col bg-surface" {...dragProps}>
      {/* header */}
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line pl-2 pr-2 group-data-[sidebar=collapsed]/shell:pl-11">
        <Button variant="ghost" icon={<ArrowLeft />} onClick={() => router.push("/brain/workspace")} title="All study sessions">
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
            <button onClick={() => setTitleDraft(note.title)} title="Rename this session"
              className="group/title flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-surface-hover">
              <span className="truncate text-sm font-semibold text-ink">{note.title}</span>
              <Pencil size={12} className="shrink-0 text-ink-icon opacity-0 group-hover/title:opacity-100" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setPickerPane(lay?.focus ?? 0)}
            title="Everything in this session (Ctrl+K)"
            className="hidden h-6 shrink-0 items-center rounded-full bg-surface-chip px-2.5 text-xs text-ink-secondary hover:text-ink sm:flex"
          >
            {allSources.length} source{allSources.length === 1 ? "" : "s"} · {1 + (lay?.notes.length ?? 0)} note{lay?.notes.length ? "s" : ""}
          </button>
          <span className="shrink-0 text-xs text-ink-tertiary">
            <StatusNote saving={saving} saved={savedFlash} synthesizing={false} />
          </span>
        </div>
        <Button variant="ghost" icon={<Sparkles />} onClick={() => (aiOpen ? closeAi() : openAi())}
          className={aiOpen ? "text-accent" : ""} title="Ask AI (Ctrl+J)">
          Ask AI
        </Button>
        <SessionMenu noteId={noteId} follow={follow} onFollowChange={setFollow} />
      </header>

      {lay && mode === "one" && (
        <div className="shrink-0">
          <PaneTabs
            tabs={panes.flatMap((p, i) => p.tabs.map((t) => tabView(t, i, i === lay.focus && p.active === t)))}
            focused
            canMove={false}
            onActivate={activateTab}
            onClose={closeTabUser}
            onMove={moveTabUser}
            onFloat={floatTabUser}
            onDropTab={(key) => dropTab(key, lay.focus)}
            pickerOpen={pickerPane !== null}
            onPickerOpenChange={(o) => setPickerPane(o ? lay.focus : null)}
            picker={picker(lay.focus)}
          />
        </div>
      )}
      {/* body */}
      <div ref={containerRef} className="flex min-h-0 flex-1">
        {!lay ? (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-secondary">Opening…</div>
        ) : (
          <>
            {panes.map((p, i) => {
              const hiddenPane = mode === "one" && i !== lay.focus;
              return (
                <div key={i} className={hiddenPane ? "hidden" : "flex min-w-0"} style={hiddenPane ? undefined : paneWidth(i)}>
                  {i > 0 && mode !== "one" && (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize the panes"
                      onMouseDown={() => { if (visibleCount === 2) { draggingRef.current = true; document.body.style.cursor = "col-resize"; } }}
                      onDoubleClick={() => { setSplitPct(50); window.localStorage.removeItem(SPLIT_KEY); }}
                      className={`group/split relative w-px shrink-0 bg-line ${visibleCount === 2 ? "cursor-col-resize" : ""}`}
                      title={visibleCount === 2 ? "Drag to resize · double-click to reset" : undefined}
                    >
                      <span className="absolute inset-y-0 -left-1.5 -right-1.5 group-hover/split:bg-accent/30" />
                    </div>
                  )}
                  <section
                    aria-label={`Pane ${i + 1}`}
                    onPointerDownCapture={() => { if (lay.focus !== i) setLay((x) => (x ? focusPane(x, i) : x)); }}
                    onDragOver={(e) => { if (isTabDrag(e)) e.preventDefault(); }}
                    onDrop={(e) => {
                      if (!isTabDrag(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const key = e.dataTransfer.getData(TAB_MIME);
                      if (key) dropTab(key, i);
                    }}
                    className="flex min-w-0 flex-1 flex-col"
                  >
                    {mode !== "one" && (
                      <PaneTabs
                        tabs={p.tabs.map((t) => tabView(t, i, p.active === t))}
                        focused={i === lay.focus}
                        canMove={maxPanes > 1}
                        onActivate={activateTab}
                        onClose={closeTabUser}
                        onMove={moveTabUser}
                        onFloat={floatTabUser}
                        onDropTab={(key) => dropTab(key, i)}
                        pickerOpen={pickerPane === i}
                        onPickerOpenChange={(o) => setPickerPane(o ? i : null)}
                        picker={picker(i)}
                      />
                    )}
                    <div className="relative min-h-0 flex-1">
                      {p.tabs.map((t) => renderTab(t, p.active === t))}
                    </div>
                  </section>
                </div>
              );
            })}
          </>
        )}
      </div>

      {lay?.floating.map((key, i) => (
        <FloatingTab
          key={key}
          tab={tabView(key, -1, true)}
          storageKey={key}
          order={i}
          onDock={() => dockFloatUser(key)}
          onClose={() => closeTabUser(key)}
          onFocus={() => setLay((x) => (x ? focusFloat(x, key) : x))}
        >
          {renderTab(key, true)}
        </FloatingTab>
      ))}

      <DropOverlay show={dragOver} />
    </div>
    </WritingTargetContext.Provider>
  );
}
