"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Plus,
  LogOut,
  PanelLeftClose,
  Trash2,
  RotateCcw,
  ChevronRight,
  Search,
  Star,
  Clock,
  Sun,
  Moon,
  LayoutGrid,
  DatabaseIcon,
  FileUp,
  Table2,
} from "lucide-react";
import { useTheme, useToast } from "@/app/providers";
import { createClient } from "@/lib/supabase/client";
import { useNotes } from "@/lib/hooks/useNotes";
import { useCollections } from "@/lib/hooks/useCollections";
import { useTrash } from "@/lib/hooks/useTrash";
import { NoteTree } from "./NoteTree";
import { NotificationsBell } from "./NotificationsBell";
import { CsvImport, type CsvImportHandle } from "./CsvImport";
import { Logo } from "@/components/brand/Logo";

/** A top-level row in the nav (Search, Notifications, Workspace, …). Notion keeps
 * these visually quieter than page titles: 13px, medium weight, a soft hover wash
 * rather than a filled pill, and an accent tint only for the current page. */
function NavItem({
  label,
  icon: Icon,
  active,
  onClick,
  trailing,
}: {
  label: string;
  icon: React.ElementType;
  active?: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group w-full flex items-center gap-2.5 px-2 py-[5px] rounded-md text-[13px] font-medium transition-colors ${
        active
          ? "bg-white/[0.08] text-white"
          : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.055]"
      }`}
    >
      <Icon
        size={15}
        strokeWidth={2}
        className={active ? "text-indigo-400 shrink-0" : "text-slate-500 group-hover:text-slate-300 shrink-0 transition-colors"}
      />
      <span className="flex-1 text-left truncate">{label}</span>
      {trailing}
    </button>
  );
}

/** A collapsible sidebar section. The chevron sits where the icon does in Notion —
 * left of the label, rotating in place — and any action button only fades in on
 * hover so the resting sidebar stays quiet. */
function Section({
  label,
  icon: Icon,
  open,
  onToggle,
  action,
  children,
}: {
  label: string;
  icon?: React.ElementType;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <div className="group/section flex items-center gap-1 pl-2 pr-1 h-[26px] rounded-md hover:bg-white/[0.03] transition-colors">
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronRight
            size={11}
            strokeWidth={2.5}
            className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
          {Icon && <Icon size={10} className="shrink-0 opacity-70" />}
          <span className="truncate">{label}</span>
        </button>
        {action}
      </div>
      {open && <div className="mt-0.5 space-y-px">{children}</div>}
    </div>
  );
}

/** A page-level row inside a section (a note, a database). */
function PageRow({
  emoji,
  title,
  active,
  onClick,
}: {
  emoji: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`w-full flex items-center gap-2 pl-[26px] pr-2 py-[3px] rounded-md text-[13px] transition-colors text-left ${
        active
          ? "bg-white/[0.08] text-white font-medium"
          : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.055]"
      }`}
    >
      <span className="shrink-0 text-[13px] leading-none">{emoji}</span>
      <span className="truncate">{title}</span>
    </button>
  );
}

export function Sidebar({
  onToggle,
  onSearchOpen,
}: {
  onToggle?: () => void;
  onSearchOpen?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const { showToast } = useToast();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { notes, loading: notesLoading, createNote, deleteNote, toggleFavorite, reorderNotes } = useNotes();
  const { collections, loading: colsLoading } = useCollections();
  const { trashedNotes, restoreNote, permanentDelete } = useTrash();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  // Section open/closed state — Notion remembers this per sidebar section, and so do
  // we, but only in-memory: a collapsed "Recent" is a glance-level preference, not
  // something worth a round trip to persist.
  const [starredOpen, setStarredOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [databasesOpen, setDatabasesOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);

  // task-31 follow-up: the databases a user owns, listed in the sidebar.
  // `GET /db/databases` only exists as of commit 397ba23 -- before it, a
  // database was reachable ONLY by remembering its URL, because
  // `handleNewDatabase` below navigates straight to the new one and nothing
  // ever listed them again. That was the gap this section closes.
  //
  // Fetched here rather than through a `useDatabases()` hook alongside
  // `useNotes()`/`useCollections()`: those wrap Supabase-client queries
  // against tables this user's JWT can read directly, whereas databases are
  // only reachable through the FastAPI proxy (tenancy for db_* lives in the
  // query builder, not RLS -- spec §8.3). A one-off fetch here matches how
  // `handleNewDatabase` already talks to that API and avoids implying a
  // symmetry with the note hooks that does not exist.
  const [databases, setDatabases] = useState<{ id: string; title: string; icon: string | null }[]>([]);

  const loadDatabases = useCallback(async () => {
    try {
      const res = await fetch("/api/db/databases");
      if (!res.ok) return; // a sidebar list is not worth a toast on failure
      const data: {
        databases: { database: { id: string; title: string; icon: string | null } }[];
      } = await res.json();
      setDatabases(data.databases.map((entry) => entry.database));
    } catch {
      // Deliberately silent: the rest of the sidebar must still render.
    }
  }, []);

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases]);

  // "New database" and "Import CSV" used to be two separate top-level nav rows. They
  // are one affordance now — the "+" on the Databases section opens a small menu —
  // because both do exactly the same thing from the user's side: produce a new
  // database. CSV import is just the variant that arrives pre-filled.
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const csvRef = useRef<CsvImportHandle>(null);

  useEffect(() => {
    if (!createMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!createMenuRef.current?.contains(e.target as Node)) setCreateMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setCreateMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [createMenuOpen]);

  const favoritedNotes = notes.filter((n) => n.is_favorited);
  const recentNotes = notes
    .filter((n) => n.last_viewed_at)
    .sort((a, b) => new Date(b.last_viewed_at!).getTime() - new Date(a.last_viewed_at!).getTime())
    .slice(0, 5);

  function navigate(path: string) {
    router.push(path);
    // close on mobile after navigating
    if (window.innerWidth < 768) onToggle?.();
  }

  async function handleNewNote() {
    const note = await createNote();
    navigate(`/brain/${note.id}`);
  }

  // POST /db/databases (backend, Milestone 2) has existed since before Milestone 6, but
  // nothing in the UI ever called it — Board/Gallery/List/Feed views (M6) had no live entry
  // point at all without this. Immediate create-and-navigate, same one-click convention as
  // "New Note" above, rather than a name-first dialog — a database can be renamed afterward
  // from its own page, matching how a new note starts "Untitled" too.
  async function handleNewDatabase() {
    setCreateMenuOpen(false);
    try {
      const res = await fetch("/api/db/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled Database" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || body?.error || `Request failed (${res.status})`);
      }
      const data: { database: { id: string } } = await res.json();
      // Refresh the list so the new database appears in the section below
      // rather than only being reachable via the navigation that follows.
      loadDatabases();
      navigate(`/brain/db/${data.database.id}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create database", "error");
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className="flex flex-col h-screen bg-[#0d1220] border-r border-white/[0.06]"
      style={{ width: "var(--sidebar-width, 260px)" }}
    >
      {/* Brand — a Notion-style workspace row: the whole thing is a hover target,
          and the collapse control only appears once you are pointing at it. */}
      <div className="px-2 pt-2.5 pb-1.5 shrink-0">
        <div className="group flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-white/[0.055] transition-colors">
          <Logo size={22} className="shrink-0 rounded-[6px] shadow-sm" />
          <span className="font-semibold text-slate-100 text-[13px] tracking-tight flex-1 truncate">
            My Second Brain
          </span>
          {onToggle && (
            <button
              onClick={onToggle}
              aria-label="Collapse sidebar"
              className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-white/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all"
            >
              <PanelLeftClose size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Quick actions — Search first, the way Notion opens its sidebar. */}
      <nav aria-label="Main navigation" className="px-2 space-y-px shrink-0">
        <NavItem
          label="Search"
          icon={Search}
          onClick={() => onSearchOpen?.()}
          trailing={
            <kbd className="text-[10px] font-mono bg-white/[0.07] text-slate-500 px-1.5 py-px rounded border border-white/[0.05]">
              ⌘K
            </kbd>
          }
        />
        {/* Milestone 12 (task-41): notifications inbox — a top-level entry,
         * NOT scoped to any one database (task-41-brief.md decision 5). */}
        <NotificationsBell />
        <NavItem
          label="Workspace"
          icon={LayoutGrid}
          active={pathname?.startsWith("/brain/workspace") ?? false}
          onClick={() => navigate("/brain/workspace")}
        />
      </nav>

      {/* Primary CTA */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <button
          onClick={handleNewNote}
          className="w-full flex items-center justify-center gap-2 px-3 py-[7px] text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-600 text-white rounded-md shadow-sm shadow-indigo-950/40 transition-colors"
        >
          <Plus size={14} strokeWidth={2.75} />
          New Note
        </button>
      </div>

      <div className="mx-3 my-2 border-t border-white/[0.06] shrink-0" />

      {/* Scrollable area: Starred + Recent + Databases + Notes */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 min-h-0">

        {favoritedNotes.length > 0 && (
          <Section label="Starred" icon={Star} open={starredOpen} onToggle={() => setStarredOpen((v) => !v)}>
            {favoritedNotes.map((note) => (
              <PageRow
                key={note.id}
                emoji={note.icon || "📄"}
                title={note.title || "Untitled"}
                active={pathname === `/brain/${note.id}`}
                onClick={() => navigate(`/brain/${note.id}`)}
              />
            ))}
          </Section>
        )}

        {recentNotes.length > 0 && (
          <Section label="Recent" icon={Clock} open={recentOpen} onToggle={() => setRecentOpen((v) => !v)}>
            {recentNotes.map((note) => (
              <PageRow
                key={note.id}
                emoji={note.icon || "📄"}
                title={note.title || "Untitled"}
                active={pathname === `/brain/${note.id}`}
                onClick={() => navigate(`/brain/${note.id}`)}
              />
            ))}
          </Section>
        )}

        {/* Databases — see `loadDatabases` above for why this list could not
            exist until GET /db/databases shipped. The section header now carries
            the only create affordance for databases (blank or from CSV). */}
        <Section
          label="Databases"
          icon={DatabaseIcon}
          open={databasesOpen}
          onToggle={() => setDatabasesOpen((v) => !v)}
          action={
            <div ref={createMenuRef} className="relative shrink-0">
              <button
                onClick={() => {
                  setDatabasesOpen(true);
                  setCreateMenuOpen((v) => !v);
                }}
                aria-label="New database"
                aria-haspopup="menu"
                aria-expanded={createMenuOpen}
                className={`p-0.5 rounded text-slate-500 hover:text-slate-100 hover:bg-white/10 transition-all ${
                  createMenuOpen ? "opacity-100 text-slate-100" : "opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100"
                }`}
              >
                <Plus size={14} strokeWidth={2.5} />
              </button>

              {createMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-white/10 bg-slate-800 shadow-2xl shadow-black/50 p-1"
                >
                  <button
                    role="menuitem"
                    onClick={handleNewDatabase}
                    className="w-full flex items-start gap-2.5 px-2 py-1.5 rounded-md text-left text-slate-300 hover:bg-white/[0.07] hover:text-white transition-colors"
                  >
                    <Table2 size={15} className="mt-px shrink-0 text-slate-500" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">Blank database</span>
                      <span className="block text-[11px] text-slate-500">Start from an empty table</span>
                    </span>
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      csvRef.current?.openPicker();
                    }}
                    className="w-full flex items-start gap-2.5 px-2 py-1.5 rounded-md text-left text-slate-300 hover:bg-white/[0.07] hover:text-white transition-colors"
                  >
                    <FileUp size={15} className="mt-px shrink-0 text-slate-500" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">Import CSV</span>
                      <span className="block text-[11px] text-slate-500">Build one from a spreadsheet</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          }
        >
          {databases.length === 0 ? (
            <p className="pl-[26px] pr-2 py-[3px] text-[12px] text-slate-600 italic">No databases yet</p>
          ) : (
            databases.map((db) => (
              <PageRow
                key={db.id}
                emoji={db.icon || "🗄️"}
                title={db.title || "Untitled Database"}
                active={pathname === `/brain/db/${db.id}`}
                onClick={() => navigate(`/brain/db/${db.id}`)}
              />
            ))
          )}
        </Section>

        {/* Notes */}
        <Section
          label="Notes"
          open={notesOpen}
          onToggle={() => setNotesOpen((v) => !v)}
          action={
            <button
              onClick={handleNewNote}
              aria-label="New note"
              className="shrink-0 p-0.5 rounded text-slate-500 hover:text-slate-100 hover:bg-white/10 opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 transition-all"
            >
              <Plus size={14} strokeWidth={2.5} />
            </button>
          }
        >
          {notesLoading || colsLoading ? (
            <div className="space-y-1 px-2 pt-1">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-6 rounded-md bg-white/[0.04] animate-pulse" />
              ))}
            </div>
          ) : (
            <NoteTree
              notes={notes}
              collections={collections}
              onDeleteNote={deleteNote}
              onToggleFavorite={toggleFavorite}
              onReorder={reorderNotes}
            />
          )}
        </Section>
      </div>

      {/* Trash */}
      {trashedNotes.length > 0 && (
        <div className="px-2 pb-1.5 shrink-0 border-t border-white/[0.06] pt-1.5">
          <button
            onClick={() => setTrashOpen((v) => !v)}
            aria-expanded={trashOpen}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-slate-500 hover:text-slate-300 rounded-md hover:bg-white/[0.055] transition-colors"
          >
            <Trash2 size={13} className="shrink-0" />
            <span className="flex-1 text-left">Trash</span>
            <span className="text-[10px] tabular-nums text-slate-600">{trashedNotes.length}</span>
            <ChevronRight
              size={11}
              className={`shrink-0 transition-transform duration-150 ${trashOpen ? "rotate-90" : ""}`}
            />
          </button>

          {trashOpen && (
            <div className="mt-0.5 space-y-px max-h-48 overflow-y-auto">
              {trashedNotes.map((note) => (
                <div
                  key={note.id}
                  className="flex items-center gap-1 pl-[26px] pr-1.5 py-1 rounded-md text-[12px] text-slate-500 hover:bg-white/[0.055] group"
                >
                  <span className="flex-1 truncate min-w-0">{note.title || "Untitled"}</span>
                  <button
                    onClick={() => restoreNote(note.id)}
                    title="Restore"
                    aria-label={`Restore ${note.title || "Untitled"}`}
                    className="shrink-0 p-0.5 rounded text-slate-600 hover:text-indigo-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all"
                  >
                    <RotateCcw size={11} />
                  </button>
                  <button
                    onClick={() => permanentDelete(note.id)}
                    title="Delete forever"
                    aria-label={`Delete ${note.title || "Untitled"} forever`}
                    className="shrink-0 p-0.5 rounded text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Account row */}
      <div className="px-2 py-2 border-t border-white/[0.06] shrink-0">
        {confirmSignOut ? (
          <div className="flex items-center gap-1.5 px-2 py-1">
            <span className="text-[12px] text-slate-400 flex-1">Sign out?</span>
            <button
              onClick={handleSignOut}
              className="text-[12px] px-2 py-0.5 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors font-medium"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmSignOut(false)}
              className="text-[12px] px-2 py-0.5 rounded-md bg-white/[0.07] text-slate-400 hover:bg-white/[0.12] transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setConfirmSignOut(true)}
              className="flex-1 flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] text-slate-500 hover:text-slate-200 hover:bg-white/[0.055] transition-colors"
            >
              <LogOut size={14} className="shrink-0" />
              Sign out
            </button>
            {mounted && (
              <button
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                aria-label="Toggle theme"
                title={resolvedTheme === "dark" ? "Switch to light" : "Switch to dark"}
                className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-white/[0.055] transition-colors shrink-0"
              >
                {resolvedTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Headless: owns the file picker, the upload and the import report. Mounted here,
          not inside the "+" menu, so its report survives that menu closing. */}
      <CsvImport ref={csvRef} onImported={loadDatabases} />
    </aside>
  );
}
