"use client";

// One way to open anything in a session: the + on a pane, or Ctrl+K. A search box,
// then ONE list (what's in the session but closed, your other notes, sources from
// other notes), then a bar that is always in reach: new note, upload, paste a link.
// Enter opens here; Alt+Enter (or the button on the row) opens beside. The footer says
// what Enter will do for the highlighted row, so it is never wrong for an action.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FilePlus, FileText, Link2, PanelRight, Search, Sparkles, Upload, X } from "lucide-react";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { ACCEPTED_WORKSPACE_FILES, sourceColor, wsApi, type LibrarySource } from "@/lib/workspace";

export interface PickerItem {
  key: string;
  title: string;
  kind: "source" | "note" | "ask";
  /** Grey text on the right: "PDF", "session note", "from another note". */
  hint?: string;
  /** A shortcut drawn as keys on the right: "Ctrl+J". */
  keys?: string;
  color?: string;
}

interface NoteRow { id: string; title: string | null; updated_at?: string }

interface OpenPickerProps {
  /** In the session but not open in any pane. */
  session: PickerItem[];
  /** Notes already in the session (left out of "Recent notes"). */
  sessionNoteIds: Set<string>;
  /** Sources already in the session (left out of "From other notes"). */
  sessionSourceIds: Set<string>;
  onOpen: (key: string, beside: boolean) => void;
  onOpenNote: (id: string, title: string, beside: boolean) => void;
  onAddFiles: (files: File[]) => void;
  onAddUrl: (url: string) => void;
  onClose: () => void;
}

interface Row {
  id: string;
  /** Heading it sits under in the list; unused for the bar. */
  group: string;
  label: string;
  hint?: string;
  keys?: string;
  icon: React.ReactNode;
  /** What Enter does, for the footer. */
  enter: string;
  /** What Alt+Enter does; absent when the row has no "beside". */
  beside?: string;
  run: (beside: boolean) => void;
}

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-surface-chip px-1 font-sans text-[10.5px] font-medium leading-none text-ink-secondary">
      {children}
    </kbd>
  );
}

/** "Ctrl+J" → two keys. */
function Keys({ combo }: { combo: string }) {
  return <span className="flex shrink-0 items-center gap-0.5">{combo.split("+").map((k) => <Key key={k}>{k}</Key>)}</span>;
}

/** The part of the title you typed, in bold. */
function Match({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<span className="font-semibold">{text.slice(i, i + q.length)}</span>{text.slice(i + q.length)}</>;
}

export function OpenPicker({ session, sessionNoteIds, sessionSourceIds, onOpen, onOpenNote, onAddFiles, onAddUrl, onClose }: OpenPickerProps) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  /** The row you moved to (arrows or mouse); null = the resting choice. Held as an id so
   * rows arriving late never shift it. */
  const [selId, setSelId] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibrarySource[]>([]);
  const [askUrl, setAskUrl] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim();

  useEffect(() => {
    fetch("/api/notes").then((r) => (r.ok ? r.json() : [])).then((d) => setNotes(Array.isArray(d) ? d : []))
      .catch(() => setNotes([]));
  }, []);

  // Sources from other notes: newest first, or matching what's typed.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      wsApi.librarySources(q).then((r) => { if (live) setLibrary(r); }).catch(() => {});
    }, q ? 200 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [q]);

  /** An empty note, opened as a tab: here, or beside with Alt+Enter. */
  async function createNote(title: string, beside: boolean) {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(title ? { title } : {}),
      });
      if (!res.ok) throw new Error();
      const n = await res.json();
      onOpenNote(n.id, n.title || "Untitled", beside);
    } catch {
      setCreating(false);
    }
  }

  /** The list: things to open. */
  const rows = useMemo<Row[]>(() => {
    const lower = q.toLowerCase();
    const hit = (s: string) => !lower || s.toLowerCase().includes(lower);
    const open = { enter: "Open here", beside: "Open beside" };
    const out: Row[] = [];
    for (const it of session) {
      if (!hit(it.title)) continue;
      out.push({
        id: it.key, group: "In this session", label: it.title, hint: it.hint, keys: it.keys, ...open,
        icon: it.kind === "note" ? <FileText size={16} />
          : it.kind === "ask" ? <Sparkles size={16} className="text-accent" />
          : <span className="size-2 rounded-full" style={{ backgroundColor: it.color }} />,
        run: (beside) => onOpen(it.key, beside),
      });
    }
    const others = (notes ?? [])
      .filter((n) => !sessionNoteIds.has(n.id) && hit(n.title || "Untitled"))
      .slice(0, q ? 12 : 6);
    for (const n of others) {
      out.push({
        id: `note:${n.id}`, group: q ? "Your notes" : "Recent notes", label: n.title || "Untitled",
        hint: day(n.updated_at), icon: <FileText size={16} />, ...open,
        run: (beside) => onOpenNote(n.id, n.title || "Untitled", beside),
      });
    }
    const foreign = library
      .filter((s) => !sessionSourceIds.has(s.id) && !sessionNoteIds.has(s.note_id))
      .slice(0, q ? 8 : 4);
    for (const s of foreign) {
      out.push({
        id: `src:${s.id}`, group: "From other notes", label: s.title, hint: `from ${s.note_title}`, ...open,
        icon: <span className="size-2 rounded-full" style={{ backgroundColor: sourceColor(s.order_index) }} />,
        run: (beside) => onOpen(`s:${s.id}`, beside),
      });
    }
    return out;
  }, [q, session, notes, library, sessionNoteIds, sessionSourceIds, onOpen, onOpenNote]);

  /** The bar under the list: always there, never scrolls away. */
  const actions = useMemo<Row[]>(() => [
    {
      id: "new-note", group: "", label: creating ? "Creating…" : q ? `New “${q}”` : "New note",
      icon: <FilePlus size={15} className={q ? "text-accent" : undefined} />,
      enter: q ? `Create “${q}” here` : "Create here", beside: "Create beside",
      run: (beside) => void createNote(q, beside),
    },
    {
      id: "upload", group: "", label: "Upload file", icon: <Upload size={15} />,
      enter: "Choose files to add to this session", run: () => fileRef.current?.click(),
    },
    {
      id: "link", group: "", label: "Paste link", icon: <Link2 size={15} />,
      enter: "Add a web page or YouTube link to this session", run: () => setAskUrl(true),
    },
  ], [q, creating]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => [...rows, ...actions], [rows, actions]);
  const inBar = (i: number) => i >= rows.length;
  // At rest the first result is chosen; if typing found nothing, "New note" is, so Enter makes it.
  const found = selId ? all.findIndex((r) => r.id === selId) : -1;
  const sel = found >= 0 ? found : q && rows.length === 0 ? rows.length : 0;
  const current = all[sel];

  useEffect(() => { setSelId(null); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (askUrl) return; // the link dialog's keys bubble through React's tree to here
    const go =(i: number) => setSelId(all[Math.max(0, Math.min(all.length - 1, i))]?.id ?? null);
    if (e.key === "ArrowDown") { e.preventDefault(); if (!inBar(sel)) go(sel + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); go(inBar(sel) ? rows.length - 1 : sel - 1); }
    // The bar is a row of three: sideways only once you've stepped into it, so the
    // arrows still move the caret while you type.
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && selId && inBar(sel)) {
      e.preventDefault();
      go(Math.max(rows.length, sel + (e.key === "ArrowRight" ? 1 : -1)));
    }
    else if (e.key === "Enter") { e.preventDefault(); current?.run(e.altKey); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  const rowId = (i: number) => `${uid}-r${i}`;
  // Keep the search box focused when a row is clicked, so the keys keep working.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  let lastGroup = "";
  return (
    <div className="flex flex-col" onKeyDown={onKeyDown}>
      <label className="flex h-11 items-center gap-2.5 border-b border-line px-3 text-ink-icon">
        <span className="flex size-5 shrink-0 items-center justify-center"><Search size={16} /></span>
        <span className="sr-only">Open a note or a source</span>
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={`${uid}-list`}
          aria-activedescendant={rowId(sel)}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a note or source…"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={keepFocus}
            onClick={() => setQuery("")}
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-surface-active hover:text-ink"
          >
            <X size={13} />
          </button>
        ) : <Key>Esc</Key>}
      </label>

      <div ref={listRef} id={`${uid}-list`} role="listbox" aria-label="Open" className="max-h-[min(340px,50vh)] overflow-y-auto p-1">
        {rows.map((r, i) => {
          const header = r.group !== lastGroup ? r.group : null;
          lastGroup = r.group;
          const on = i === sel;
          return (
            <div key={r.id}>
              {header && <div className={`px-2 pb-1 text-xs font-medium text-ink-secondary ${i === 0 ? "pt-1.5" : "pt-3"}`}>{header}</div>}
              <div
                id={rowId(i)}
                role="option"
                aria-selected={on}
                data-row={i}
                onMouseMove={() => { if (selId !== r.id) setSelId(r.id); }}
                onMouseDown={keepFocus}
                onClick={(e) => r.run(e.altKey)}
                className={`flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-ink ${on ? "bg-surface-hover" : ""}`}
              >
                <span className="flex size-5 shrink-0 items-center justify-center text-ink-icon">{r.icon}</span>
                <span className="min-w-0 flex-1 truncate"><Match text={r.label} q={q} /></span>
                {r.hint && <span className="shrink-0 text-xs text-ink-tertiary">{r.hint}</span>}
                {r.keys && <Keys combo={r.keys} />}
                {/* The mouse's way to Alt+Enter: slides in on the row you point at. */}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  title="Open beside (Alt+↵)"
                  onMouseDown={keepFocus}
                  onClick={(e) => { e.stopPropagation(); r.run(true); }}
                  className={`flex h-5 shrink-0 items-center justify-center overflow-hidden rounded text-ink-icon transition-[width,opacity] duration-150 hover:bg-surface-active hover:text-ink ${
                    on ? "w-5 opacity-100" : "pointer-events-none w-0 opacity-0"}`}
                >
                  <PanelRight size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {notes === null && !q && (
          <div aria-hidden className="px-2 pt-3">
            <div className="mb-2 h-3 w-20 animate-pulse rounded bg-surface-active" />
            {[62, 44].map((w) => (
              <div key={w} className="flex h-8 items-center gap-2.5">
                <span className="size-5 animate-pulse rounded bg-surface-active" />
                <span className="h-3 animate-pulse rounded bg-surface-active" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        )}
        {notes !== null && rows.length === 0 && (
          <div className="px-2 py-5 text-center text-sm text-ink-tertiary">
            {q ? <>Nothing matches “{q}”</> : "Everything here is already open."}
          </div>
        )}
      </div>

      <div role="group" aria-label="Add" className="grid grid-cols-3 gap-1 border-t border-line p-1">
        {actions.map((a, j) => {
          const i = rows.length + j;
          const on = i === sel;
          return (
            <button
              key={a.id}
              id={rowId(i)}
              type="button"
              data-row={i}
              tabIndex={-1}
              disabled={a.id === "new-note" && creating}
              onMouseMove={() => { if (selId !== a.id) setSelId(a.id); }}
              onMouseDown={keepFocus}
              onClick={(e) => a.run(e.altKey)}
              className={`flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] ${
                on ? "bg-surface-hover text-ink" : "text-ink-secondary"}`}
            >
              <span className="shrink-0">{a.icon}</span>
              <span className="min-w-0 truncate">{a.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex h-8 items-center gap-4 px-3 text-[11px] text-ink-tertiary">
        <span className="flex min-w-0 items-center gap-1.5"><Key>↵</Key><span className="truncate">{current?.enter}</span></span>
        {current?.beside && (
          <span className="flex shrink-0 items-center gap-1.5"><Keys combo="Alt+↵" />{current.beside}</span>
        )}
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
