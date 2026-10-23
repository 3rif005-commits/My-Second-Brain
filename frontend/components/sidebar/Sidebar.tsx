"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Plus,
  LogOut,
  ChevronsLeft,
  Trash2,
  RotateCcw,
  ChevronRight,
  Search,
  Home,
  LayoutGrid,
  FileUp,
  Table2,
  Settings,
  SquarePen,
  FileText,
  Monitor,
  Sun,
  Moon,
  Check,
  Activity as ActivityIcon,
} from "lucide-react";
import { Popover } from "@/components/ui/primitives/Popover";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/components/ui/cx";
import { usePreferences, useToast } from "@/app/providers";
import { createClient } from "@/lib/supabase/client";
import { useNotes } from "@/lib/hooks/useNotes";
import { useCollections } from "@/lib/hooks/useCollections";
import { useTrash, type TrashedNote } from "@/lib/hooks/useTrash";
import { NoteTree } from "./NoteTree";
import { NotionDot } from "@/components/notion/NotionDot";
import { RowMenu, type RowMenuTarget } from "@/components/notion/RowMenu";
import { useNotion } from "@/context/NotionContext";
import type { ItemKind } from "@/lib/notion";
import { NotificationsBell } from "./NotificationsBell";
import { useJobBadge } from "@/components/activity/useJobBadge";
import { CsvImport, type CsvImportHandle } from "./CsvImport";
import { Logo } from "@/components/brand/Logo";

/** One round icon button in the nav pill row. The current page's button grows into
 * a labelled pill (Notion's 2026 sidebar, shell.md §1). */
function trashLabel(item: TrashedNote): string {
  const title = item.title || "Untitled";
  if (item.kind === "database") return `${title} — a database; restore brings back its rows and views`;
  if (item.kind === "row") return `${title} — a row of ${item.database}`;
  return title;
}

function NavPill({
  label,
  icon: Icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon: React.ElementType;
  active?: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative flex h-8 shrink-0 items-center rounded-full transition-[background,padding] duration-200 ease-out",
          active ? "gap-1.5 bg-surface-active pl-2 pr-3 text-ink" : "w-8 justify-center text-ink-icon hover:bg-surface-active",
        )}
      >
        <Icon size={20} strokeWidth={1.75} className={active ? "text-ink-icon-strong" : undefined} />
        {active && <span className="text-sm font-medium">{label}</span>}
        {badge}
      </button>
    </Tooltip>
  );
}

/** A sidebar section ("Favorites", "Databases", "Notes"): 12px/500 grey, sentence
 * case. On hover it darkens, shows a chevron that folds the section, and reveals its
 * action buttons (shell.md §1). */
function Section({
  label,
  open,
  onToggle,
  action,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="group/section flex h-[30px] items-center gap-1 rounded-md px-2 transition-colors duration-instant hover:bg-surface-active">
        <button
          onClick={onToggle}
          aria-expanded={open}
          data-section-header
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium leading-4 text-ink-tertiary group-hover/section:text-ink-sidebar"
        >
          <span className="truncate">{label}</span>
          <ChevronRight
            size={12}
            strokeWidth={2.25}
            className={cx("shrink-0 opacity-0 transition-transform duration-200 ease-out group-hover/section:opacity-100", open && "rotate-90")}
          />
        </button>
        {action}
      </div>
      {open && <div className="flex flex-col gap-px">{children}</div>}
    </div>
  );
}

/** The row-hover buttons ("+", "⋯", star…): 20×20, radius 4px, 16px icons. */
export function RowAction({ label, onClick, children, className }: { label: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      }}
      className={cx("flex size-5 shrink-0 items-center justify-center rounded text-ink-icon transition-colors duration-fast hover:bg-surface-active", className)}
    >
      {children}
    </button>
  );
}

/** The icon in a page row: the page's emoji, or Notion's grey page glyph. */
export function RowIcon({ emoji, fallback: Fallback = FileText }: { emoji?: string | null; fallback?: React.ElementType }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-[3.5px] text-[14px] leading-none text-ink-icon">
      {emoji ? emoji : <Fallback size={18} strokeWidth={1.75} />}
    </span>
  );
}

/** A page-level row inside a section (a note, a database). Right-click: Send to Notion…; ⌘/Ctrl-click: select
 *  several to send together. The dot says what the Notion mirror knows about it. */
function PageRow({
  emoji,
  fallbackIcon,
  title,
  active,
  onClick,
  kind = "note",
  id,
}: {
  emoji?: string | null;
  fallbackIcon?: React.ElementType;
  title: string;
  active?: boolean;
  onClick: () => void;
  kind?: ItemKind;
  id?: string;
}) {
  const notion = useNotion();
  const [menu, setMenu] = useState<RowMenuTarget | null>(null);
  const selected = !!id && notion.isSelected(kind, id);
  const state = id && (kind === "note" || kind === "collection") ? notion.stateOf(kind, id) : null;
  return (
    <>
      <button
        onClick={(e) => {
          if (id && notion.connected && (e.metaKey || e.ctrlKey)) { e.preventDefault(); notion.toggleSelect(kind, id); return; }
          onClick();
        }}
        onContextMenu={(e) => {
          if (!id) return;
          e.preventDefault();
          setMenu({ kind, id, title, x: e.clientX, y: e.clientY });
        }}
        aria-current={active ? "page" : undefined}
        aria-pressed={selected || undefined}
        className={cx(
          "group flex h-[var(--sidebar-row-height)] w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-instant",
          selected ? "bg-surface-selected text-ink" : active ? "bg-surface-active text-ink" : "text-ink-sidebar hover:bg-surface-active hover:text-ink",
        )}
      >
        <RowIcon emoji={emoji} fallback={fallbackIcon} />
        <span className="flex-1 truncate">{title}</span>
        <NotionDot state={state} />
      </button>
      {menu && <RowMenu target={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

/** "3 selected · Send to Notion": appears once you ⌘/Ctrl-click rows (DESIGN §7.1). */
function NotionSelectionBar() {
  const notion = useNotion();
  if (notion.selection.size === 0) return null;
  return (
    <div role="region" aria-label="Selection" className="mx-2 mb-2 flex shrink-0 items-center gap-2 rounded-card bg-surface-elevated px-3 py-2 text-xs text-ink shadow-float">
      <span className="flex-1 text-accent">{notion.selection.size} selected</span>
      <button onClick={notion.sendSelection} className="h-6 rounded-md bg-accent px-2 font-medium text-ink-on-accent hover:bg-accent-hover">Send to Notion</button>
      <button onClick={notion.clearSelection} aria-label="Clear selection" className="flex size-6 items-center justify-center rounded-md text-ink-icon hover:bg-surface-hover">✕</button>
    </div>
  );
}

/** The workspace row at the top: logo + name, a pill on hover, opening the account
 * menu (Settings, theme, sign out). The « collapse button appears on hover. */
function WorkspaceSwitcher({ onToggle, onSignOut }: { onToggle?: () => void; onSignOut: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { preferences, updatePreferences } = usePreferences();
  const themes = [
    { value: "system", label: "Use system setting", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ] as const;
  const row = "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-ink hover:bg-surface-hover";
  return (
    <div className="group/switcher mx-2 mt-1.5 flex h-8 shrink-0 items-center rounded-full transition-colors duration-instant hover:bg-surface-active">
      <Popover
        open={open}
        onOpenChange={setOpen}
        width={260}
        label="Workspace menu"
        trigger={
          <button className="flex min-w-0 flex-1 items-center gap-2 rounded-full py-1 pl-2 pr-1 text-left" aria-label="Workspace menu">
            <Logo size={22} className="shrink-0 rounded" />
            <span className="truncate text-sm font-medium leading-5 text-ink">My Second Brain</span>
          </button>
        }
      >
        <div className="p-1">
          <button className={row} onClick={() => { setOpen(false); router.push("/brain/settings"); }}>
            <Settings size={18} className="text-ink-icon-strong" /> Settings
          </button>
          <div className="mx-2 my-1 h-px bg-line" />
          <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-ink-secondary">Theme</div>
          {themes.map((t) => (
            <button key={t.value} className={row} onClick={() => updatePreferences({ theme: t.value })}>
              <t.icon size={18} className="text-ink-icon-strong" />
              <span className="flex-1">{t.label}</span>
              {preferences.theme === t.value && <Check size={16} />}
            </button>
          ))}
          <div className="mx-2 my-1 h-px bg-line" />
          <button className={row} title="Sign out" onClick={() => { setOpen(false); onSignOut(); }}>
            <LogOut size={18} className="text-ink-icon-strong" /> Sign out
          </button>
        </div>
      </Popover>
      {onToggle && (
        <Tooltip content="Close sidebar" shortcut="Ctrl+\">
          <button
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-ink-icon opacity-0 transition-opacity duration-200 hover:bg-surface-active focus-visible:opacity-100 group-hover/switcher:opacity-100 [aside:hover_&]:opacity-100"
          >
            <ChevronsLeft size={18} />
          </button>
        </Tooltip>
      )}
    </div>
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
  const jobsWaiting = useJobBadge();
  const { showToast } = useToast();
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
    // A database restored from the Trash comes back here without a reload.
    window.addEventListener("notes-changed", loadDatabases);
    return () => window.removeEventListener("notes-changed", loadDatabases);
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
      className="relative flex h-screen flex-col bg-surface-sidebar text-ink shadow-[inset_-1px_0_0_0_var(--c-border-sidebar-edge)]"
      style={{ width: "var(--sidebar-width)" }}
    >
      <WorkspaceSwitcher onToggle={onToggle} onSignOut={() => setConfirmSignOut(true)} />

      {/* Nav pill row: the current page is a labelled pill, the rest are round icon
          buttons; Search sits at the right (shell.md §1). */}
      <nav aria-label="Main navigation" className="mx-2 mt-3.5 flex h-8 shrink-0 items-center gap-0.5">
        <NavPill label="Home" icon={Home} active={pathname === "/brain"} onClick={() => navigate("/brain")} />
        <NavPill
          label="Workspace"
          icon={LayoutGrid}
          active={pathname?.startsWith("/brain/workspace") ?? false}
          onClick={() => navigate("/brain/workspace")}
        />
        <NavPill
          label="Activity"
          icon={ActivityIcon}
          active={pathname?.startsWith("/brain/activity") ?? false}
          onClick={() => navigate("/brain/activity")}
          badge={jobsWaiting > 0 ? (
            <span data-testid="activity-badge" aria-label={`${jobsWaiting} waiting`}
              className="absolute right-0.5 top-0.5 h-3 min-w-3 rounded-full bg-accent px-[3px] text-center text-[9px] font-semibold leading-3 text-ink-on-accent">
              {jobsWaiting > 9 ? "9+" : jobsWaiting}
            </span>
          ) : undefined}
        />
        {/* Milestone 12 (task-41): notifications inbox — a top-level entry,
         * NOT scoped to any one database (task-41-brief.md decision 5). */}
        <NotificationsBell />
        <div className="flex-1" />
        <Tooltip content="Search" shortcut="Ctrl+K">
          <button
            onClick={() => onSearchOpen?.()}
            aria-label="Search"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-icon transition-colors duration-fast hover:bg-surface-active"
          >
            <Search size={20} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </nav>

      {/* Scrollable area: Favorites + Recent + Databases + Notes */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-24 pt-1.5">

        {favoritedNotes.length > 0 && (
          <Section label="Favorites" open={starredOpen} onToggle={() => setStarredOpen((v) => !v)}>
            {favoritedNotes.map((note) => (
              <PageRow
                key={note.id}
                emoji={note.icon}
                title={note.title || "Untitled"}
                active={pathname === `/brain/${note.id}`}
                onClick={() => navigate(`/brain/${note.id}`)}
                id={note.id}
              />
            ))}
          </Section>
        )}

        {recentNotes.length > 0 && (
          <Section label="Recent" open={recentOpen} onToggle={() => setRecentOpen((v) => !v)}>
            {recentNotes.map((note) => (
              <PageRow
                key={note.id}
                emoji={note.icon}
                title={note.title || "Untitled"}
                active={pathname === `/brain/${note.id}`}
                onClick={() => navigate(`/brain/${note.id}`)}
                id={note.id}
              />
            ))}
          </Section>
        )}

        {/* Databases — see `loadDatabases` above for why this list could not
            exist until GET /db/databases shipped. The section header now carries
            the only create affordance for databases (blank or from CSV). */}
        <Section
          label="Databases"
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
                className={cx(
                  "flex size-5 items-center justify-center rounded text-ink-icon transition-opacity hover:bg-surface-active",
                  createMenuOpen ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover/section:opacity-100",
                )}
              >
                <Plus size={16} />
              </button>

              {createMenuOpen && (
                <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-60 rounded-menu bg-menu-bg p-1 shadow-menu">
                  <button
                    role="menuitem"
                    onClick={handleNewDatabase}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                  >
                    <Table2 size={18} className="mt-px shrink-0 text-ink-icon-strong" />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">Blank database</span>
                      <span className="block text-xs text-ink-secondary">Start from an empty table</span>
                    </span>
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      csvRef.current?.openPicker();
                    }}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                  >
                    <FileUp size={18} className="mt-px shrink-0 text-ink-icon-strong" />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">Import CSV</span>
                      <span className="block text-xs text-ink-secondary">Build one from a spreadsheet</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          }
        >
          {databases.length === 0 ? (
            <p className="flex h-[30px] items-center px-2 text-sm text-ink-tertiary">No databases yet</p>
          ) : (
            databases.map((db) => (
              <PageRow
                key={db.id}
                emoji={db.icon}
                fallbackIcon={Table2}
                title={db.title || "Untitled Database"}
                active={pathname === `/brain/db/${db.id}`}
                onClick={() => navigate(`/brain/db/${db.id}`)}
                kind="database"
                id={db.id}
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
              className="flex size-5 shrink-0 items-center justify-center rounded text-ink-icon opacity-0 transition-opacity hover:bg-surface-active focus-visible:opacity-100 group-hover/section:opacity-100"
            >
              <Plus size={16} />
            </button>
          }
        >
          {notesLoading || colsLoading ? (
            <div className="flex flex-col gap-1 px-2 pt-1">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-6 animate-pulse rounded-md bg-surface-chip" />
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
          <button
            onClick={handleNewNote}
            className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-sm text-ink-tertiary transition-colors duration-instant hover:bg-surface-active"
          >
            <span className="flex size-5 items-center justify-center"><Plus size={16} className="text-ink-icon-subtle" /></span>
            Add new
          </button>
        </Section>

        {/* Bottom rows: Settings and Trash (shell.md §1). */}
        <div className="flex flex-col gap-px">
          <button
            onClick={() => navigate("/brain/settings")}
            aria-current={pathname?.startsWith("/brain/settings") ? "page" : undefined}
            className={cx(
              "flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-sm transition-colors duration-instant hover:bg-surface-active",
              pathname?.startsWith("/brain/settings") ? "bg-surface-active text-ink" : "text-ink-sidebar",
            )}
          >
            <Settings size={20} strokeWidth={1.75} className="shrink-0 text-ink-icon" />
            Settings
          </button>
          {trashedNotes.length > 0 && (
            <>
              <button
                onClick={() => setTrashOpen((v) => !v)}
                aria-expanded={trashOpen}
                className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-sm text-ink-sidebar transition-colors duration-instant hover:bg-surface-active"
              >
                <Trash2 size={20} strokeWidth={1.75} className="shrink-0 text-ink-icon" />
                <span className="flex-1 text-left">Trash</span>
                <span className="text-xs tabular-nums text-ink-tertiary">{trashedNotes.length}</span>
                <ChevronRight size={12} className={cx("shrink-0 text-ink-icon transition-transform duration-200 ease-out", trashOpen && "rotate-90")} />
              </button>
              {trashOpen && (
                <div className="flex max-h-48 flex-col gap-px overflow-y-auto">
                  {trashedNotes.map((note) => (
                    <div
                      key={note.id}
                      className="group flex h-[30px] items-center gap-1 rounded-md pl-9 pr-1.5 text-sm text-ink-secondary hover:bg-surface-active"
                    >
                      <span className="min-w-0 flex-1 truncate" title={trashLabel(note)}>
                        {note.title || "Untitled"}
                        {note.kind && note.kind !== "note" && (
                          <span className="ml-1.5 text-xs text-ink-tertiary">
                            {note.kind === "database" ? "Database" : `in ${note.database}`}
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => restoreNote(note.id)}
                        title="Restore"
                        aria-label={`Restore ${note.title || "Untitled"}`}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-ink-icon opacity-0 hover:bg-surface-active focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <RotateCcw size={14} />
                      </button>
                      {note.kind !== "database" && <button
                        onClick={() => permanentDelete(note.id)}
                        title="Delete forever"
                        aria-label={`Delete ${note.title || "Untitled"} forever`}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-ink-icon opacity-0 hover:bg-surface-active hover:text-ink-danger focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <NotionSelectionBar />

      {/* Floating "New page" button at the bottom, no strip behind it (shell.md §1). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex px-4">
        <Tooltip content="New page" side="top">
          <button
            onClick={handleNewNote}
            aria-label="New page"
            className="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-surface-elevated text-ink shadow-float transition-[background,transform] duration-instant hover:bg-surface-sidebar active:scale-95"
          >
            <SquarePen size={18} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out of My Second Brain?"
        confirmLabel="Sign out"
        onConfirm={handleSignOut}
        onCancel={() => setConfirmSignOut(false)}
      />

      {/* Headless: owns the file picker, the upload and the import report. Mounted here,
          not inside the "+" menu, so its report survives that menu closing. */}
      <CsvImport ref={csvRef} onImported={loadDatabases} />
    </aside>
  );
}
