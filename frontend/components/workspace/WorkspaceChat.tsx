"use client";

// Grounded chat over one note's sources — answers only from what's attached to
// this note, every claim carrying a [n] citation that opens the right source at
// the exact spot. Rendered as a drawer over the note pane: a third column in a
// compact layout leaves nothing readable.
import { useCallback, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { anchorLabel, sourceColor, type Citation } from "@/lib/workspace";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

interface WorkspaceChatProps {
  noteId: string;
  colorIndex: Map<string, number>;   // resource_id → order_index, for the dots
  onCitation: (citation: Citation) => void;
  onClose: () => void;
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

export function WorkspaceChat({ noteId, colorIndex, onCitation, onClose }: WorkspaceChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || streaming) return;
    setInput("");
    const history = [...messages, { role: "user" as const, content: q }];
    setMessages([...history, { role: "assistant", content: "", citations: [] }]);
    setStreaming(true);

    try {
      const res = await fetch(`/api/ws/notes/${noteId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let citations: Citation[] = [];

      const apply = () => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: text, citations };
          return next;
        });
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      };

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
          if (data.type === "text") { text += data.content; apply(); }
          else if (data.type === "context" || data.type === "citations") {
            citations = data.citations ?? []; apply();
          } else if (data.type === "error") {
            text += `\n⚠️ ${data.content}`; apply();
          }
        }
      }
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: `⚠️ ${e instanceof Error ? e.message : "Chat failed"}`,
        };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }, [input, messages, streaming, noteId]);

  return (
    <div className="absolute inset-y-0 right-0 z-30 w-[380px] max-w-full flex flex-col border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          Ask your sources
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 leading-relaxed">
            Ask anything about the sources attached to this note. Answers are
            grounded in them — every claim carries a clickable citation that opens
            the right source at the exact page or timestamp.
          </p>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 px-3 py-2 rounded-xl bg-indigo-500 text-white text-sm">
              {m.content}
            </div>
          ) : (
            <div key={i} className="mr-4">
              {m.content ? (
                <CitedText
                  content={m.content}
                  citations={m.citations ?? []}
                  colorIndex={colorIndex}
                  onCitation={onCitation}
                />
              ) : (
                <span className="text-xs text-gray-400 animate-pulse">Thinking…</span>
              )}
            </div>
          )
        )}
      </div>

      <div className="p-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-400 text-gray-800 dark:text-gray-200 max-h-32"
            rows={1}
            placeholder="Ask about your sources…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="p-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-700 transition-colors"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
