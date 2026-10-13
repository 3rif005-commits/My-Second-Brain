"use client";

// The mirror chip beside a note's title bar: what Notion has, in one glance (DESIGN §7.1).
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useNotion } from "@/context/NotionContext";
import { notionApi } from "@/lib/notion";
import { MIRROR_WORD } from "./NotionDot";

const LABEL: Record<string, string> = {
  synced: "✓ In Notion", changed: "● Changed", failed: "⚠ Failed", needs_you: "● Edited in Notion",
  private: "🔒 Private", paused: "⏸ Paused", none: "◻ Not in Notion",
};
const TONE: Record<string, string> = {
  synced: "text-emerald-700 dark:text-emerald-300", changed: "text-amber-700 dark:text-amber-300",
  failed: "text-rose-700 dark:text-rose-300", needs_you: "text-accent-700 dark:text-accent-300",
  private: "text-gray-500", paused: "text-gray-500", none: "text-gray-400",
};

export function NotionChip({ noteId }: { noteId: string }) {
  const notion = useNotion();
  const state = notion.stateOf("note", noteId);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setUrl(null);
    if (notion.connected && state && state !== "private") {
      notionApi.note(noteId).then((n) => { if (live) setUrl(n.notion_url ?? null); }).catch(() => {});
    }
    return () => { live = false; };
  }, [noteId, notion.connected, state]);

  if (!notion.connected) return null;
  const key = state ?? "none";
  return (
    <span className="inline-flex items-center gap-1" data-testid="notion-chip" data-state={key}>
      <button onClick={() => notion.open({ note_ids: [noteId] })}
        title={state ? MIRROR_WORD[state] : "Not sent to Notion yet. Click to review and send."}
        className={`inline-flex items-center h-6 px-2 rounded-md border border-gray-200 dark:border-gray-700 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${TONE[key]}`}>
        {LABEL[key]}
      </button>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" aria-label="Open in Notion" title="Open in Notion"
          className="text-gray-400 hover:text-accent-500"><ExternalLink size={12} /></a>
      )}
    </span>
  );
}
