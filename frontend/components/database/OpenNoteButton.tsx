"use client";

// A small, explicit "open the note" affordance for card-based views whose
// cards already have a competing click behavior on their main content:
// Board cards are dnd-kit drag handles over their *entire* surface, and
// both Board and Gallery cards render their title through TitleCell, whose
// own click toggles inline editing. Making the whole card (or the title)
// double as "click to open" would fire both behaviors at once on the same
// click (start a drag, or start editing, *and* navigate away) — this is a
// separate, small, always-visible control instead, mirroring the "hover to
// reveal Open" affordance Notion itself uses on gallery/board cards for the
// same reason.
//
// List/Feed don't need this: their titles are always plain read-only text
// (no TitleCell, no inline-edit competing click), so clicking the title
// itself is unambiguous there — see ListView.tsx/FeedView.tsx.
//
// `onPointerDown`/`onClick` both call `stopPropagation()`: BoardCard spreads
// dnd-kit's `listeners` (pointer-down-driven) across the *entire* outer
// card div this button lives inside, so without stopping propagation a
// click here would also register as the start of a (zero-distance, so
// harmless) drag gesture — cheap to prevent outright rather than rely on
// dnd-kit's activation-distance threshold to absorb it.
//
// `onOpen` (optional, controller addition): TableView opens a `RowPeek`
// (a side panel showing properties + body over the table, matching
// Notion's own default row-click behavior) instead of navigating straight
// to the Workspace route every other view still does — see RowPeek.tsx.
// Every existing caller (Board/Gallery) omits this prop and keeps today's
// exact navigate-to-Workspace behavior unchanged.
import { useOpenNote } from "@/lib/database/useOpenNote";

interface OpenNoteButtonProps {
  noteId: string;
  className?: string;
  onOpen?: (noteId: string) => void;
  /** M9 (row-affordances.md): TableView's row peek toggle. "OPEN is a
   * LABELLED button — an icon plus the word OPEN, right-aligned... While
   * the peek is open it becomes CLOSE." Every other caller (Board/Gallery)
   * omits this and keeps the pre-M9 icon-only rendering unchanged. */
  isOpen?: boolean;
}

export function OpenNoteButton({ noteId, className = "", onOpen, isOpen }: OpenNoteButtonProps) {
  const openNote = useOpenNote();
  const labelled = isOpen !== undefined;

  return (
    <button
      type="button"
      aria-label={labelled ? (isOpen ? "Close" : "Open") : "Open note"}
      title={labelled ? (isOpen ? "Close" : "Open") : "Open note"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        (onOpen ?? openNote)(noteId);
      }}
      // Notion's OPEN chip (database-table.md §4): white pill with the float shadow,
      // a side-peek glyph and "OPEN" in 12px/500 uppercase grey.
      className={`inline-flex h-6 items-center rounded-md bg-surface-elevated p-0.5 shadow-float ${className}`}
    >
      <span className="flex h-5 items-center gap-1.5 rounded px-1 text-ink-secondary transition-colors duration-instant hover:bg-surface-hover">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-icon" aria-hidden>
          <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
          <path d="M11 4v12" />
        </svg>
        {labelled && <span className="text-xs font-medium uppercase leading-[18px] tracking-[0.5px]">{isOpen ? "Close" : "Open"}</span>}
      </span>
    </button>
  );
}
