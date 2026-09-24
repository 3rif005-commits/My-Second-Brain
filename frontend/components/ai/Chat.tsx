"use client";

// The app-wide AI panel. Besides answering from the brain, it runs skills on
// files attached right here (user decision, 2026-09-24): attach, type
// `/study-guide …`, and the result comes back as a card to put in a note —
// the workspace is one click away, never a required stop.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Send, History, SquarePen, X, Smartphone, Cloud, Check, SlidersHorizontal, Sparkles,
  Paperclip, FileText, FilePlus2,
} from "lucide-react";
import { MessageList, type StreamItem } from "./MessageList";
import { ThreadHistory } from "./ThreadHistory";
import { useMode, type Mode } from "./ModeToggle";
import { PanelJobCard, type PanelJob } from "./PanelCards";
import {
  attachAndProcess, fileTitle, readNote, usePanelContext, type PanelScope,
} from "./panelSources";
import { jobPrice, matchJobs, parseCommand, type JobResult } from "@/lib/chatJobs";
import { ACCEPTED_WORKSPACE_FILES, jobTitle, type Citation } from "@/lib/workspace";
import { answerToHtml } from "@/lib/answerToHtml";
import { offerDraft, stageDraft, undoDraft, type NoteDraft } from "@/lib/noteDraft";

const ACCEPTED_EXT = ACCEPTED_WORKSPACE_FILES.split(",");
const accepted = (f: File) => ACCEPTED_EXT.some((ext) => f.name.toLowerCase().endsWith(ext));
const uid = () => crypto.randomUUID();

interface ChatProps {
  threadId?: string | null;
  onThreadIdChange?: (id: string) => void;
  initialQuery?: string;
  onClose?: () => void;
}

const MODEL_OPTIONS: { value: Mode; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: "local", label: "Local", desc: "On-device · private", icon: <Smartphone size={14} /> },
  { value: "api",   label: "Cloud", desc: "Faster · smarter",    icon: <Cloud size={14} /> },
];

export function Chat({ threadId: controlledThreadId, onThreadIdChange, initialQuery, onClose }: ChatProps = {}) {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalThreadId, setInternalThreadId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const threadId = controlledThreadId !== undefined ? controlledThreadId : internalThreadId;
  const [mode, setMode] = useMode();
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoSend = useRef(false);
  // The question an approval replays. Set on every send, never from a tool arg.
  const lastQueryRef = useRef<string>("");
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { pageNoteId, pageSources, setPageSources, jobs, ensureJobs } = usePanelContext();
  const [attachments, setAttachments] = useState<File[]>([]);
  // The note this thread's attached files live in: later questions and jobs
  // in the same thread keep working on them.
  const [scope, setScope] = useState<PanelScope | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const suggestions = matchJobs(input, jobs);
  // Where a job would run right now — said in the / menu before anything runs.
  const jobsRunOn = attachments.length
    ? `the ${attachments.length} attached file${attachments.length === 1 ? "" : "s"}`
    : scope ? `“${scope.title}”`
    : pageNoteId && pageSources ? "this note's sources" : null;

  function addFiles(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []);
    const ok = files.filter(accepted);
    if (ok.length < files.length) {
      setError(`Not a supported file: ${files.filter((f) => !accepted(f)).map((f) => f.name).join(", ")}. Try PDF, Markdown, text or video.`);
    }
    if (ok.length) setAttachments((prev) => [...prev, ...ok]);
    inputRef.current?.focus();
  }

  function resetThread(id: string | null) {
    abortRef.current?.abort();
    setThreadId(id);
    if (!id) setItems([]);
    setScope(null);
    setAttachments([]);
  }

  // Close mode menu on outside click
  useEffect(() => {
    if (!modeMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [modeMenuOpen]);

  // A thread id the server just gave this conversation: its messages are
  // already on screen (with cards the stored thread does not hold), so it
  // must not be reloaded over them.
  const adoptedThreadRef = useRef<string | null>(null);
  function adoptThreadId(id: string) {
    adoptedThreadRef.current = id;
    setThreadId(id);
  }

  function setThreadId(id: string | null) {
    setInternalThreadId(id);
    if (id) onThreadIdChange?.(id);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  // Load thread on switch
  useEffect(() => {
    if (!threadId) { setItems([]); return; }
    if (threadId === adoptedThreadRef.current) return;
    (async () => {
      const res = await fetch(`/api/threads/${threadId}`);
      if (!res.ok) return;
      const t = await res.json();
      const loaded: StreamItem[] = (t.messages ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m: any, i: number) => m.role === "user"
          ? { kind: "user" as const, id: `h-${i}`, content: m.content }
          : { kind: "assistant" as const, id: `h-${i}`, content: m.content }
      );
      setItems(loaded);
    })();
  }, [threadId]);

  // Auto-send initialQuery when CommandK expands into full chat
  useEffect(() => {
    if (initialQuery && !threadId && !didAutoSend.current) {
      didAutoSend.current = true;
      setInput(initialQuery);
      setTimeout(() => send(), 50);
    }
  }, [initialQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Re-run the last question, this time carrying the user's approval for one
   * specific action. The key never comes from the model — it is minted by the
   * server's gate and handed back only after the user presses Confirm. */
  function approve(approvalKey: string) {
    const query = lastQueryRef.current;
    if (!query || loading) return;
    send(undefined, { query, approvals: [approvalKey] });
  }

  const patchItem = (id: string, fn: (it: StreamItem) => StreamItem) =>
    setItems((prev) => prev.map((it) => (it.id === id ? fn(it) : it)));
  const patchJob = (id: string, fn: (j: PanelJob) => PanelJob) =>
    patchItem(id, (it) => (it.kind === "job" ? { ...it, job: fn(it.job) } : it));
  const notice = (content: string) =>
    setItems((prev) => [...prev, { kind: "notice", id: uid(), content }]);

  /** The conversation so far, as the agent reads it. */
  function history(query: string) {
    return [
      ...items.filter((i) => i.kind === "user" || i.kind === "assistant")
        .map((i) => ({ role: i.kind, content: (i as { content: string }).content })),
      { role: "user", content: query },
    ];
  }

  /** One agent turn. `where` scopes it to a note's sources (surface
   *  "workspace"); `job` runs a skill directly instead of a model turn. */
  async function stream(
    query: string,
    opts: { where?: PanelScope | null; job?: { skill: string; focus: string; cardId: string };
            approvals?: string[]; signal?: AbortSignal },
  ) {
    const assistantId = uid();
    let pickedCard: string | null = null;
    if (!opts.job) {
      setItems((prev) => [...prev, { kind: "assistant", id: assistantId, content: "", streaming: true,
        scopeNoteId: opts.where?.noteId }]);
    }
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        signal: opts.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          query,
          mode,
          approvals: opts.approvals ?? [],
          messages: history(query),
          ...(opts.where ? { surface: "workspace", current_note_id: opts.where.noteId } : {}),
          ...(opts.job ? { job: opts.job.skill, focus: opts.job.focus } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Server ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") continue;
          let ev: { type: string; [k: string]: unknown };
          try { ev = JSON.parse(raw); } catch { continue; }
          const card = opts.job?.cardId;

          if (ev.type === "text") {
            patchItem(assistantId, (it) => it.kind === "assistant"
              ? { ...it, content: it.content + (ev.content as string) } : it);
          } else if ((ev.type === "context" || ev.type === "citations") && ev.citations) {
            patchItem(assistantId, (it) => it.kind === "assistant"
              ? { ...it, citations: ev.citations as Citation[] } : it);
          } else if (ev.type === "skill_start" && card) {
            patchJob(card, (j) => ({ ...j, title: (ev.title as string) ?? j.title }));
          } else if (ev.type === "skill_start" && opts.where) {
            // The model picked a job itself: it still arrives as a card.
            pickedCard = uid();
            const picked: PanelJob = { skill: ev.skill as string, title: (ev.title as string) ?? jobTitle(ev.skill as string),
              focus: (ev.focus as string) ?? "", startedAt: Date.now(),
              noteId: opts.where.noteId, noteTitle: opts.where.title };
            setItems((prev) => insertBefore(prev, assistantId, { kind: "job", id: pickedCard!, job: picked }));
          } else if (ev.type === "result" && (card || pickedCard)) {
            patchJob((card ?? pickedCard)!, (j) => ({ ...j, result: ev as unknown as JobResult }));
          } else if (ev.type === "job_error" && pickedCard) {
            patchJob(pickedCard, (j) => (j.result ? j : { ...j, error: ev.content as string }));
          } else if ((ev.type === "job_error" || ev.type === "error") && card) {
            patchJob(card, (j) => (j.result ? j : { ...j, error: ev.content as string }));
          } else if (ev.type === "skill_active") {
            setItems((prev) => insertBefore(prev, assistantId, {
              kind: "skill", id: uid(), name: ev.name as string,
            }));
          } else if (ev.type === "tool_call") {
            setItems((prev) => insertBefore(prev, assistantId, {
              kind: "tool", id: ev.id as string, tool: ev.tool as string,
              args: ev.args as Record<string, unknown>,
            }));
          } else if (ev.type === "tool_result") {
            setItems((prev) => prev.map((it) =>
              it.kind === "tool" && it.id === ev.id
                ? { ...it, summary: ev.summary as string }
                : it
            ));
          } else if (ev.type === "tool_denied") {
            setItems((prev) => prev.map((it) =>
              it.kind === "tool" && it.id === ev.id
                ? {
                    ...it,
                    denied: ev.reason as string,
                    requiresApproval: ev.requires_approval === true,
                    approvalKey: (ev.approval_key as string) ?? undefined,
                  }
                : it
            ));
          } else if (ev.type === "done") {
            if (ev.thread_id) adoptThreadId(ev.thread_id as string);
          } else if (ev.type === "error") {
            setError(ev.content as string);
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Unknown error";
      if (opts.job) patchJob(opts.job.cardId, (j) => ({ ...j, error: msg }));
      else setError(msg);
    } finally {
      if (pickedCard) {
        patchJob(pickedCard, (j) => (j.result || j.error ? j
          : { ...j, error: "The job stopped without a result." }));
      }
      if (!opts.job) {
        patchItem(assistantId, (it) => it.kind === "assistant" ? { ...it, streaming: false } : it);
      } else {
        // A stream that ended with neither a result nor an error still has to
        // stop saying "Writing…".
        patchJob(opts.job.cardId, (j) => (j.result || j.error ? j
          : { ...j, error: "The job stopped without a result." }));
      }
    }
  }

  /** Run a skill on `where`'s sources, into a (new or reused) card. */
  async function runJob(where: PanelScope, skill: string, focus: string, query: string, cardId?: string) {
    const id = cardId ?? uid();
    const job: PanelJob = { skill, title: jobTitle(skill), focus, startedAt: Date.now(),
      noteId: where.noteId, noteTitle: where.title };
    if (cardId) patchJob(id, () => job);
    else setItems((prev) => [...prev, { kind: "job", id, job }]);
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      await stream(query, { where, job: { skill, focus, cardId: id }, signal: ctl.signal });
    } finally {
      setLoading(false);
    }
  }

  async function send(
    e?: React.FormEvent,
    opts?: { query?: string; approvals?: string[] },
  ) {
    e?.preventDefault();
    const query = (opts?.query ?? input).trim();
    // An approval replays the last question; the files went in the first time.
    const files = opts?.query ? [] : attachments;
    if ((!query && !files.length) || loading) return;
    lastQueryRef.current = query;
    const cmd = parseCommand(query, query.startsWith("/") ? await ensureJobs() : jobs);

    const shown = [query, files.length ? `📎 ${files.map((f) => f.name).join(", ")}` : ""]
      .filter(Boolean).join("\n");
    setItems((prev) => [...prev, { kind: "user", id: uid(), content: shown }]);
    setInput("");
    setAttachments([]);
    setError(null);
    setLoading(true);
    const ctl = new AbortController();
    abortRef.current = ctl;

    try {
      let where: PanelScope | null = scope;
      if (files.length) {
        // Files go into the open note only when it is empty; anywhere else a
        // new note holds them, so existing work is never touched.
        const page = pageNoteId ? await readNote(pageNoteId) : null;
        const target = page?.empty ? pageNoteId : null;
        const title = target ? page!.title : fileTitle(files[0].name);
        const uploadId = uid();
        setItems((prev) => [...prev, { kind: "upload", id: uploadId, title, files: [] }]);
        const out = await attachAndProcess(files, target,
          (_, fs) => patchItem(uploadId, (it) => it.kind === "upload" ? { ...it, files: fs } : it),
          ctl.signal);
        where = { noteId: out.noteId, title };
        setScope(where);
        if (out.noteId === pageNoteId) {
          setPageSources((n) => n + out.files.filter((f) => f.status === "ready").length);
        }
        if (!out.files.some((f) => f.status === "ready")) {
          notice("None of the files could be read, so nothing ran.");
          return;
        }
        if (!query) {
          notice(`Ready. Ask about “${title}”, or type / to run a skill such as /study-guide.`);
          return;
        }
      }

      if (cmd) {
        // A job runs on sources: attached now or earlier in this thread, or
        // the open note's own.
        const on = where ?? (pageNoteId && pageSources
          ? { noteId: pageNoteId, title: (await readNote(pageNoteId)).title } : null);
        if (!on) {
          notice(`/${cmd.skill} works on sources — attach a file with 📎 (or drop it here) and send it again.`);
          return;
        }
        setLoading(false);
        await runJob(on, cmd.skill, cmd.focus, query);
        return;
      }
      if (query) await stream(query, { where, approvals: opts?.approvals, signal: ctl.signal });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── where a result goes ─────────────────────────────────────────────────
  /** Put `html` into a note: the open one takes it live; any other is opened
   *  with the draft waiting for it. */
  async function deliver(d: NoteDraft) {
    if (d.noteId === pageNoteId && await offerDraft(d)) return;
    stageDraft(d);
    router.push(`/brain/${d.noteId}`);
  }

  async function applyJob(cardId: string, job: PanelJob, noteId: string) {
    if (!job.result) return;
    const own = noteId === job.noteId;
    const title = own ? job.noteTitle : (await readNote(noteId)).title;
    // Page anchors point at the job note's sources; elsewhere they would
    // point at sources that note does not have.
    await deliver({ noteId, html: job.result.html, mode: "replace",
      sourceIds: own ? job.result.source_ids : [] });
    patchJob(cardId, (j) => ({ ...j, applied: { noteId, title }, undoNote: undefined }));
  }

  async function undoJob(cardId: string, job: PanelJob) {
    if (!job.applied) return;
    const out = await undoDraft(job.applied.noteId);
    patchJob(cardId, (j) => out === "undone"
      ? { ...j, applied: undefined, undoNote: undefined }
      : { ...j, undoNote: out === "edited"
          ? "You've edited the note since — use Ctrl+Z in the note to step back."
          : "Open the note to undo it there (Ctrl+Z)." });
  }

  function insertAnswer(item: Extract<StreamItem, { kind: "assistant" }>, noteId: string) {
    void deliver({ noteId, html: answerToHtml(item.content, item.citations ?? []),
      mode: "replace", sourceIds: [] });
  }

  function completeJob(skill: string) {
    setInput(`/${skill} `);
    setMenuIndex(0);
    inputRef.current?.focus();
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = suggestions.length;
        setMenuIndex((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        completeJob(suggestions[Math.min(menuIndex, suggestions.length - 1)].skill);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 relative overflow-hidden"
      data-ai-panel
      onDragOver={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        setDragOver(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {dragOver && (
        <div className="absolute inset-2 z-30 rounded-2xl border-2 border-dashed border-indigo-400 bg-indigo-50/80
          dark:bg-indigo-950/60 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <FilePlus2 size={26} className="text-indigo-500" />
          <p className="text-sm font-medium text-indigo-700 dark:text-indigo-200">Drop to attach</p>
          <p className="text-xs text-indigo-500/80">then ask, or type /study-guide</p>
        </div>
      )}
      {/* History drawer — slides in from the left */}
      <div
        className={[
          "absolute inset-0 z-10 flex flex-col",
          "bg-[#eeeefc] dark:bg-[#0f0f1a]",
          "transition-transform duration-200 ease-in-out",
          historyOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
        aria-hidden={!historyOpen}
      >
        <ThreadHistory
          activeThreadId={threadId}
          onSelect={(id) => { resetThread(id); setHistoryOpen(false); }}
          onClose={() => setHistoryOpen(false)}
          onNew={() => { resetThread(null); setHistoryOpen(false); }}
        />
      </div>

      {/* Top bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200/60 dark:border-gray-800 shrink-0">
        <button
          onClick={() => setHistoryOpen(true)}
          aria-label="Thread history"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <History size={15} />
        </button>

        {/* Centered label */}
        <span className="flex-1 text-center text-[11px] font-medium text-gray-400 dark:text-gray-500 select-none pointer-events-none">
          AI Assistant
        </span>

        <div className="flex items-center gap-0.5">
          <button
            onClick={() => resetThread(null)}
            aria-label="New thread"
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <SquarePen size={15} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close AI panel"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 bg-white/50 dark:bg-white/[0.02]" role="log" aria-live="polite">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg">
              <Sparkles size={28} className="text-white" aria-hidden />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1.5">
              What do you want to know?
            </h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 max-w-[240px] leading-relaxed">
              Ask anything — answers are grounded in your notes.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] text-indigo-600
                dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
            >
              <Paperclip size={13} /> Attach files to make a study guide
            </button>
          </div>
        ) : (
          <MessageList
            items={items}
            onApprove={approve}
            renderJob={(it) => (
              <PanelJobCard
                job={it.job}
                pageNoteId={pageNoteId}
                busy={loading}
                onApply={(noteId) => void applyJob(it.id, it.job, noteId)}
                onUndo={() => void undoJob(it.id, it.job)}
                onRetry={() => void runJob({ noteId: it.job.noteId, title: it.job.noteTitle },
                  it.job.skill, it.job.focus, `/${it.job.skill} ${it.job.focus}`.trim(), it.id)}
                onDiscard={() => setItems((prev) => prev.filter((p) => p.id !== it.id))}
                onOpen={(href) => router.push(href)}
              />
            )}
            renderAnswerActions={(it) => {
              // An answer from sources can go into a note, like a job's result.
              const to = pageNoteId ?? it.scopeNoteId;
              if (!it.scopeNoteId || !to) return null;
              return (
                <button
                  onClick={() => insertAnswer(it, to)}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-gray-400 hover:text-indigo-500"
                >
                  <FileText size={11} /> {pageNoteId ? "Insert into this note" : "Put in note"}
                </button>
              );
            }}
          />
        )}
        {error && (
          <div className="px-4 mb-4">
            <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">{error}</div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2.5 shrink-0 border-t border-gray-200/60 dark:border-gray-800 relative">
        {suggestions.length > 0 && (
          <div role="listbox" aria-label="Skills"
            className="absolute bottom-full left-3 right-3 mb-1 z-20 bg-white dark:bg-gray-800 rounded-xl shadow-xl
              border border-gray-200 dark:border-gray-700 overflow-hidden">
            <p className="px-3 pt-2 pb-1 text-[10.5px] text-gray-400">
              {jobsRunOn ? `Runs on ${jobsRunOn}` : "Attach a file first (📎) — skills run on sources"}
            </p>
            {suggestions.map((j, i) => (
              <button key={j.skill} type="button" role="option" aria-selected={i === menuIndex}
                onMouseDown={(e) => { e.preventDefault(); completeJob(j.skill); }}
                className={`w-full text-left px-3 py-2 ${i === menuIndex
                  ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                <span className="text-[13px] font-medium text-gray-800 dark:text-gray-100">/{j.skill}</span>
                {jobPrice(j) && <span className="ml-1.5 text-[11px] text-gray-400">{jobPrice(j)}</span>}
                <span className="block text-[11.5px] text-gray-500 dark:text-gray-400 line-clamp-1">{j.description}</span>
              </button>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((f, i) => (
              <span key={`${f.name}-${i}`}
                className="inline-flex items-center gap-1 max-w-full h-7 pl-2 pr-1 rounded-lg text-[12px]
                  bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 text-gray-700 dark:text-gray-200">
                <FileText size={12} className="text-indigo-500 shrink-0" />
                <span className="truncate max-w-[180px]">{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`}
                  onClick={() => setAttachments((prev) => prev.filter((_, k) => k !== i))}
                  className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_WORKSPACE_FILES}
          className="hidden"
          data-testid="panel-file-input"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
        <form
          onSubmit={send}
          className="flex items-end gap-2 bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/60 rounded-xl px-3 py-2.5 shadow-md shadow-gray-100 dark:shadow-black/20"
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            aria-label="Attach files"
            title="Attach files — PDF, Markdown, text, video"
            className="shrink-0 p-1.5 -ml-1 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <Paperclip size={15} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setMenuIndex(0);
              if (e.target.value === "/" && !jobs.length) void ensureJobs();
            }}
            onKeyDown={handleKey}
            placeholder={attachments.length
              ? "Ask about them, or type / for a skill…"
              : "Ask anything about your notes…"}
            disabled={loading}
            aria-label="Message input"
            className="flex-1 resize-none text-sm bg-transparent border-none outline-none disabled:opacity-50 placeholder-gray-400"
            style={{ minHeight: "1.5rem" }}
          />

          {/* Model selector */}
          <div ref={modeMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setModeMenuOpen((v) => !v)}
              aria-label={`AI model: ${mode}`}
              className={`p-1.5 rounded-lg transition-colors ${
                modeMenuOpen
                  ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500"
                  : "text-gray-400 hover:text-indigo-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              <SlidersHorizontal size={14} />
            </button>

            {modeMenuOpen && (
              <div className="absolute bottom-full mb-2 right-0 w-52 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden z-20">
                <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Model
                </p>
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setMode(opt.value); setModeMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      mode === opt.value
                        ? "bg-indigo-50 dark:bg-indigo-950/40"
                        : "hover:bg-gray-50 dark:hover:bg-gray-750"
                    }`}
                  >
                    <span className={mode === opt.value ? "text-indigo-500" : "text-gray-400"}>
                      {opt.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${mode === opt.value ? "text-indigo-600 dark:text-indigo-400" : "text-gray-700 dark:text-gray-200"}`}>
                        {opt.label}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">{opt.desc}</div>
                    </div>
                    {mode === opt.value && <Check size={13} className="shrink-0 text-indigo-500" />}
                  </button>
                ))}
                <div className="h-1" />
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || (!input.trim() && !attachments.length)}
            aria-label="Send"
            className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
              (input.trim() || attachments.length) && !loading
                ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm"
                : "bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed"
            }`}
          >
            {loading
              ? <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              : <Send size={14} strokeWidth={2.5} />}
          </button>
        </form>
        <p className="text-[10px] text-gray-400 mt-1.5 text-center">
          Enter to send · / for skills · 📎 or drop files
        </p>
      </div>
    </div>
  );
}

function insertBefore(prev: StreamItem[], pivotId: string, item: StreamItem): StreamItem[] {
  const idx = prev.findIndex((p) => p.kind === "assistant" && p.id === pivotId);
  if (idx < 0) return [...prev, item];
  return [...prev.slice(0, idx), item, ...prev.slice(idx)];
}
