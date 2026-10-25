"use client";

// One way to open anything in a session: the + on a pane, or Ctrl+K. Lists what
// is in the session but closed, then your other notes, then adding a file or a
// link. Enter opens here; Alt+Enter opens beside.
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Link2, Search, Sparkles, Upload } from "lucide-react";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { ACCEPTED_WORKSPACE_FILES, sourceColor, wsApi, type LibrarySource } from "@/lib/workspace";

export interface PickerItem {
  key: string;
  title: string;
  kind: "source" | "note" | "ask";
  /** Grey text on the right: "source", "note · 18 Oct", "from Lecture 9". */
  hint?: string;
  color?: string;
}

interface NoteRow { id: string; title: string | null; updated_at?: string }

interface OpenPickerProps {
  /** In the session but not open in any pane. */
  session: PickerItem[];
  /** Notes already in the session (left out of "Your notes"). */
  sessionNoteIds: Set<string>;
  /** Sources already in the session (left out of "Sources in other notes"). */
  sessionSourceIds: Set<string>;
  onOpen: (key: string, beside: boolean) => void;
  onOpenNote: (id: string, title: string, beside: boolean) => void;
  onAddFiles: (files: File[]) => void;
  onAddUrl: (url: string) => void;
  onClose: () => void;
}

interface Row {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: (beside: boolean) => void;
}

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

export function OpenPicker({ session, sessionNoteIds, sessionSourceIds, onOpen, onOpenNote, onAddFiles, onAddUrl, onClose }: OpenPickerProps) {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [sel, setSel] = useState(0);
  const [library, setLibrary] = useState<LibrarySource[]>([]);
  const [askUrl, setAskUrl] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/notes").then((r) => (r.ok ? r.json() : [])).then((d) => setNotes(Array.isArray(d) ? d : []))
      .catch(() => setNotes([]));
  }, []);

  // Sources from other notes: newest first, or matching what's typed.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      wsApi.librarySources(query.trim()).then((r) => { if (live) setLibrary(r); }).catch(() => {});
    }, query ? 200 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const hit = (s: string) => !q || s.toLowerCase().includes(q);
    const out: Row[] = [];
    for (const it of session) {
      if (!hit(it.title)) continue;
      out.push({
        id: it.key, group: "In this session", label: it.title, hint: it.hint,
        icon: it.kind === "note" ? <FileText size={16} />
          : it.kind === "ask" ? <Sparkles size={16} />
          : <span className="mx-1 size-2 rounded-full" style={{ backgroundColor: it.color }} />,
        run: (beside) => onOpen(it.key, beside),
      });
    }
    const others = (notes ?? [])
      .filter((n) => !sessionNoteIds.has(n.id) && hit(n.title || "Untitled"))
      .slice(0, q ? 12 : 6);
    for (const n of others) {
      out.push({
        id: `note:${n.id}`, group: q ? "Your notes" : "Recent notes", label: n.title || "Untitled",
        hint: day(n.updated_at), icon: <FileText size={16} />,
        run: (beside) => onOpenNote(n.id, n.title || "Untitled", beside),
      });
    }
    const foreign = library
      .filter((s) => !sessionSourceIds.has(s.id) && !sessionNoteIds.has(s.note_id))
      .slice(0, q ? 8 : 4);
    for (const s of foreign) {
      out.push({
        id: `src:${s.id}`, group: "Sources in other notes", label: s.title, hint: `from ${s.note_title}`,
        icon: <span className="mx-1 size-2 rounded-full" style={{ backgroundColor: sourceColor(s.order_index) }} />,
        run: (beside) => onOpen(`s:${s.id}`, beside),
      });
    }
    out.push({ id: "upload", group: "Add to this session", label: "Upload a file", icon: <Upload size={16} />,
      run: () => fileRef.current?.click() });
    out.push({ id: "link", group: "Add to this session", label: "Paste a link", hint: "web page or YouTube",
      icon: <Link2 size={16} />, run: () => setAskUrl(true) });
    return out;
  }, [query, session, notes, library, sessionNoteIds, sessionSourceIds, onOpen, onOpenNote]);

  useEffect(() => { setSel(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); rows[sel]?.run(e.altKey); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  let lastGroup = "";
  return (
    <div className="flex flex-col" onKeyDown={onKeyDown}>
      <label className="m-1 mb-0 flex h-8 items-center gap-2 rounded-md bg-surface-field px-2 text-ink-secondary">
        <Search size={14} className="shrink-0" />
        <span className="sr-only">Open a note or a source</span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Open here… any note or source"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
        />
      </label>
      <div ref={listRef} role="listbox" aria-label="Open" className="max-h-[min(360px,55vh)] overflow-y-auto p-1">
        {rows.map((r, i) => {
          const header = r.group !== lastGroup ? r.group : null;
          lastGroup = r.group;
          return (
            <div key={r.id}>
              {header && <div className="px-2 pb-1 pt-2 text-xs font-medium text-ink-secondary">{header}</div>}
              <button
                type="button"
                role="option"
                aria-selected={i === sel}
                data-row={i}
                onMouseEnter={() => setSel(i)}
                onClick={(e) => r.run(e.altKey)}
                className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-ink ${
                  i === sel ? "bg-surface-hover" : ""}`}
              >
                <span className="flex w-5 shrink-0 items-center justify-center text-ink-icon">{r.icon}</span>
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                {r.hint && <span className="shrink-0 text-xs text-ink-tertiary">{r.hint}</span>}
              </button>
            </div>
          );
        })}
        {notes === null && <div className="px-2 py-1.5 text-xs text-ink-tertiary">Loading your notes…</div>}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-ink-tertiary">
        <span><kbd className="font-sans">↵</kbd> open here</span>
        <span><kbd className="font-sans">Alt+↵</kbd> open beside</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPTED_WORKSPACE_FILES}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) { onAddFiles(files); onClose(); }
        }}
      />
      <PromptDialog
        open={askUrl}
        title="Add a source"
        label="Link"
        placeholder="https://… (a web page or a YouTube video)"
        confirmLabel="Add"
        onSubmit={(v) => { setAskUrl(false); if (v.trim()) { onAddUrl(v.trim()); onClose(); } }}
        onCancel={() => setAskUrl(false)}
      />
    </div>
  );
}
