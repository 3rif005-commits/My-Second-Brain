"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Note } from "@/lib/types/database";
import { Button } from "@/components/ui/button";

const BlockEditor = dynamic(() => import("./BlockEditor").then((m) => m.BlockEditor), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse bg-gray-50 rounded-lg" />,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

interface NoteEditorPageProps {
  note: Note;
}

export function NoteEditorPage({ note }: NoteEditorPageProps) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [ingestHtml, setIngestHtml] = useState<string | undefined>();

  // Check sessionStorage for HTML left by the ingest pipeline
  useEffect(() => {
    const key = `ingest-pending-${note.id}`;
    const html = sessionStorage.getItem(key);
    if (html) {
      sessionStorage.removeItem(key);
      setIngestHtml(html);
    }
  }, [note.id]);

  async function saveTitle() {
    if (title === note.title) return;
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  const handleSaveContent = useCallback(
    async (blocks: AnyBlock[], plainText: string) => {
      setSaving(true);
      await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: blocks, content_text: plainText }),
      });
      setSaving(false);
      setLastSaved(new Date());
    },
    [note.id]
  );

  async function handleDelete() {
    if (!confirm("Delete this note? This cannot be undone.")) return;
    await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    window.dispatchEvent(new Event("notes-changed"));
    router.push("/brain");
    router.refresh();
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
        <div className="text-xs text-gray-400">
          {saving
            ? "Saving…"
            : lastSaved
            ? `Saved ${lastSaved.toLocaleTimeString()}`
            : ingestHtml
            ? "Applying generated content…"
            : ""}
        </div>
        <Button size="sm" variant="danger" onClick={handleDelete}>
          Delete
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {/* Editable title */}
          <input
            className="w-full text-3xl font-bold text-gray-900 bg-transparent border-none outline-none mb-6 placeholder-gray-300"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            placeholder="Untitled"
          />

          {/* Block editor */}
          <BlockEditor
            noteId={note.id}
            initialContent={
              Array.isArray(note.content) && note.content.length > 0
                ? (note.content as AnyBlock[])
                : undefined
            }
            onSave={handleSaveContent}
            ingestHtml={ingestHtml}
          />
        </div>
      </div>
    </div>
  );
}
