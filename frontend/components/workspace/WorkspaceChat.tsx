"use client";

// The workspace's AI panel: ask about the sources, or run a job (skill).
//
// User decision (2026-09-24): jobs moved from buttons into the chat, the way
// Claude Code runs skills — type /study-guide, /flashcards, /compare-sources
// (a menu appears on "/"), or just ask ("make me flashcards") and the model
// picks the job. A job's result is a card here: preview it, then Insert (add
// to the end of the note) or Replace (swap the note for it). Nothing touches
// the note until one of those is clicked, and Undo takes it back.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, Eye, EyeOff, MessagesSquare, PanelRightClose, Sparkles, Undo2 } from "lucide-react";
import { anchorLabel, sourceColor, type Citation } from "@/lib/workspace";
import {
  jobPrice, matchJobs, parseCommand, resultSummary, PREVIEW_CSS,
  type ChatJob, type JobResult,
} from "@/lib/chatJobs";

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
  /** How the result reached the note, once it did. */
  applied?: "append" | "replace";
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  job?: JobState;
}

export interface JobRequest { skill: string; focus?: string; nonce: number }

interface WorkspaceChatProps {
  noteId: string;
  colorIndex: Map<string, number>;   // resource_id → order_index, for the dots
  onCitation: (citation: Citation) => void;
  onClose: () => void;
  /** Put a job's result into the note. */
  onInsert: (html: string, sourceIds: string[], mode: "append" | "replace") => void;
  /** Take the last inserted result back out. False when it cannot (edited since). */
  onUndo: () => boolean;
  /** A job asked for from outside the chat (the editor's "/" menu). */
  request?: JobRequest | null;
  /** The jobs this note offers (fetched once, by the shell). */
  jobs: ChatJob[];
}

/** Render assistant text with [n] markers replaced by clickable chips. */
function CitedText({ content, citations, colorIndex, onCitation }: {
  content: string;
  citations: Citation[];
  colorIndex: Map<string, number>;
  onCitation: (c: Citation) => void;
}) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const parts = content.split(/(\[\d+\])/g);
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800 dark:text-gray-200">
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (!m) return <span key={i}>{part}</span>;
        const c = byN.get(Number(m[1]));
        if (!c) return null; // hallucinated marker — never rendered
        const idx = colorIndex.get(c.resource_id);
        return (
          <button
            key={i}
            onClick={() => onCitation(c)}
            title={`${c.title} — ${anchorLabel(c.anchor_type, c.anchor_start)}\n${c.snippet ?? ""}`}
            className="inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 text-[10px] font-semibold hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors cursor-pointer"
          >
            {/* No dot rather than a wrong dot: a citation whose source is gone
                must not borrow the first source's colour. */}
            {idx !== undefined && (
              <span className="w-1 h-1 rounded-full"
                    style={{ backgroundColor: sourceColor(idx) }} />
            )}
            {m[1]}
          </button>
        );
      })}
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
function JobCard({ job, onApply, onUndo }: {
  job: JobState;
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
            {!job.applied ? (
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
                  {job.applied === "append" ? "Added to the note" : "Note replaced"}
                </span>
                <button onClick={onUndo}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] text-indigo-600 hover:bg-indigo-500/10">
                  <Undo2 size={12} /> Undo
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkspaceChat({
  noteId, colorIndex, onCitation, onClose, onInsert, onUndo, request, jobs,
}: WorkspaceChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages([]); }, [noteId]);

  const menu = matchJobs(input, jobs);
  useEffect(() => { setMenuIndex(0); }, [input]);

  const patchLast = useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  }, []);

  const run = useCallback(async (shown: string, body: Record<string, unknown>) => {
    if (streaming) return;
    const history = [...messages, { role: "user" as const, content: shown }];
    setMessages([...history, { role: "assistant", content: "", citations: [] }]);
    setStreaming(true);
    try {
      const res = await fetch(`/api/ws/notes/${noteId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.filter((m) => !m.job).map((m) => ({ role: m.role, content: m.content })),
          ...body,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") continue;
          let data;
          try { data = JSON.parse(raw); } catch { continue; }
          if (data.type === "text") patchLast((m) => ({ ...m, content: m.content + data.content }));
          else if (data.type === "context" || data.type === "citations")
            patchLast((m) => ({ ...m, citations: data.citations ?? [] }));
          else if (data.type === "skill_start")
            patchLast((m) => ({ ...m, job: { skill: data.skill, title: data.title, focus: data.focus ?? "",
              picked: !!data.picked, startedAt: Date.now() } }));
          else if (data.type === "result")
            patchLast((m) => ({ ...m, job: { ...(m.job as JobState), result: data as JobResult } }));
          else if (data.type === "error")
            patchLast((m) => m.job
              ? { ...m, job: { ...m.job, error: data.content } }
              : { ...m, content: m.content + `\n⚠️ ${data.content}` });
        }
      }
    } catch (e) {
      patchLast((m) => ({ ...m, content: `⚠️ ${e instanceof Error ? e.message : "Chat failed"}` }));
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming, noteId, patchLast]);

  const send = useCallback((override?: string) => {
    const q = (override ?? input).trim();
    if (!q || streaming) return;
    setInput("");
    const cmd = parseCommand(q, jobs);
    if (cmd) run(q, { skill: cmd.skill, focus: cmd.focus });
    else run(q, {});
  }, [input, streaming, jobs, run]);

  // A job asked for from the editor's "/" menu arrives here and runs as if typed.
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!request || request.nonce === lastNonce.current || streaming) return;
    lastNonce.current = request.nonce;
    run(`/${request.skill}${request.focus ? " " + request.focus : ""}`,
        { skill: request.skill, focus: request.focus ?? "" });
  }, [request, streaming, run]);

  const apply = useCallback((index: number, mode: "append" | "replace") => {
    const r = messages[index]?.job?.result;
    if (!r) return;
    onInsert(r.html, r.source_ids, mode);
    setMessages((prev) => prev.map((m, i) => i === index && m.job ? { ...m, job: { ...m.job, applied: mode } } : m));
  }, [messages, onInsert]);

  const undo = useCallback((index: number) => {
    if (!onUndo()) return;
    setMessages((prev) => prev.map((m, i) => i === index && m.job ? { ...m, job: { ...m.job, applied: undefined } } : m));
  }, [onUndo]);

  const pick = (job: ChatJob) => setInput(`/${job.skill} `);

  return (
    <div className="h-full flex flex-col min-w-0 rounded-2xl bg-white/80 dark:bg-white/[0.02]
      ring-1 ring-gray-200/70 dark:ring-white/10">
      <div className="flex items-center gap-2 px-3 h-[48px] shrink-0 border-b border-gray-100 dark:border-white/5">
        <span className="w-7 h-7 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
          <MessagesSquare size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-50 leading-tight">AI</p>
          <p className="text-[11px] text-gray-400 leading-tight truncate">Ask, or type / for a job</p>
        </div>
        <button onClick={onClose} title="Collapse the AI panel"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-gray-400
            hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
          <PanelRightClose size={15} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="ws-rise space-y-3">
            <p className="text-[12.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
              Ask anything about this note&apos;s sources — answers cite the exact page.
              Or run a job on all of them:
            </p>
            <div className="flex flex-col gap-1.5">
              {jobs.map((j) => (
                <button key={j.skill} disabled={!!j.runnable || streaming}
                  onClick={() => run(`/${j.skill}`, { skill: j.skill, focus: "" })}
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
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="ws-accent max-w-[85%] px-3 py-1.5 rounded-2xl rounded-br-md text-[13px] leading-relaxed whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ) : m.job ? (
            <JobCard key={i} job={m.job} onApply={(mode) => apply(i, mode)} onUndo={() => undo(i)} />
          ) : (
            <div key={i} className="mr-2">
              {m.content ? (
                <CitedText content={m.content} citations={m.citations ?? []}
                  colorIndex={colorIndex} onCitation={onCitation} />
              ) : (
                <span className="inline-flex items-center gap-1 text-gray-400" aria-label="Thinking">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                      style={{ animationDelay: `${d * 140}ms` }} />
                  ))}
                </span>
              )}
            </div>
          )
        )}
      </div>

      <div className="relative p-2.5 shrink-0 border-t border-gray-100 dark:border-white/5">
        {menu.length > 0 && (
          <div role="listbox" className="absolute left-2.5 right-2.5 bottom-full mb-1 z-10 rounded-xl
            bg-white dark:bg-[#171a23] ring-1 ring-gray-200 dark:ring-white/10 shadow-lg overflow-hidden">
            {menu.map((j, k) => (
              <button key={j.skill} role="option" aria-selected={k === menuIndex}
                onMouseDown={(e) => { e.preventDefault(); pick(j); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px]
                  ${k === menuIndex ? "bg-indigo-500/10" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                <span className="font-medium text-gray-800 dark:text-gray-100">/{j.skill}</span>
                <span className="text-[11px] text-gray-400 truncate flex-1">{j.runnable ?? j.description}</span>
                <span className="text-[11px] text-gray-400 shrink-0">{jobPrice(j)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 p-1.5 rounded-2xl bg-gray-100/70 dark:bg-white/[0.06]
          ring-1 ring-transparent focus-within:ring-indigo-400/50 transition-shadow">
          <textarea
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
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); pick(menu[menuIndex]); return; }
                if (e.key === "Escape") { setInput(""); return; }
              }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
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
