"use client";

import { useState, useEffect, useCallback } from "react";

export interface TrashedNote {
  id: string;
  title: string;
  deleted_at: string;
  /** "row" = a database row (still a note); "database" = a whole database. */
  kind?: "note" | "row" | "database";
  /** For a row: the database it belongs to. */
  database?: string;
}

export function useTrash() {
  const [trashedNotes, setTrashedNotes] = useState<TrashedNote[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTrash = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notes/trash");
      if (!res.ok) return;
      const data = await res.json();
      setTrashedNotes(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrash();
    window.addEventListener("notes-changed", fetchTrash);
    return () => window.removeEventListener("notes-changed", fetchTrash);
  }, [fetchTrash]);

  async function restoreNote(noteId: string) {
    const item = trashedNotes.find((n) => n.id === noteId);
    const res = item?.kind === "database"
      ? await fetch(`/api/notes/trash/databases/${noteId}`, { method: "POST" })
      : await fetch(`/api/notes/${noteId}/restore`, { method: "POST" });
    if (!res.ok) return;
    setTrashedNotes((prev) => prev.filter((n) => n.id !== noteId));
    window.dispatchEvent(new Event("notes-changed"));
  }

  async function permanentDelete(noteId: string) {
    // A whole database is restore-only (see the trash databases route).
    if (trashedNotes.find((n) => n.id === noteId)?.kind === "database") return;
    const res = await fetch(`/api/notes/${noteId}/permanent`, { method: "DELETE" });
    if (!res.ok) return;
    setTrashedNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  return { trashedNotes, loading, restoreNote, permanentDelete, refetch: fetchTrash };
}
