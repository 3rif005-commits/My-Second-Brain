"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Trash2, Star, FileText } from "lucide-react";
import { cx } from "@/components/ui/cx";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Collection, Note } from "@/lib/types/database";
import type { NoteSummary } from "@/lib/hooks/useNotes";
import { NotionDot } from "@/components/notion/NotionDot";
import { RowMenu, type RowMenuTarget } from "@/components/notion/RowMenu";
import { useNotion } from "@/context/NotionContext";

interface NoteTreeProps {
  notes: NoteSummary[];
  collections: Collection[];
  onDeleteNote: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  onReorder?: (reordered: NoteSummary[]) => void;
}

interface NoteItemProps {
  note: NoteSummary;
  onDeleteNote: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  confirmingId: string | null;
  setConfirmingId: (id: string | null) => void;
  isDragOverlay?: boolean;
}

function NoteItem({
  note,
  onDeleteNote,
  onToggleFavorite,
  confirmingId,
  setConfirmingId,
  isDragOverlay = false,
}: NoteItemProps) {
  const pathname = usePathname();
  const active = pathname === `/brain/${note.id}`;
  const confirming = confirmingId === note.id;
  const notion = useNotion();
  const [menu, setMenu] = useState<RowMenuTarget | null>(null);
  const selected = notion.isSelected("note", note.id);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={isDragOverlay ? undefined : style}
      {...attributes}
      {...listeners}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: "note", id: note.id, title: note.title || "Untitled", x: e.clientX, y: e.clientY }); }}
      onClickCapture={(e) => {
        if (notion.connected && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); notion.toggleSelect("note", note.id); }
      }}
      // Notion's page row: 30px, radius 6px, 14px/400 warm grey text that turns
      // primary on hover or when current; actions appear at the right on hover.
      // The whole row drags (5px activation distance keeps clicks clicks).
      className={cx(
        "group flex h-[var(--sidebar-row-height)] cursor-pointer items-center rounded-md pr-1 text-sm transition-colors duration-instant",
        selected ? "bg-surface-selected text-ink" : active ? "bg-surface-active text-ink" : "text-ink-sidebar hover:bg-surface-active hover:text-ink",
        isDragOverlay && "bg-surface-elevated shadow-float",
      )}
    >
      <Link href={`/brain/${note.id}`} className="flex h-full min-w-0 flex-1 items-center gap-2 truncate pl-2" tabIndex={0}>
        <span className="flex size-5 shrink-0 items-center justify-center rounded-[3.5px] text-[14px] leading-none text-ink-icon">
          {note.icon ? note.icon : <FileText size={18} strokeWidth={1.75} />}
        </span>
        <span className="truncate">{note.title || "Untitled"}</span>
        <NotionDot state={notion.stateOf("note", note.id)} />
      </Link>
      {menu && <RowMenu target={menu} onClose={() => setMenu(null)} />}

      {confirming ? (
        <div className="ml-1 flex shrink-0 items-center gap-1">
          <button
            onClick={(e) => {
              e.preventDefault();
              onDeleteNote(note.id);
              setConfirmingId(null);
            }}
            className="h-5 rounded px-1.5 text-xs font-medium text-ink-danger hover:bg-surface-danger-soft"
          >
            Delete
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              setConfirmingId(null);
            }}
            aria-label="Cancel delete"
            className="flex size-5 items-center justify-center rounded text-ink-icon hover:bg-surface-active"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="ml-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onToggleFavorite && (
            <button
              onClick={(e) => {
                e.preventDefault();
                onToggleFavorite(note.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={cx(
                "flex size-5 items-center justify-center rounded transition-colors hover:bg-surface-active",
                note.is_favorited ? "text-ink-icon-strong" : "text-ink-icon",
              )}
              aria-label={note.is_favorited ? "Unstar" : "Star"}
              title={note.is_favorited ? "Remove from Favorites" : "Add to Favorites"}
            >
              <Star size={14} fill={note.is_favorited ? "currentColor" : "none"} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.preventDefault();
              setConfirmingId(note.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex size-5 items-center justify-center rounded text-ink-icon transition-colors hover:bg-surface-active hover:text-ink-danger"
            aria-label={`Delete "${note.title || "Untitled"}"`}
            title="Move to Trash"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export function NoteTree({
  notes,
  collections,
  onDeleteNote,
  onToggleFavorite,
  onReorder,
}: NoteTreeProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<NoteSummary | null>(null);
  const notion = useNotion();
  const [colMenu, setColMenu] = useState<RowMenuTarget | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require 5px movement before drag starts — prevents accidental drags on click
      activationConstraint: { distance: 5 },
    })
  );

  const uncollected = notes.filter((n) => !n.collection_id);
  const byCollection = (colId: string) => notes.filter((n) => n.collection_id === colId);

  function handleDragStart(event: DragStartEvent) {
    const note = notes.find((n) => n.id === event.active.id);
    setActiveNote(note ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveNote(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const uncollectedIds = uncollected.map((n) => n.id);
    const oldIdx = uncollectedIds.indexOf(active.id as string);
    const newIdx = uncollectedIds.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) return;

    const reordered = arrayMove(uncollected, oldIdx, newIdx);
    onReorder?.(reordered);
  }

  return (
    <div className="flex flex-col gap-px">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={uncollected.map((n) => n.id)}
          strategy={verticalListSortingStrategy}
        >
          {uncollected.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              onDeleteNote={onDeleteNote}
              onToggleFavorite={onToggleFavorite}
              confirmingId={confirmingId}
              setConfirmingId={setConfirmingId}
            />
          ))}
        </SortableContext>

        {/* Ghost shown while dragging */}
        <DragOverlay>
          {activeNote && (
            <NoteItem
              note={activeNote}
              onDeleteNote={() => {}}
              confirmingId={null}
              setConfirmingId={() => {}}
              isDragOverlay
            />
          )}
        </DragOverlay>
      </DndContext>

      {collections.map((col) => (
        <div key={col.id}>
          <div
            onContextMenu={(e) => { e.preventDefault(); setColMenu({ kind: "collection", id: col.id, title: col.name, x: e.clientX, y: e.clientY }); }}
            className="group mt-2 flex h-[30px] items-center gap-2 rounded-md px-2 text-sm text-ink-sidebar hover:bg-surface-active">
            {col.icon && <span>{col.icon}</span>}
            <span className="truncate flex-1">{col.name}</span>
            <NotionDot state={notion.stateOf("collection", col.id)} />
          </div>
          {byCollection(col.id).map((note) => (
            <div key={note.id} className="pl-2">
              <NoteItem
                note={note}
                onDeleteNote={onDeleteNote}
                onToggleFavorite={onToggleFavorite}
                confirmingId={confirmingId}
                setConfirmingId={setConfirmingId}
              />
            </div>
          ))}
          {byCollection(col.id).length === 0 && (
            <p className="flex h-[30px] items-center pl-9 text-sm text-ink-tertiary">No pages inside</p>
          )}
        </div>
      ))}
      {colMenu && <RowMenu target={colMenu} onClose={() => setColMenu(null)} />}
    </div>
  );
}
