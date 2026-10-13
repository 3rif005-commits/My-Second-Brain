"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useNotion } from "@/context/NotionContext";
import { CornerDownLeft, FileText, Search, Send, X } from "lucide-react";
import { useNotes } from "@/lib/hooks/useNotes";
import { cx } from "@/components/ui/cx";

/** Matched terms in blue, weight 500, no background (shell.md §3). */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="font-medium text-accent">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

interface SearchResult {
  id: string;
  title: string;
  icon: string;
  topics: string[];
  mastery_status: string;
  updated_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SearchModal({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const notion = useNotion();
  const { notes } = useNotes();
  // With no query, quick find lists recently visited pages (Notion's "Recent").
  const recent = notes
    .filter((n) => n.last_viewed_at)
    .sort((a, b) => new Date(b.last_viewed_at!).getTime() - new Date(a.last_viewed_at!).getTime())
    .slice(0, 8);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/notes/search?q=${encodeURIComponent(query.trim())}`
        );
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
        setSelectedIndex(0);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function navigate(id: string) {
    router.push(`/brain/${id}`);
    onClose();
  }

  // Commands (⌘P, then type "notion"): the keyboard route into Send to Notion (DESIGN §7.1).
  const noteId = pathname.match(/^\/brain\/([0-9a-f-]{36})$/)?.[1];
  const commands = /notion|^>/i.test(query) ? [
    ...(noteId ? [{ id: "send-page", label: "Send to Notion: current page", run: () => notion.open({ note_ids: [noteId] }) }] : []),
    { id: "send-all", label: "Send whole brain to Notion", run: () => notion.open({ all: true }, "whole brain") },
    { id: "activity", label: "Open Notion activity", run: () => router.push("/brain/settings/notion?tab=activity") },
  ] : [];

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const count = query.trim() ? commands.length + results.length : recent.length;
      setSelectedIndex((i) => Math.min(i + 1, count - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter") {
      if (!query.trim()) { if (recent[selectedIndex]) navigate(recent[selectedIndex].id); return; }
      if (selectedIndex < commands.length) { commands[selectedIndex].run(); onClose(); }
      else if (results[selectedIndex - commands.length]) navigate(results[selectedIndex - commands.length].id);
    }
  }

  if (!open) return null;

  const row = (selected: boolean) =>
    cx(
      "flex w-full items-center gap-2 rounded-xl px-2 text-left transition-colors duration-instant",
      selected ? "bg-surface-active" : "hover:bg-surface-active",
    );

  // Notion's quick find: a frosted card at 9vh, centred over the whole window, no
  // dimmed backdrop, radius 20px (shell.md §3). The preview pane is not built.
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[9vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Search"
        className="flex max-h-[min(640px,80vh)] w-full max-w-[755px] flex-col overflow-hidden rounded-[20px] bg-surface-search shadow-modal backdrop-blur-[40px]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="m-3 flex items-center gap-2">
          <Search size={20} className="shrink-0 text-ink-icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or jump to a page…"
            aria-label="Search"
            className="flex-1 bg-transparent text-base leading-6 text-ink outline-none placeholder:text-ink-placeholder"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="flex size-6 items-center justify-center rounded-full text-ink-icon hover:bg-surface-active"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {query.trim() ? (
            <>
              {commands.length > 0 && (
                <div className="mx-2 mb-2 mt-1.5 text-xs font-medium text-ink-secondary">Commands</div>
              )}
              {commands.map((c, i) => (
                <button key={c.id} onClick={() => { c.run(); onClose(); }} className={cx(row(i === selectedIndex), "h-9 text-sm font-medium text-ink")}>
                  <Send size={18} className="shrink-0 text-ink-icon" />
                  <span className="flex-1">{c.label}</span>
                  {i === selectedIndex && <CornerDownLeft size={14} className="text-ink-icon" />}
                </button>
              ))}
              {(results.length > 0 || loading) && (
                <div className="mx-2 mb-2 mt-1.5 text-xs font-medium text-ink-secondary">Pages</div>
              )}
              {loading && results.length === 0 && <div className="px-2 py-6 text-center text-sm text-ink-tertiary">Searching…</div>}
              {!loading && results.length === 0 && commands.length === 0 && (
                <div className="px-2 py-8 text-center text-sm text-ink-tertiary">No results</div>
              )}
              {results.map((note, i) => {
                const selected = i + commands.length === selectedIndex;
                return (
                  <button key={note.id} onClick={() => navigate(note.id)} className={cx(row(selected), "min-h-[55px] py-2")}>
                    <span className="flex size-5 shrink-0 items-center justify-center text-[16px] leading-none text-ink-icon">
                      {note.icon || <FileText size={18} strokeWidth={1.75} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-sidebar">
                        <Highlight text={note.title || "Untitled"} query={query} />
                      </span>
                      {note.topics?.length > 0 && (
                        <span className="mt-0.5 block truncate text-xs leading-[16.8px] text-ink-tertiary">
                          {note.topics.slice(0, 3).join(" · ")}
                        </span>
                      )}
                    </span>
                    {selected && <CornerDownLeft size={14} className="shrink-0 text-ink-icon" />}
                  </button>
                );
              })}
            </>
          ) : recent.length > 0 ? (
            <>
              <div className="mx-2 mb-2 mt-1.5 text-xs font-medium text-ink-secondary">Recent</div>
              {recent.map((note, i) => (
                <button key={note.id} onClick={() => navigate(note.id)} className={cx(row(i === selectedIndex), "h-9")}>
                  <span className="flex size-5 shrink-0 items-center justify-center text-[16px] leading-none text-ink-icon">
                    {note.icon || <FileText size={18} strokeWidth={1.75} />}
                  </span>
                  <span className="truncate text-sm font-medium text-ink-sidebar">{note.title || "Untitled"}</span>
                  <span className="flex-1" />
                  {i === selectedIndex && <CornerDownLeft size={14} className="shrink-0 text-ink-icon" />}
                </button>
              ))}
            </>
          ) : (
            <div className="px-2 py-3 text-sm text-ink-tertiary">Type to search across all your notes</div>
          )}
        </div>
      </div>
    </div>
  );
}
