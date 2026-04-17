"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Collection, Note } from "@/lib/types/database";

type NoteSummary = Pick<Note, "id" | "title" | "collection_id">;

interface NoteTreeProps {
  notes: NoteSummary[];
  collections: Collection[];
  onDeleteNote: (id: string) => void;
}

export function NoteTree({ notes, collections, onDeleteNote }: NoteTreeProps) {
  const pathname = usePathname();

  const uncollected = notes.filter((n) => !n.collection_id);
  const byCollection = (colId: string) => notes.filter((n) => n.collection_id === colId);

  function NoteItem({ note }: { note: NoteSummary }) {
    const active = pathname === `/brain/${note.id}`;
    return (
      <div className={`group flex items-center justify-between px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${active ? "bg-brand-50 text-brand font-medium" : "text-gray-600 hover:bg-gray-100"}`}>
        <Link href={`/brain/${note.id}`} className="flex-1 truncate">
          {note.title || "Untitled"}
        </Link>
        <button
          onClick={(e) => {
            e.preventDefault();
            if (confirm("Delete this note?")) onDeleteNote(note.id);
          }}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-1 transition-opacity text-xs"
          title="Delete note"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Notes not in any collection */}
      {uncollected.map((note) => (
        <NoteItem key={note.id} note={note} />
      ))}

      {/* Collections with their notes */}
      {collections.map((col) => (
        <div key={col.id}>
          <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3">
            <span>{col.icon}</span>
            <span className="truncate">{col.name}</span>
          </div>
          {byCollection(col.id).map((note) => (
            <div key={note.id} className="pl-3">
              <NoteItem note={note} />
            </div>
          ))}
          {byCollection(col.id).length === 0 && (
            <p className="pl-6 text-xs text-gray-400 py-1">Empty</p>
          )}
        </div>
      ))}
    </div>
  );
}
