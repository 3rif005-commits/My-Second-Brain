"use client";

// The workspace's one AI (user decision, 2026-09-24): the app-wide assistant
// and the note's own AI panel, merged. One conversation that can
//   - answer from THIS note's sources, citing the exact page ([n] chips);
//   - reach the rest of the brain through its tools (search, open, create
//     notes; databases; MCP), with the same Confirm gate as everywhere;
//   - run jobs — /study-guide, /flashcards, /compare-sources — or pick one
//     when asked; a job's result is a card: Preview, Insert, Replace, Undo.
// Every answer can be inserted into the note. The AI never edits the open
// note behind the editor's back: it writes, the user inserts.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp, ChevronRight, Cloud, Eye, EyeOff, History, MessagesSquare,
  PanelRightClose, Smartphone, Sparkles, SquarePen, Undo2,
} from "lucide-react";
import { anchorLabel, sourceColor, type Citation } from "@/lib/workspace";
import {
  jobPrice, matchJobs, parseCommand, resultSummary, PREVIEW_CSS,
  type ChatJob, type JobResult,
} from "@/lib/chatJobs";
import { answerToHtml } from "@/lib/answerToHtml";
import { Markdown } from "@/lib/markdown/Markdown";
import { ThreadHistory } from "@/components/ai/ThreadHistory";
import { ToolEvent } from "@/components/ai/ToolEvent";
import { SkillBadge } from "@/components/ai/SkillBadge";
import { useMode, type Mode } from "@/components/ai/ModeToggle";

/** Openers for an empty thread — one tap instead of a blank page. */
const STARTERS = [
  "Summarise the key ideas",
  "What should I remember first?",
  "Explain the hardest part simply",
];

interface JobState {
  skill: string;
  title: string;
  focus: string;
  picked: boolean;
  startedAt: number;
  result?: JobResult;
  error?: string;
}

type Item =
  | { kind: "user"; id: string; content: string }
  | { kind: "assistant"; id: string; content: string; citations: Citation[]; streaming?: boolean }
  | { kind: "tool"; id: string; tool: string; args: Record<string, unknown>;
      summary?: string; denied?: string; requiresApproval?: boolean; approvalKey?: string }
  | { kind: "skill"; id: string; name: string }
  | { kind: "job"; id: string; job: JobState }
  | { kind: "error"; id: string; content: string };

export interface JobRequest { skill: string; focus?: string; nonce: number }

interface WorkspaceChatProps {
  noteId: string;
  colorIndex: Map<string, number>;   // resource_id → order_index, for the dots
  onCitation: (citation: Citation) => void;
  onClose: () => void;
  /** Put HTML into the note (a job's result, or an answer). */
  onInsert: (html: string, sourceIds: string[], mode: "append" | "replace") => void;
  /** Take the last insert back out. False when it cannot (edited since). */
  onUndo: () => boolean;
  /** A job asked for from outside the panel (the editor's "/" menu). */
  request?: JobRequest | null;
  /** The jobs this note offers (fetched once, by the shell). */
  jobs: ChatJob[];
  /** Bumped by ⌘K: focus the input. */
  focusNonce?: number;
}

const THREAD_KEY = (noteId: string) => `workspace:thread:${noteId}`;
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID()
  : Math.random().toString(36).slice(2));

const MODES: { value: Mode; label: string; icon: React.ReactNode }[] = [
  { value: "api", label: "Cloud", icon: <Cloud size={12} /> },
  { value: "local", label: "Local", icon: <Smartphone size={12} /> },
];

/** Assistant text with [n] markers as source chips (Markdown everywhere else). */
function Answer({ content, citations, colorIndex, onCitation }: {
  content: string; citations: Citation[];
  colorIndex: Map<string, number>; onCitation: (c: Citation) => void;
}) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const linked = content.replace(/\[(\d{1,2})\](?!\()/g, (m, n) => (byN.has(Number(n)) ? `[${n}](#cite-${n})` : m));
  const components = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a: ({ href, children }: any) => {
      const m = /^#cite-(\d+)$/.exec(href ?? "");
      const c = m ? byN.get(Number(m[1])) : undefined;
      if (!c) return <a href={href} className="text-indigo-600 dark:text-indigo-400 hover:underline">{children}</a>;
      const idx = colorIndex.get(c.resource_id) ?? 0;
      return (
        <button type="button" onClick={() => onCitation(c)}
          title={`${c.title} — ${anchorLabel(c.anchor_type, c.anchor_start)}\n${c.snippet ?? ""}`}
          className="inline-flex items-center gap-1 mx-0.5 px-1.5 h-[18px] rounded-md align-baseline
            text-[10.5px] font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300
            hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sourceColor(idx) }} />
          {c.n}
        </button>
      );
    },
  };
  return (
    <div className="text-[13px] leading-relaxed text-gray-800 dark:text-gray-100 [&_p]:my-1.5">
      <Markdown components={components}>{linked}</Markdown>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

/** A job's result, in the chat: what it holds, what it cost, and the way into the note. */
function JobCard({ job, applied, canUndo, onApply, onUndo }: {
  job: JobState;
  /** How its result reached the note, if it did. */
  applied?: "append" | "replace";
  /** Only the latest insert can be undone — the note keeps one snapshot. */
  canUndo: boolean;
  onApply: (mode: "append" | "replace") => void;
  onUndo: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const r = job.result;
  return (
    <div className="rounded-2xl ring-1 ring-gray-200/80 dark:ring-white/10 bg-white dark:bg-white/[0.03] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-white/5">
        <Sparkles size={13} className="text-indigo-500 shrink-0" />
        <span className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100 truncate">{job.title}</span>
        {job.focus && <span className="text-[11px] text-gray-400 truncate">· {job.focus}</span>}
        <span className="ml-auto text-[11px] text-gray-400 shrink-0">
          {!r && !job.error && <><span className="ws-shimmer">Writing… </span><Elapsed since={job.startedAt} /></>}
          {r && (r.usd != null ? `$${r.usd.toFixed(3)}` : "")}
          {r && ` · ${Math.round((r.input_tokens + r.output_tokens) / 1000)}K tokens`}
        </span>
      </div>
      {job.error && (
        <p className="px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">{job.error}</p>
      )}
      {r && (
        <div className="px-3 py-2 space-y-2">
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            {resultSummary(r.html) || "Ready"}
            {r.truncated && <span className="text-amber-600"> · cut off at the length limit</span>}
          </p>
          {preview && (
            <iframe
              title={`${job.title} preview`}
              sandbox=""
              className="w-full h-72 rounded-xl ring-1 ring-gray-200 dark:ring-white/10 bg-white"
              srcDoc={`<style>${PREVIEW_CSS}</style>${r.html}`}
            />
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setPreview((v) => !v)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200/70">
              {preview ? <EyeOff size={12} /> : <Eye size={12} />} {preview ? "Hide" : "Preview"}
            </button>
            {!applied ? (
              <>
                <button onClick={() => onApply("append")}
                  className="ws-accent inline-flex items-center h-7 px-3 rounded-full text-[12px] font-medium">
                  Insert into note
                </button>
                <button onClick={() => onApply("replace")}
                  title="Swap the whole note for this result (Undo is available)"
                  className="inline-flex items-center h-7 px-2.5 rounded-full text-[12px] text-gray-600 dark:text-gray-300 ring-1 ring-gray-200 dark:ring-white/10 hover:bg-gray-50 dark:hover:bg-white/5">
                  Replace note
                </button>
              </>
            ) : (
              <>
                <span className="text-[12px] text-emerald-600">
                  {applied === "append" ? "Added to the note" : "Note replaced"}
                </span>
{canUndo && (
                <button onClick={onUndo}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] text-indigo-600 hover:bg-indigo-500/10">
                  <Undo2 size={12} /> Undo
                </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkspaceChat({
  noteId, colorIndex, onCitation, onClose, onInsert, onUndo, request, jobs, focusNonce,
}: WorkspaceChatProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mode, setMode] = useMode();
  const [menuIndex, setMenuIndex] = useState(0);
  /** The one insert Undo can take back — the note keeps a single snapshot. */
  const [lastInsert, setLastInsert] = useState<string | null>(null);
  const [inserted, setInserted] = useState<Record<string, "append" | "replace">>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef("");        // what an approval replays — never a tool arg

  // ── one conversation per note, remembered ─────────────────────────────────
  useEffect(() => {
    abortRef.current?.abort();            // an answer for the previous note stops here
    setItems([]); setLastInsert(null); setInserted({}); setHistoryOpen(false);
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(THREAD_KEY(noteId)); } catch { /* private mode */ }
    setThreadId(saved);
  }, [noteId]);

  useEffect(() => {
    if (!threadId) return;
    let live = true;
    fetch(`/api/threads/${threadId}`).then((r) => (r.ok ? r.json() : null)).then((t) => {
      if (!live || !t) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setItems((t.messages ?? []).map((m: any) => m.role === "user"
        ? { kind: "user", id: uid(), content: m.content }
        : { kind: "assistant", id: uid(), content: m.content, citations: [] }));
    }).catch(() => {});
    return () => { live = false; };
  }, [threadId]);

  const rememberThread = useCallback((id: string | null) => {
    setThreadId(id);
    try {
      if (id) window.localStorage.setItem(THREAD_KEY(noteId), id);
      else window.localStorage.removeItem(THREAD_KEY(noteId));
    } catch { /* private mode */ }
  }, [noteId]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { if (focusNonce) inputRef.current?.focus(); }, [focusNonce]);

  const menu = matchJobs(input, jobs);
  useEffect(() => { setMenuIndex(0); }, [input]);

  const scrollDown = () => requestAnimationFrame(() =>
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));

  // ── one turn ──────────────────────────────────────────────────────────────
  const run = useCallback(async (shown: string, extra: { job?: string; focus?: string; approvals?: string[] } = {}) => {
    if (streaming) return;
    lastQueryRef.current = shown;
    const answerId = uid();
    const history = items.filter((i) => i.kind === "user" || i.kind === "assistant")
      .map((i) => ({ role: i.kind, content: (i as { content: string }).content }));
    setItems((prev) => [...prev, { kind: "user", id: uid(), content: shown },
      { kind: "assistant", id: answerId, content: "", citations: [], streaming: !extra.job }]);
    setStreaming(true);
    scrollDown();

    const ctl = new AbortController();
    abortRef.current = ctl;
    const patchAnswer = (fn: (a: Extract<Item, { kind: "assistant" }>) => Extract<Item, { kind: "assistant" }>) =>
      setItems((prev) => prev.map((it) => it.kind === "assistant" && it.id === answerId ? fn(it) : it));
    const before = (item: Item) => setItems((prev) => {
      const i = prev.findIndex((p) => p.id === answerId);
      return i < 0 ? [...prev, item] : [...prev.slice(0, i), item, ...prev.slice(i)];
    });
    let jobItemId: string | null = null;
    const patchJob = (fn: (j: JobState) => JobState) =>
      setItems((prev) => prev.map((it) => it.kind === "job" && it.id === jobItemId ? { ...it, job: fn(it.job) } : it));

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId, query: shown, mode,
          messages: [...history, { role: "user", content: shown }],
          approvals: extra.approvals ?? [],
          current_note_id: noteId, surface: "workspace",
          job: extra.job ?? null, focus: extra.focus ?? "",
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let ev: any;
          try { ev = JSON.parse(raw); } catch { continue; }
          switch (ev.type) {
            case "text": patchAnswer((a) => ({ ...a, content: a.content + ev.content })); scrollDown(); break;
            case "context":
            case "citations": if (ev.citations) patchAnswer((a) => ({ ...a, citations: ev.citations })); break;
            case "skill_active": before({ kind: "skill", id: uid(), name: ev.name }); break;
            case "tool_call": before({ kind: "tool", id: ev.id, tool: ev.tool, args: ev.args ?? {} }); break;
            case "tool_result":
              setItems((prev) => prev.map((it) => it.kind === "tool" && it.id === ev.id ? { ...it, summary: ev.summary } : it));
              break;
            case "tool_denied":
              setItems((prev) => prev.map((it) => it.kind === "tool" && it.id === ev.id
                ? { ...it, denied: ev.reason, requiresApproval: ev.requires_approval === true,
                    approvalKey: ev.approval_key ?? undefined } : it));
              break;
            case "skill_start":
              jobItemId = uid();
              before({ kind: "job", id: jobItemId, job: { skill: ev.skill, title: ev.title,
                focus: ev.focus ?? "", picked: !!ev.picked, startedAt: Date.now() } });
              scrollDown();
              break;
            case "result": patchJob((j) => ({ ...j, result: ev as JobResult })); scrollDown(); break;
            case "job_error": patchJob((j) => ({ ...j, error: ev.content })); break;
            case "error":
              if (jobItemId) patchJob((j) => (j.result ? j : { ...j, error: ev.content }));
              else before({ kind: "error", id: uid(), content: ev.content });
              break;
            case "done": if (ev.thread_id) rememberThread(ev.thread_id); break;
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        before({ kind: "error", id: uid(), content: e instanceof Error ? e.message : "The AI did not answer" });
    } finally {
      // A job-only turn leaves no text: drop the empty answer bubble.
      setItems((prev) => prev.filter((it) => !(it.kind === "assistant" && it.id === answerId && !it.content))
        .map((it) => it.kind === "assistant" && it.id === answerId ? { ...it, streaming: false } : it));
      setStreaming(false);
      if (abortRef.current === ctl) abortRef.current = null;
    }
  }, [streaming, items, threadId, mode, noteId, rememberThread]);

  const send = useCallback((override?: string) => {
    const q = (override ?? input).trim();
    if (!q || streaming) return;
    setInput("");
    const cmd = parseCommand(q, jobs);
    run(q, cmd ? { job: cmd.skill, focus: cmd.focus } : {});
  }, [input, streaming, jobs, run]);

  /** Confirm re-asks the last question carrying this one approval — the key is
   *  minted by the server's gate, never by the model. */
  const approve = useCallback((key: string) => {
    if (lastQueryRef.current) run(lastQueryRef.current, { approvals: [key] });
  }, [run]);

  // A job asked for from the editor's "/" menu runs as if typed — after any
  // answer in progress has finished (the effect re-runs when streaming ends).
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!request || request.nonce === lastNonce.current || streaming) return;
    lastNonce.current = request.nonce;
    run(`/${request.skill}${request.focus ? " " + request.focus : ""}`,
        { job: request.skill, focus: request.focus ?? "" });
  }, [request, streaming, run]);

  const insert = useCallback((itemId: string, html: string, sourceIds: string[], how: "append" | "replace") => {
    onInsert(html, sourceIds, how);
    setInserted((prev) => ({ ...prev, [itemId]: how }));
    setLastInsert(itemId);
  }, [onInsert]);

  const undo = useCallback((itemId: string) => {
    if (!onUndo()) return;
    setInserted((prev) => { const n = { ...prev }; delete n[itemId]; return n; });
    setLastInsert(null);
  }, [onUndo]);

  const newChat = () => { abortRef.current?.abort(); rememberThread(null); setItems([]); setLastInsert(null); setInserted({}); };

  const Inserted = ({ id }: { id: string }) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11.5px] text-emerald-600">{inserted[id] === "replace" ? "Note replaced" : "Added to the note"}</span>
      {lastInsert === id && (
        <button onClick={() => undo(id)}
          className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] text-indigo-600 hover:bg-indigo-500/10">
          <Undo2 size={11} /> Undo
        </button>
      )}
    </span>
  );

  return (
    <div className="relative h-full flex flex-col min-w-0 rounded-2xl overflow-hidden bg-white/80 dark:bg-white/[0.02]
      ring-1 ring-gray-200/70 dark:ring-white/10">
      {historyOpen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-[#eeeefc] dark:bg-[#0f0f1a]">
          <ThreadHistory
            activeThreadId={threadId}
            onSelect={(id) => { rememberThread(id); setHistoryOpen(false); }}
            onClose={() => setHistoryOpen(false)}
            onNew={() => { newChat(); setHistoryOpen(false); }}
          />
        </div>
      )}

      <div className="flex items-center gap-1 px-2.5 h-[48px] shrink-0 border-b border-gray-100 dark:border-white/5">
        <span className="w-7 h-7 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
          <MessagesSquare size={15} />
        </span>
        <div className="min-w-0 flex-1 pl-1">
          <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-50 leading-tight">AI</p>
          <p className="text-[11px] text-gray-400 leading-tight truncate">This note, your brain · / for a job</p>
        </div>
        <button onClick={() => setHistoryOpen(true)} title="Past conversations"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/5">
          <History size={14} />
        </button>
        <button onClick={newChat} title="New conversation"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-black/5 dark:hover:bg-white/5">
          <SquarePen size={14} />
        </button>
        <button onClick={onClose} title="Collapse the AI panel"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/5">
          <PanelRightClose size={14} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3" role="log" aria-live="polite">
        {items.length === 0 && (
          <div className="ws-rise space-y-3">
            <p className="text-[12.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
              Ask about this note&apos;s sources — answers cite the exact page — or about
              anything in your brain. Or run a job on all the sources:
            </p>
            <div className="flex flex-col gap-1.5">
              {jobs.map((j) => (
                <button key={j.skill} disabled={!!j.runnable || streaming}
                  onClick={() => run(`/${j.skill}`, { job: j.skill, focus: "" })}
                  title={j.runnable ?? j.description}
                  className="group flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left
                    bg-gray-100/70 dark:bg-white/[0.05] hover:ring-1 hover:ring-indigo-400/40
                    disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                  <span className="text-[12.5px] font-medium text-gray-700 dark:text-gray-200">/{j.skill}</span>
                  <span className="text-[11px] text-gray-400 truncate flex-1">{j.runnable ?? j.description}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{jobPrice(j)}</span>
                  <ChevronRight size={12} className="text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STARTERS.map((q) => (
                <button key={q} onClick={() => send(q)}
                  className="px-2.5 h-7 rounded-full text-[12px] text-gray-600 dark:text-gray-300
                    bg-gray-100/80 dark:bg-white/[0.06] hover:text-indigo-600 transition-colors">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {items.map((it) => {
          if (it.kind === "user") return (
            <div key={it.id} className="flex justify-end">
              <div className="ws-accent max-w-[85%] px-3 py-1.5 rounded-2xl rounded-br-md text-[13px] leading-relaxed whitespace-pre-wrap">
                {it.content}
              </div>
            </div>
          );
          if (it.kind === "skill") return <SkillBadge key={it.id} name={it.name} />;
          if (it.kind === "tool") return (
            <ToolEvent key={it.id} tool={it.tool} args={it.args} summary={it.summary}
              deniedReason={it.denied} requiresApproval={it.requiresApproval}
              onApprove={it.approvalKey ? () => approve(it.approvalKey!) : undefined} />
          );
          if (it.kind === "error") return (
            <p key={it.id} className="text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 rounded-xl px-3 py-2">
              {it.content}
            </p>
          );
          if (it.kind === "job") return (
            <JobCard key={it.id} job={it.job}
              applied={inserted[it.id]} canUndo={lastInsert === it.id}
              onApply={(how) => it.job.result && insert(it.id, it.job.result.html, it.job.result.source_ids, how)}
              onUndo={() => undo(it.id)} />
          );
          return (
            <div key={it.id} className="group mr-1">
              {it.content ? (
                <Answer content={it.content} citations={it.citations} colorIndex={colorIndex} onCitation={onCitation} />
              ) : (
                <span className="inline-flex items-center gap-1 text-gray-400" aria-label="Thinking">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                      style={{ animationDelay: `${d * 140}ms` }} />
                  ))}
                </span>
              )}
              {it.content && !it.streaming && (
                <div className="mt-1 flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                  {inserted[it.id] ? <Inserted id={it.id} /> : (
                    <button onClick={() => insert(it.id, answerToHtml(it.content, it.citations), [], "append")}
                      title="Add this answer to the end of the note"
                      className="h-6 px-2 rounded-full text-[11.5px] text-gray-500 hover:text-indigo-600 hover:bg-indigo-500/10">
                      Insert into note
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative p-2.5 shrink-0 border-t border-gray-100 dark:border-white/5">
        {menu.length > 0 && (
          <div role="listbox" className="absolute left-2.5 right-2.5 bottom-full mb-1 z-10 rounded-xl
            bg-white dark:bg-[#171a23] ring-1 ring-gray-200 dark:ring-white/10 shadow-lg overflow-hidden">
            {menu.map((j, k) => (
              <button key={j.skill} role="option" aria-selected={k === menuIndex}
                onMouseDown={(e) => { e.preventDefault(); setInput(`/${j.skill} `); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px]
                  ${k === menuIndex ? "bg-indigo-500/10" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                <span className="font-medium text-gray-800 dark:text-gray-100">/{j.skill}</span>
                <span className="text-[11px] text-gray-400 truncate flex-1">{j.runnable ?? j.description}</span>
                <span className="text-[11px] text-gray-400 shrink-0">{jobPrice(j)}</span>
              </button>
            ))}
            {mode === "local" && (
              <p className="px-3 py-1.5 text-[10.5px] text-gray-400 border-t border-gray-100 dark:border-white/5">
                Jobs run on the cloud model, even in Local mode.
              </p>
            )}
          </div>
        )}
        <div className="flex items-end gap-1.5 p-1.5 rounded-2xl bg-gray-100/70 dark:bg-white/[0.06]
          ring-1 ring-transparent focus-within:ring-indigo-400/50 transition-shadow">
          <textarea
            ref={inputRef}
            aria-label="Message the AI"
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] outline-none
              text-gray-800 dark:text-gray-100 placeholder:text-gray-400 max-h-32"
            rows={1}
            placeholder="Ask, or / for a job…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (menu.length) {
                if (e.key === "ArrowDown") { e.preventDefault(); setMenuIndex((k) => (k + 1) % menu.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setMenuIndex((k) => (k - 1 + menu.length) % menu.length); return; }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); setInput(`/${menu[menuIndex].skill} `); return; }
                if (e.key === "Escape") { setInput(""); return; }
              }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <button onClick={() => setMode(mode === "api" ? "local" : "api")}
            title={mode === "api" ? "Cloud model — click for the local one" : "Local model — click for the cloud one"}
            className="shrink-0 h-8 px-2 inline-flex items-center gap-1 rounded-xl text-[11px] text-gray-500
              hover:text-indigo-600 hover:bg-white dark:hover:bg-white/10 transition-colors">
            {MODES.find((m) => m.value === mode)?.icon}
            {MODES.find((m) => m.value === mode)?.label}
          </button>
          <button onClick={() => send()} disabled={streaming || !input.trim()} title="Send"
            className="ws-accent shrink-0 w-8 h-8 flex items-center justify-center rounded-xl
              disabled:opacity-30 disabled:shadow-none transition-all duration-150 active:scale-95">
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

