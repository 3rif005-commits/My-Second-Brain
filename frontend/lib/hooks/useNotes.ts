"use client";

import { useState, useEffect, useCallback } from "react";
import type { Note } from "@/lib/types/database";

type NoteSummary = Pick<
  Note,
  "id" | "title" | "collection_id" | "topics" | "mastery_status" | "source_type" | "created_at" | "updated_at"
>;

export function useNotes() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notes");
      if (!res.ok) throw new Error("Failed to fetch notes");
      const data = await res.json();
      setNotes(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotes();
    // Re-fetch when another component signals that notes changed (e.g. delete from editor page)
    window.addEventListener("notes-changed", fetchNotes);
    return () => window.removeEventListener("notes-changed", fetchNotes);
  }, [fetchNotes]);

  async function createNote(collectionId?: string): Promise<NoteSummary> {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_id: collectionId ?? null }),
    });
    if (!res.ok) throw new Error("Failed to create note");
    const note = await res.json();
    setNotes((prev) => [note, ...prev]);
    return note;
  }

  async function deleteNote(noteId: string): Promise<void> {
    const res = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete note");
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  return { notes, loading, error, createNote, deleteNote, refetch: fetchNotes };
}
