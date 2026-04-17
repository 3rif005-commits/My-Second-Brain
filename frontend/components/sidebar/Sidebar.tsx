"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useNotes } from "@/lib/hooks/useNotes";
import { useCollections } from "@/lib/hooks/useCollections";
import { NoteTree } from "./NoteTree";
import { Button } from "@/components/ui/button";

export function Sidebar() {
  const router = useRouter();
  const { notes, loading: notesLoading, createNote, deleteNote } = useNotes();
  const { collections, loading: colsLoading } = useCollections();

  async function handleNewNote() {
    const note = await createNote();
    router.push(`/brain/${note.id}`);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className="flex flex-col h-screen bg-gray-50 border-r border-gray-200"
      style={{ width: "var(--sidebar-width)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
        <span className="font-semibold text-gray-900 text-sm">Second Brain</span>
        <Button size="sm" variant="ghost" onClick={handleSignOut} title="Sign out">
          ↩
        </Button>
      </div>

      {/* Action Buttons */}
      <div className="px-3 pt-3 flex gap-2">
        <Button className="flex-1" size="sm" onClick={handleNewNote}>
          + New Note
        </Button>
        <Button size="sm" variant="ghost" title="Import PDF / URL" onClick={() => router.push("/brain/ingest")}>
          ↑
        </Button>
      </div>

      {/* Note Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {notesLoading || colsLoading ? (
          <p className="px-3 text-xs text-gray-400">Loading…</p>
        ) : (
          <NoteTree
            notes={notes}
            collections={collections}
            onDeleteNote={deleteNote}
          />
        )}
      </div>
    </aside>
  );
}
