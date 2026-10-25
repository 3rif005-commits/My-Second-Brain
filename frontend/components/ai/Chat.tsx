"use client";

// THE AI panel — the same one on every page and in the workspace (user
// decision, 2026-09-24: one AI, one look). Besides answering from the brain,
// it runs skills on files or links attached right here: attach, type
// `/study-guide …`, and the result comes back as a card to put in a note.
// It is mounted once, by the app layout. On a workspace note (`workspace`
// prop) it is bound to that note: answers cite its sources as chips that jump
// to the page, attachments become its sources, results go into its editor.
// One conversation follows the user across pages.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePreferences } from "@/app/providers";
import {
  Send, History, SquarePen, X, Smartphone, Cloud, Check, Sparkles, Route, Lock, Zap, Brain, Eye, BookOpen,
  Paperclip, FileText, FilePlus2, Link2, Upload, Settings2, ChevronDown, Clock, Lightbulb, ListChecks, Search,
} from "lucide-react";
import { MessageList, type StreamItem } from "./MessageList";
import { ThreadHistory } from "./ThreadHistory";
import { modeRequest, useMode, type Mode } from "./ModeToggle";
import { PrivacyPrompt, slotLabel, type RouteInfo } from "./RouteBadge";
import { PanelJobCard, type PanelJob } from "./PanelCards";
import { BackgroundJobs } from "./BackgroundJobs";
import {
  attachAndProcess, attachmentName, attachmentsTitle, parseLink, readNote, usePanelContext,
  type Attachment, type PanelScope,
} from "./panelSources";
import {
  completeCommand, matchJobs, parseCommand, slashAt, type ChatJob, type JobRequest, type JobResult,
} from "@/lib/chatJobs";
import { ACCEPTED_WORKSPACE_FILES, jobTitle, type Citation } from "@/lib/workspace";
import { answerToHtml } from "@/lib/answerToHtml";
import { getQuote, priceLine, queueJob, tonight, type BgJob } from "@/lib/backgroundJobs";
import { offerDraft, stageDraft, undoDraft, type NoteDraft } from "@/lib/noteDraft";

const ACCEPTED_EXT = ACCEPTED_WORKSPACE_FILES.split(",");
const accepted = (f: File) => ACCEPTED_EXT.some((ext) => f.name.toLowerCase().endsWith(ext));
const uid = () => crypto.randomUUID();

/** The panel inside the workspace, bound to the open note. */
export interface WorkspaceBinding {
  noteId: string;
  title: string;
  /** Priced, each with the reason it cannot run yet (if any). */
  jobs: ChatJob[];
  colorIndex: Map<string, number>;
  onCitation: (c: Citation) => void;
  /** Files or links attached in the panel became sources: refresh the list. */
  onSourcesAdded?: () => void;
  /** A job asked for from the editor's "/" menu. */
  request?: JobRequest | null;
  /** Bumped by ⌘K: focus the input. */
  focusNonce?: number;
  /** What "Insert" says in a session: the note results go to ("Insert into Lecture 10"). */
  insertLabel?: string;
  /** Notes the session brought in beside its own: the AI reads them too. */
  sessionNoteIds?: string[];
}

interface ChatProps {
  threadId?: string | null;
  onThreadIdChange?: (id: string) => void;
  onClose?: () => void;
  workspace?: WorkspaceBinding;
  /** Bumped by ⌘K: focus the input. */
  focusNonce?: number;
  /** Text to put in the input (a new nonce each time). */
  prefill?: { text: string; nonce: number } | null;
  /** The conversation's first question, for the panel's tab ("" while there is none). */
  onTitle?: (title: string) => void;
  /** False while another tab of the panel is shown: it keeps running but stops polling. */
  active?: boolean;
  /** The panel draws the top row (its tabs carry history and new chat), so this one doesn't. */
  bare?: boolean;
  /** Bumped by the panel's history button: open the list of past conversations. */
  historyNonce?: number;
  /** Docked along the bottom: a wide, short space. The conversation keeps a readable
   *  column in the middle, and the empty state is one line instead of a tall block. */
  wide?: boolean;
}




/** Side padding that leaves a 768 px column in the middle of a wide panel (never under 12 px). */
const COLUMN = "px-[max(0.75rem,calc((100%_-_48rem)/2))]";

/** Starting points: a click puts the words in the input to send or edit; nothing runs by itself. */
const SUGGESTIONS = {
  workspace: [
    { icon: <ListChecks size={14} />, text: "Summarise the sources in this session" },
    { icon: <Lightbulb size={14} />, text: "Explain the hardest idea here simply" },
    { icon: <Brain size={14} />, text: "Quiz me on the key points" },
  ],
  brain: [
    { icon: <Search size={14} />, text: "What have I written about " },
    { icon: <ListChecks size={14} />, text: "Summarise what I studied this week" },
    { icon: <Lightbulb size={14} />, text: "Connect two ideas from my notes" },
  ],
};

/** A new conversation: what the AI works on, and three ways to start. Narrow: a calm
 *  stack low in the panel, near the input. Wide (docked at the bottom): one row. */
function EmptyState({ inWorkspace, wide, onPick }: { inWorkspace: boolean; wide: boolean; onPick: (text: string) => void }) {
  const items = inWorkspace ? SUGGESTIONS.workspace : SUGGESTIONS.brain;
  const lead = inWorkspace ? "Ask about this session" : "Ask your second brain";
  const sub = inWorkspace
    ? "Answers come from this note's sources and cite the exact page."
    : "Answers are grounded in your notes.";
  const chip = (s: { icon: React.ReactNode; text: string }) => (
    <button
      key={s.text}
      type="button"
      onClick={() => onPick(s.text)}
      className={`group/sugg flex items-center gap-2.5 rounded-lg text-left text-[13px] text-ink-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-ink ${
        wide ? "h-8 shrink-0 border border-line px-3" : "h-9 w-full px-2.5"}`}
    >
      <span className="shrink-0 text-ink-icon group-hover/sugg:text-accent">{s.icon}</span>
      <span className="truncate">{s.text.trim()}{s.text.endsWith(" ") ? "…" : ""}</span>
    </button>
  );
  if (wide) {
    return (
      <div className="flex min-h-full flex-col justify-center gap-3 py-4">
        <div className="flex items-baseline gap-2">
          <Sparkles size={15} className="shrink-0 self-center text-accent" aria-hidden />
          <span className="text-[14px] font-semibold text-ink">{lead}</span>
          <span className="truncate text-[13px] text-ink-tertiary">{sub}</span>
        </div>
        <div className="ws-scroll-x flex gap-2 overflow-x-auto">{items.map(chip)}</div>
      </div>
    );
  }
  return (
    // min-h-full + mt-auto, not justify-end: low in the panel, yet in a short window
    // the top scrolls into view instead of being cut off.
    <div className="flex min-h-full flex-col px-4 pb-3 pt-6">
      <div className="mb-4 mt-auto px-2.5">
        <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-accent-500/10">
          <Sparkles size={18} className="text-accent" aria-hidden />
        </div>
        <h2 className="text-[16px] font-semibold text-ink">{lead}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{sub}</p>
      </div>
      <div className="flex flex-col gap-0.5">{items.map(chip)}</div>
    </div>
  );
}

const MODEL_OPTIONS: { value: Mode; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: "auto",   label: "Auto",   desc: "Your rules decide · private stays home", icon: <Route size={14} /> },
  { value: "local",  label: "Local",  desc: "On this device · nothing leaves",        icon: <Smartphone size={14} /> },
  { value: "fast",   label: "Fast",   desc: "Cheap cloud model",                      icon: <Zap size={14} /> },
  { value: "strong", label: "Strong", desc: "Best reasoning",                         icon: <Brain size={14} /> },
  { value: "vision", label: "Vision", desc: "Images and figures",                     icon: <Eye size={14} /> },
  { value: "long",   label: "Long",   desc: "Very large context",                     icon: <BookOpen size={14} /> },
];

export function Chat({ threadId: controlledThreadId, onThreadIdChange, onClose, workspace, focusNonce, prefill, onTitle, active = true, bare = false, historyNonce, wide = false }: ChatProps = {}) {
  const { enterForNewLine } = usePreferences().preferences;
  const [items, setItems] = useState<StreamItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalThreadId, setInternalThreadId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => { if (historyNonce) setHistoryOpen(true); }, [historyNonce]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  // Run later (5.3): the menu beside Send, and a nudge so the panel's list of
  // background jobs shows a new one at once.
  const [laterOpen, setLaterOpen] = useState(false);
  const [bgRefresh, setBgRefresh] = useState(0);
  // The job just queued, shown at once while the list is fetched again.
  const [seedJob, setSeedJob] = useState<BgJob | null>(null);
  const laterRef = useRef<HTMLDivElement>(null);
  // What Run later would cost and how it would run — asked of the server when
  // the menu opens, so "half price" is only ever said when it will be true.
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof getQuote>> | null>(null);
  const threadId = controlledThreadId !== undefined ? controlledThreadId : internalThreadId;
  const [mode, setMode] = useMode();
  const scrollRef = useRef<HTMLDivElement>(null);
  // The question an approval replays. Set on every send, never from a tool arg.
  const lastQueryRef = useRef<string>("");
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const ctx = usePanelContext();
  // In the workspace the open note is the workspace's; elsewhere the page's.
  const pageNoteId = workspace ? workspace.noteId : ctx.pageNoteId;
  const pageSources = workspace ? workspace.jobs.length : ctx.pageSources;
  const setPageSources = ctx.setPageSources;
  // The note's own (priced, with reasons) list once it has arrived; the app's
  // list until then — an empty list in between made "/" flicker away.
  const jobs = workspace?.jobs.length ? workspace.jobs : ctx.jobs;
  const ensureJobs = async () => (workspace?.jobs.length ? workspace.jobs : ctx.ensureJobs());
  const fixedScope: PanelScope | null = workspace
    ? { noteId: workspace.noteId, title: workspace.title, sessionNoteIds: workspace.sessionNoteIds }
    : null;
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  // The note this thread's attached files live in: later questions and jobs
  // in the same thread keep working on them.
  const [scope, setScope] = useState<PanelScope | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Where the caret is: a "/word" is suggested wherever it is being typed.
  const [caret, setCaret] = useState(0);
  const suggestions = matchJobs(input, jobs, caret);
  const activeScope = fixedScope ?? scope;
  // Where a job would run right now — said in the / menu before anything runs.
  const jobsRunOn = attachments.length
    ? `the ${attachments.length} attached source${attachments.length === 1 ? "" : "s"}`
    : workspace ? "this note's sources"
    : scope ? `“${scope.title}”`
    : pageNoteId && pageSources ? "this note's sources" : null;

  function addFiles(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []);
    const ok = files.filter(accepted);
    if (ok.length < files.length) {
      setError(`Not a supported file: ${files.filter((f) => !accepted(f)).map((f) => f.name).join(", ")}. Try PDF, Markdown, text or video.`);
    }
    if (ok.length) setAttachments((prev) => [...prev, ...ok.map((file) => ({ kind: "file" as const, file }))]);
    inputRef.current?.focus();
  }

  /** A website or YouTube link, as a source. False when it is not a link. */
  function addLink(text: string): boolean {
    const url = parseLink(text);
    if (!url) return false;
    setAttachments((prev) => (prev.some((a) => a.kind === "url" && a.url === url)
      ? prev : [...prev, { kind: "url", url }]));
    return true;
  }

  function submitLinkDraft() {
    if (linkDraft === null) return;
    if (!linkDraft.trim()) { setLinkDraft(null); return; }
    if (addLink(linkDraft)) {
      setLinkDraft(null);
      setError(null);
      inputRef.current?.focus();
    } else {
      setError("That is not a link — paste a full address starting with https://");
    }
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

  // Someone handed the AI a starting point ("Try it"): it goes in the input,
  // cursor at the end, nothing sent until the user says so.
  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text);
    setCaret(prefill.text.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  // ⌘K: the panel is opening — put the cursor in the input once it is there.
  useEffect(() => {
    if (!focusNonce) return;
    const t = setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);   // after any prefilled text
    }, 220);
    return () => clearTimeout(t);
  }, [focusNonce]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const firstQuestion = items.find((it) => it.kind === "user")?.content ?? "";
  useEffect(() => {
    onTitle?.(firstQuestion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstQuestion]);

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
          : { kind: "assistant" as const, id: `h-${i}`, content: m.content,
              route: m.route as RouteInfo | undefined, private: m.private === true }
      );
      setItems(loaded);
    })();
  }, [threadId]);


  /** Re-run the last question, this time carrying the user's approval for one
   * specific action. The key never comes from the model — it is minted by the
   * server's gate and handed back only after the user presses Confirm. */
  function approve(approvalKey: string) {
    const query = lastQueryRef.current;
    if (!query || loading) return;
    // No second bubble: going through send() showed the question twice (live
    // check 2026-10-24, an MCP "Ask me first" confirm).
    setError(null);
    setLoading(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    stream(query, { where: activeScope, approvals: [approvalKey], signal: ctl.signal })
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      })
      .finally(() => setLoading(false));
  }

  /** Ask a question again without a new bubble: from the privacy prompt or
   *  an answer's "Ask again on". */
  async function replay(query: string, beforeId: string, where: PanelScope | null,
                        route: NonNullable<Parameters<typeof stream>[1]["route"]>) {
    if (loading) return;
    lastQueryRef.current = query;
    setError(null);
    setLoading(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      await stream(query, { where, route, beforeId, signal: ctl.signal });
    } finally {
      setLoading(false);
    }
  }

  function choosePrivacy(item: Extract<StreamItem, { kind: "privacy" }>,
                         choice: "local" | "without" | "once") {
    const where = item.scopeNoteId ? (activeScope?.noteId === item.scopeNoteId ? activeScope
      : { noteId: item.scopeNoteId, title: "" }) : null;
    const said = choice === "local" ? "Answered on this device."
      : choice === "without" ? "Sent without the private notes."
      : "Sent once — the notes stay private.";
    patchItem(item.id, (it) => it.kind === "privacy" ? { ...it, resolved: said } : it);
    void replay(item.query, item.id, where,
      choice === "local" ? { slot: "local" }
      : choice === "without" ? { withheld_ok: true }
      : { release: item.withheld.map((w) => w.id) });
  }

  const patchItem = (id: string, fn: (it: StreamItem) => StreamItem) =>
    setItems((prev) => prev.map((it) => (it.id === id ? fn(it) : it)));
  const patchJob = (id: string, fn: (j: PanelJob) => PanelJob) =>
    patchItem(id, (it) => (it.kind === "job" ? { ...it, job: fn(it.job) } : it));
  const notice = (content: string) =>
    setItems((prev) => [...prev, { kind: "notice", id: uid(), content }]);

  /** The conversation so far, as the agent reads it. `beforeId` replays a
   *  question: only what came before it, without the question itself (it is
   *  added back as the last message). Private answers keep their flag so a
   *  cloud turn gets a placeholder instead of their text. */
  function history(query: string, beforeId?: string) {
    let list = items;
    if (beforeId) {
      const at = items.findIndex((i) => i.id === beforeId);
      list = at >= 0 ? items.slice(0, at) : items;
      const convo = list.filter((i) => i.kind === "user" || i.kind === "assistant");
      const last = convo[convo.length - 1];
      if (last?.kind === "user") list = list.filter((i) => i.id !== last.id);
    }
    return [
      ...list.flatMap((i) => i.kind === "user" ? [{ role: "user", content: i.content }]
        : i.kind === "assistant" && i.content
          ? [{ role: "assistant", content: i.content, ...(i.private ? { private: true } : {}) }]
          : []),
      { role: "user", content: query },
    ];
  }

  /** One agent turn. `where` scopes it to a note's sources (surface
   *  "workspace"); `job` runs a skill directly instead of a model turn. */
  async function stream(
    query: string,
    opts: { where?: PanelScope | null; job?: { skill: string; focus: string; cardId: string };
            approvals?: string[]; signal?: AbortSignal;
            /** Routing overrides from the privacy prompt or "Ask again on". */
            route?: { slot?: string; release?: string[]; withheld_ok?: boolean; override_of?: string };
            /** Replaying a question: history stops before this item. */
            beforeId?: string },
  ) {
    const assistantId = uid();
    let pickedCard: string | null = null;
    if (!opts.job) {
      setItems((prev) => [...prev, { kind: "assistant", id: assistantId, content: "", streaming: true,
        scopeNoteId: opts.where?.noteId, query }]);
    }
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        signal: opts.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          query,
          ...(opts.route?.slot ? modeRequest(opts.route.slot as Mode) : modeRequest(mode)),
          release: opts.route?.release ?? [],
          withheld_ok: opts.route?.withheld_ok ?? false,
          ...(opts.route?.override_of ? { override_of: opts.route.override_of } : {}),
          approvals: opts.approvals ?? [],
          messages: history(query, opts.beforeId),
          ...(opts.where ? { surface: "workspace", current_note_id: opts.where.noteId,
                             session_note_ids: opts.where.sessionNoteIds ?? [] } : {}),
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

          if (ev.type === "route") {
            const route = ev as unknown as RouteInfo;
            patchItem(assistantId, (it) => it.kind === "assistant"
              ? { ...it, route, private: route.private_used === true } : it);
          } else if (ev.type === "privacy_needed") {
            // Nothing was sent: the question waits for the user's choice.
            const prompt: StreamItem = { kind: "privacy", id: uid(), query,
              withheld: ev.withheld as { id: string; title: string }[],
              slot: ev.slot as string, model: ev.model as string | undefined,
              scopeNoteId: opts.where?.noteId };
            setItems((prev) => [...prev.filter((p) => p.id !== assistantId), prompt]);
          } else if (ev.type === "text") {
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
    const cmd = parseCommand(query, /(^|\s)\//.test(query) ? await ensureJobs() : jobs);

    const shown = [query, files.length ? `📎 ${files.map(attachmentName).join(", ")}` : ""]
      .filter(Boolean).join("\n");
    setItems((prev) => [...prev, { kind: "user", id: uid(), content: shown }]);
    setInput("");
    setAttachments([]);
    setError(null);
    setLoading(true);
    const ctl = new AbortController();
    abortRef.current = ctl;

    try {
      let where: PanelScope | null = activeScope;
      if (files.length) {
        // In the workspace they become this note's sources. Elsewhere they go
        // into the open note only when it is empty; otherwise a new note holds
        // them, so existing work is never touched.
        const page = !workspace && pageNoteId ? await readNote(pageNoteId) : null;
        const target = workspace ? workspace.noteId : page?.empty ? pageNoteId : null;
        const title = workspace ? workspace.title : target ? page!.title : attachmentsTitle(files);
        const uploadId = uid();
        setItems((prev) => [...prev, { kind: "upload", id: uploadId, title, files: [] }]);
        let told = false;
        const out = await attachAndProcess(files, target,
          (_, fs) => {
            patchItem(uploadId, (it) => it.kind === "upload" ? { ...it, files: fs } : it);
            // The sources list shows them as soon as they are in.
            if (!told && fs.every((f) => f.status !== "uploading")) { told = true; workspace?.onSourcesAdded?.(); }
          },
          ctl.signal);
        workspace?.onSourcesAdded?.();
        where = { noteId: out.noteId, title };
        setScope(where);
        if (out.noteId === pageNoteId) {
          setPageSources((n) => n + out.files.filter((f) => f.status === "ready").length);
        }
        if (!out.files.some((f) => f.status === "ready")) {
          notice("None of them could be read, so nothing ran.");
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
          notice(`/${cmd.skill} works on sources — attach a file or a link with 📎 (or drop it here) and send it again.`);
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

  // A job asked for from the editor's "/" menu runs as if typed — after any
  // answer in progress has finished (the effect re-runs when loading ends).
  const request = workspace?.request;
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!request || request.nonce === lastNonce.current || loading) return;
    lastNonce.current = request.nonce;
    void send(undefined, { query: `/${request.skill}${request.focus ? " " + request.focus : ""}` });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, loading]);

  // ── where a result goes ─────────────────────────────────────────────────
  /** Put `html` into a note: the open one takes it live; any other is opened
   *  with the draft waiting for it. */
  async function deliver(d: NoteDraft) {
    if (d.noteId === pageNoteId && await offerDraft(d)) return;
    stageDraft(d);
    router.push(`/brain/${d.noteId}`);
  }

  /** Put a job's result in a note, and keep what the AI wrote so "Learn from
   *  my edits" can compare it later (E12). Live and background results share it. */
  async function putResultInNote(job: PanelJob, noteId: string) {
    if (!job.result) return;
    const own = noteId === job.noteId;
    // Page anchors point at the job note's sources; elsewhere they would
    // point at sources that note does not have.
    await deliver({ noteId, html: job.result.html, mode: "replace",
      sourceIds: own ? job.result.source_ids : [] });
    // Never waits, never blocks the insert.
    void fetch(`/api/ws/notes/${noteId}/ai-outputs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: job.skill, html: job.result.html }),
    }).catch(() => {});
  }

  async function applyJob(cardId: string, job: PanelJob, noteId: string) {
    if (!job.result) return;
    const own = noteId === job.noteId;
    const title = own ? job.noteTitle : (await readNote(noteId)).title;
    await putResultInNote(job, noteId);
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

  async function insertAnswer(item: Extract<StreamItem, { kind: "assistant" }>, noteId: string) {
    await deliver({ noteId, html: answerToHtml(item.content, item.citations ?? []),
      mode: "replace", sourceIds: [] });
    patchItem(item.id, (it) => it.kind === "assistant" ? { ...it, inserted: noteId, undoNote: undefined } : it);
  }

  async function undoAnswer(item: Extract<StreamItem, { kind: "assistant" }>) {
    if (!item.inserted) return;
    const out = await undoDraft(item.inserted);
    patchItem(item.id, (it) => it.kind !== "assistant" ? it : out === "undone"
      ? { ...it, inserted: undefined, undoNote: undefined }
      : { ...it, undoNote: out === "edited"
          ? "You've edited the note since — use Ctrl+Z in the note."
          : "Open the note to undo it there (Ctrl+Z)." });
  }

  // ── Run later ───────────────────────────────────────────────────────────
  // A job typed as /name can wait until tonight instead of running now.
  const pendingCmd = /(^|\s)\//.test(input) && !attachments.length ? parseCommand(input, jobs) : null;
  const laterJob = pendingCmd ? jobs.find((j) => j.skill === pendingCmd.skill) : undefined;
  const laterNoteId = activeScope?.noteId ?? (pageNoteId && pageSources ? pageNoteId : null);

  useEffect(() => {
    if (!laterOpen || !pendingCmd || !laterNoteId) { setQuote(null); return; }
    let live = true;
    setQuote(null);
    void getQuote(laterNoteId, pendingCmd.skill, pendingCmd.focus)
      .then((q) => { if (live) setQuote(q); }).catch(() => {});
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laterOpen, laterNoteId, pendingCmd?.skill, pendingCmd?.focus]);

  useEffect(() => {
    if (!laterOpen) return;
    function onDown(e: MouseEvent) {
      if (laterRef.current && !laterRef.current.contains(e.target as Node)) setLaterOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [laterOpen]);

  async function queueLater() {
    setLaterOpen(false);
    if (!pendingCmd || !laterNoteId) return;
    const query = input.trim();
    setError(null);
    try {
      const at = tonight();
      const queued: BgJob = await queueJob({ noteId: laterNoteId, skill: pendingCmd.skill,
        focus: pendingCmd.focus, runAfter: at });
      setItems((prev) => [...prev,
        { kind: "user", id: uid(), content: query },
        { kind: "notice", id: uid(),
          content: `Queued · ${jobTitle(queued.skill)} · ${priceLine(queued.price_mode,
            queued.shown_estimate_usd, at, new Date(), queued.live_equivalent_usd)}` }]);
      setInput("");
      setSeedJob(queued);
      setBgRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue it");
    }
  }

  function completeJob(skill: string) {
    const done = completeCommand(input, caret, skill);
    setInput(done.text);
    setCaret(done.caret);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(done.caret, done.caret));
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
    // Settings → Preferences → "Use Enter to add a new line": then Enter is a
    // newline and Cmd/Ctrl+Enter sends.
    const sends = enterForNewLine ? e.key === "Enter" && (e.metaKey || e.ctrlKey) : e.key === "Enter" && !e.shiftKey;
    if (sends) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 relative overflow-hidden"
      data-ai-panel
      onDragOver={(e) => {
        const types = e.dataTransfer?.types ?? [];
        if (!types.includes("Files") && !types.includes("text/uri-list")) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        const link = e.dataTransfer?.getData("text/uri-list")?.split("\n").find((l) => l && !l.startsWith("#"));
        if (!e.dataTransfer?.files?.length && !link) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        else if (link) addLink(link);
      }}
    >
      {dragOver && (
        <div className="absolute inset-2 z-30 rounded-2xl border-2 border-dashed border-accent-400 bg-accent-50/80
          dark:bg-accent-950/60 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <FilePlus2 size={26} className="text-accent-500" />
          <p className="text-sm font-medium text-accent-700 dark:text-accent-200">Drop files or links to attach</p>
          <p className="text-xs text-accent-500/80">then ask, or type /study-guide</p>
        </div>
      )}
      {/* History drawer — slides in from the left. Opaque: the panel's chip colour is
          see-through, and the conversation showed through the list. Wide (docked at the
          bottom): a sheet down the left side, not a 1,300 px list. */}
      <div
        className={[
          "absolute inset-y-0 left-0 z-10 flex flex-col bg-surface",
          wide ? "w-[360px] border-r border-line shadow-modal" : "right-0",
          "transition-transform duration-200 ease-in-out",
          historyOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
        aria-hidden={!historyOpen}
      >
        <div className="flex min-h-0 flex-1 flex-col">
        <ThreadHistory
          activeThreadId={threadId}
          onSelect={(id) => { resetThread(id); setHistoryOpen(false); }}
          onClose={() => setHistoryOpen(false)}
          onNew={() => { resetThread(null); setHistoryOpen(false); }}
        />
        </div>
      </div>

      {/* Top bar — the panel draws its own when it hosts this chat */}
      {!bare && <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200/60 dark:border-gray-800 shrink-0">
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
            className="p-1.5 rounded-lg text-gray-400 hover:text-accent-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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
      </div>}

      {/* Messages — wide: padded in to a readable column, centred */}
      <div ref={scrollRef} className={`flex-1 overflow-y-auto min-h-0 ${wide ? COLUMN : ""}`} role="log" aria-live="polite">
        {pageNoteId && active && (
          <BackgroundJobs
            noteId={pageNoteId}
            noteTitle={workspace?.title}
            pageNoteId={pageNoteId}
            inWorkspace={!!workspace}
            refreshKey={bgRefresh}
            seed={seedJob}
            onApply={putResultInNote}
            onUndo={(noteId) => undoDraft(noteId)}
            onOpen={(href) => router.push(href)}
            onAgain={(j) => {
              void queueJob({ noteId: j.note_id ?? pageNoteId, skill: j.skill, focus: j.focus, runAfter: null })
                .then(() => setBgRefresh((n) => n + 1))
                .catch((e) => setError(e instanceof Error ? e.message : "Could not queue it"));
            }}
          />
        )}
        {items.length === 0 ? (
          <EmptyState
            inWorkspace={!!workspace}
            wide={wide}
            onPick={(text) => { setInput(text); requestAnimationFrame(() => inputRef.current?.focus()); }}
          />
        ) : (
          <MessageList
            items={items}
            onApprove={approve}
            busy={loading}
            renderPrivacy={(it) => (
              <PrivacyPrompt withheld={it.withheld} slot={it.slot} model={it.model}
                resolved={it.resolved} busy={loading}
                onLocal={() => choosePrivacy(it, "local")}
                onWithout={() => choosePrivacy(it, "without")}
                onOnce={() => choosePrivacy(it, "once")} />
            )}
            onRerun={(it, slot) => {
              const where = it.scopeNoteId ? (activeScope?.noteId === it.scopeNoteId ? activeScope
                : { noteId: it.scopeNoteId, title: "" }) : null;
              void replay(it.query!, it.id, where,
                { slot, override_of: it.route?.decision_id ?? undefined });
            }}
            onCitation={workspace?.onCitation}
            colorIndex={workspace?.colorIndex}
            renderJob={(it) => (
              <PanelJobCard
                job={it.job}
                pageNoteId={pageNoteId}
                insertLabel={workspace?.insertLabel}
                inWorkspace={!!workspace}
                busy={loading}
                onApply={(noteId) => void applyJob(it.id, it.job, noteId)}
                onUndo={() => void undoJob(it.id, it.job)}
                onRetry={() => void runJob({ noteId: it.job.noteId, title: it.job.noteTitle },
                  it.job.skill, it.job.focus, `/${it.job.skill} ${it.job.focus}`.trim(), it.id)}
                onRetryDeep={() => {
                  // "deep" as the first word: this run only, chapter by chapter (E9).
                  const focus = `deep ${it.job.focus.replace(/^(deep|quick|chapters|single)\b\s*/i, "")}`.trim();
                  void runJob({ noteId: it.job.noteId, title: it.job.noteTitle },
                    it.job.skill, focus, `/${it.job.skill} ${focus}`, it.id);
                }}
                onDiscard={() => setItems((prev) => prev.filter((p) => p.id !== it.id))}
                onOpen={(href) => router.push(href)}
              />
            )}
            renderAnswerActions={(it) => {
              // An answer from sources can go into a note, like a job's result.
              const to = pageNoteId ?? it.scopeNoteId;
              if (!it.scopeNoteId || !to) return null;
              if (it.inserted) return (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
                  <span className="text-emerald-600">Added to the note</span>
                  {it.inserted === pageNoteId && (
                    <button onClick={() => void undoAnswer(it)} className="text-accent-600 hover:underline">Undo</button>
                  )}
                  {it.undoNote && <span className="text-gray-500">{it.undoNote}</span>}
                </div>
              );
              return (
                <button
                  onClick={() => void insertAnswer(it, to)}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-gray-400 hover:text-accent-500"
                >
                  <FileText size={11} /> {pageNoteId ? (workspace?.insertLabel ?? "Insert into this note") : "Put in note"}
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
      <div className={`pb-3 pt-1 shrink-0 relative ${wide ? COLUMN : "px-3"}`}>
        {suggestions.length > 0 && (
          <div role="listbox" aria-label="Skills"
            className="absolute bottom-full left-3 right-3 mb-1 z-20 rounded-menu bg-menu-bg shadow-menu overflow-hidden p-1">
            <p className="px-3 pt-2 pb-1 text-[10.5px] text-gray-400">
              {jobsRunOn ? `Runs on ${jobsRunOn}` : "Attach a file or a link first (📎) — skills run on sources"}
            </p>
            {suggestions.map((j, i) => (
              <button key={j.skill} type="button" role="option" aria-selected={i === menuIndex}
                onMouseDown={(e) => { e.preventDefault(); completeJob(j.skill); }}
                className={`w-full rounded-md text-left px-2.5 py-1.5 ${i === menuIndex ? "bg-menu-hover" : "hover:bg-menu-hover"}`}>
                <span className="text-[13px] font-medium text-ink">/{j.skill}</span>
                <span className="block text-[11.5px] text-ink-tertiary line-clamp-1">{j.runnable ?? j.description}</span>
              </button>
            ))}
            {mode === "local" && (
              <p className="px-3 py-1.5 text-[10.5px] text-gray-400 border-t border-gray-100 dark:border-gray-700">
                Skills run on the cloud model, even in Local mode.
              </p>
            )}
            <button type="button"
              onMouseDown={(e) => { e.preventDefault(); router.push("/brain/settings/skills"); }}
              className="w-full flex items-center gap-1.5 px-3 h-8 text-left text-[12px] text-gray-500
                hover:text-accent-600 hover:bg-gray-50 dark:hover:bg-white/5 border-t border-gray-100 dark:border-gray-700">
              <Settings2 size={12} /> Manage skills
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((a, i) => (
              <span key={`${attachmentName(a)}-${i}`}
                className="inline-flex items-center gap-1 max-w-full h-7 pl-2 pr-1 rounded-lg text-[12px]
                  bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 text-gray-700 dark:text-gray-200">
                {a.kind === "file"
                  ? <FileText size={12} className="text-accent-500 shrink-0" />
                  : <Link2 size={12} className="text-emerald-500 shrink-0" />}
                <span className="truncate max-w-[180px]">{attachmentName(a)}</span>
                <button type="button" aria-label={`Remove ${attachmentName(a)}`}
                  onClick={() => setAttachments((prev) => prev.filter((_, k) => k !== i))}
                  className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {linkDraft !== null && (
          <div className="flex items-center gap-1.5 mb-2">
            <Link2 size={14} className="text-emerald-500 shrink-0" />
            <input
              ref={linkInputRef}
              autoFocus
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submitLinkDraft(); }
                if (e.key === "Escape") { e.preventDefault(); setLinkDraft(null); inputRef.current?.focus(); }
              }}
              placeholder="https://… a website or a YouTube video"
              aria-label="Link to add"
              className="flex-1 min-w-0 h-8 px-2.5 text-[12.5px] rounded-lg bg-white dark:bg-gray-800 ring-1
                ring-gray-200 dark:ring-gray-700 outline-none focus:ring-accent-400"
            />
            <button type="button" onClick={submitLinkDraft}
              className="h-8 px-3 rounded-lg text-[12px] font-medium bg-accent-600 text-white hover:bg-accent-500">
              Add
            </button>
            <button type="button" onClick={() => setLinkDraft(null)} aria-label="Cancel link"
              className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              <X size={13} />
            </button>
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
          className="flex items-end gap-1.5 rounded-xl border border-line-strong bg-surface-elevated px-2.5 py-2 shadow-card
            transition-[border-color,box-shadow] duration-fast
            focus-within:border-accent-500/50 focus-within:ring-[3px] focus-within:ring-accent-500/15"
        >
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setAttachMenuOpen((v) => !v)}
              disabled={loading}
              aria-label="Attach"
              aria-expanded={attachMenuOpen}
              title="Attach files or a link"
              className="flex size-7 items-center justify-center rounded-md text-ink-icon hover:bg-surface-hover hover:text-ink disabled:opacity-50"
            >
              <Paperclip size={15} />
            </button>
            {attachMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAttachMenuOpen(false)} aria-hidden />
                <div role="menu" className="absolute bottom-full mb-2 left-0 z-20 w-56 rounded-menu bg-menu-bg shadow-menu overflow-hidden p-1">
                  <button type="button" role="menuitem"
                    onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                    className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-menu-hover">
                    <Upload size={14} className="text-accent-500" />
                    <span>
                      <span className="block text-[13px] text-gray-800 dark:text-gray-100">Upload files</span>
                      <span className="block text-[11px] text-gray-400">PDF, Markdown, text, video</span>
                    </span>
                  </button>
                  <button type="button" role="menuitem"
                    onClick={() => { setAttachMenuOpen(false); setLinkDraft(""); }}
                    className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-menu-hover">
                    <Link2 size={14} className="text-emerald-500" />
                    <span>
                      <span className="block text-[13px] text-gray-800 dark:text-gray-100">Add a link</span>
                      <span className="block text-[11px] text-gray-400">A website or a YouTube video</span>
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setMenuIndex(0);
              if (!jobs.length && slashAt(e.target.value, e.target.selectionStart ?? undefined)) void ensureJobs();
            }}
            onKeyDown={handleKey}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            placeholder={attachments.length
              ? "Ask about them, or / for a skill…"
              : workspace ? "Ask, or / for a skill…"
              : "Ask anything about your notes…"}
            disabled={loading}
            aria-label="Message the AI"
            /* the placeholder stays one line in a narrow panel instead of wrapping */
            className="flex-1 min-w-0 resize-none self-center bg-transparent py-1 text-[14px] leading-5 text-ink border-none outline-none disabled:opacity-50 placeholder:text-ink-placeholder placeholder:truncate"
            style={{ minHeight: "1.75rem" }}
          />

          {/* Model selector */}
          <div ref={modeMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setModeMenuOpen((v) => !v)}
              aria-label={`Where answers run: ${slotLabel(mode === "auto" ? "Auto" : mode)}`}
              aria-haspopup="menu" aria-expanded={modeMenuOpen}
              className={`inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12px] transition-colors ${
                modeMenuOpen
                  ? "bg-surface-active text-ink"
                  : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
              }`}
            >
              {mode === "local" ? <Lock size={12} /> : mode === "auto" ? <Route size={12} /> : <Cloud size={12} />}
              {mode === "auto" ? "Auto" : slotLabel(mode)}
            </button>

            {modeMenuOpen && (
              <div className="absolute bottom-full mb-2 right-0 w-60 rounded-menu bg-menu-bg shadow-menu overflow-hidden z-20 p-1">
                <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-tertiary">
                  Where answers run
                </p>
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setMode(opt.value); setModeMenuOpen(false); }}
                    className="w-full flex items-center gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-menu-hover"
                  >
                    <span className={mode === opt.value ? "text-accent" : "text-ink-icon"}>
                      {opt.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-ink">
                        {opt.label}
                      </div>
                      <div className="text-[11.5px] text-ink-tertiary">{opt.desc}</div>
                    </div>
                    {mode === opt.value && <Check size={14} className="shrink-0 text-ink" />}
                  </button>
                ))}
                <button type="button"
                  onClick={() => { setModeMenuOpen(false); router.push("/brain/settings/routing"); }}
                  className="mt-1 w-full flex items-center gap-1.5 rounded-md px-2.5 h-7 text-left text-[12px] text-ink-secondary
                    hover:bg-menu-hover hover:text-ink">
                  <Settings2 size={12} /> Routing settings
                </button>
              </div>
            )}
          </div>

          {pendingCmd && laterNoteId && (
            <div ref={laterRef} className="relative shrink-0">
              <button type="button" onClick={() => setLaterOpen((v) => !v)} disabled={loading}
                aria-label="More ways to run" aria-haspopup="menu" aria-expanded={laterOpen}
                className="w-6 h-8 -mr-1 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10">
                <ChevronDown size={14} />
              </button>
              {laterOpen && (
                <div role="menu" className="absolute bottom-full right-0 mb-2 w-72 rounded-xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-white/10 shadow-lg z-20 overflow-hidden">
                  <button type="button" role="menuitem" onClick={() => { setLaterOpen(false); send(); }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5">
                    <div className="text-[13px] font-medium text-gray-800 dark:text-gray-100">Run now</div>
                    <div className="text-[11.5px] text-gray-400">Watch it work</div>
                  </button>
                  <button type="button" role="menuitem" onClick={() => void queueLater()}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 border-t border-gray-100 dark:border-white/5">
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-gray-800 dark:text-gray-100">
                      <Clock size={12} /> Run later{quote?.price_mode === "batch" ? " — half price" : ""}
                    </div>
                    {/* Never a guess: until the server says how it would run, say so. */}
                    <div className="text-[11.5px] text-gray-400" data-testid="later-price">
                      {quote
                        ? priceLine(quote.price_mode, quote.usd, tonight(), new Date(), quote.live_usd)
                        : "Checking the price…"}
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (!input.trim() && !attachments.length)}
            aria-label="Send"
            title="Send (Enter)"
            className={`shrink-0 size-7 rounded-lg flex items-center justify-center transition-colors duration-fast ${
              (input.trim() || attachments.length) && !loading
                ? "bg-accent text-ink-on-accent hover:bg-accent-hover"
                : "bg-surface-hover text-ink-disabled cursor-not-allowed"
            }`}
          >
            {loading
              ? <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              : <Send size={14} strokeWidth={2.5} />}
          </button>
        </form>
      </div>
    </div>
  );
}

function insertBefore(prev: StreamItem[], pivotId: string, item: StreamItem): StreamItem[] {
  const idx = prev.findIndex((p) => p.kind === "assistant" && p.id === pivotId);
  if (idx < 0) return [...prev, item];
  return [...prev.slice(0, idx), item, ...prev.slice(idx)];
}
