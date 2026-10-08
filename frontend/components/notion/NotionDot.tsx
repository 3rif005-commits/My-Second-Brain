"use client";

// The 6 px dot beside a note or folder that says what the Notion mirror knows about it (DESIGN §7.3).
// Quiet by default: nothing for something never sent; the "in sync" ring shows only while pointing at the row.
import { Lock } from "lucide-react";
import type { MirrorCode } from "@/lib/notion";

export const MIRROR_WORD: Record<MirrorCode, string> = {
  synced: "In sync with Notion", changed: "Changed since the last send to Notion", failed: "The last send to Notion failed",
  needs_you: "Needs you: changed in Notion", private: "Private: not sent to Notion", paused: "Mirroring to Notion is paused",
  deleted: "Deleted here; still in Notion",
};

const COLOR: Record<Exclude<MirrorCode, "private" | "deleted">, string> = {
  synced: "border border-emerald-500 bg-transparent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
  changed: "bg-amber-400",
  failed: "bg-rose-500",
  needs_you: "bg-violet-500",
  paused: "bg-slate-400",
};

export function NotionDot({ state, className = "" }: { state: MirrorCode | null | undefined; className?: string }) {
  if (!state || state === "deleted") return null;
  if (state === "private") {
    return <span role="img" aria-label={MIRROR_WORD.private} title={MIRROR_WORD.private} data-notion-dot={state}
      className={`shrink-0 text-slate-500 ${className}`}><Lock size={10} /></span>;
  }
  return <span role="img" aria-label={MIRROR_WORD[state]} title={MIRROR_WORD[state]} data-notion-dot={state}
    className={`shrink-0 inline-block h-1.5 w-1.5 rounded-full ${COLOR[state]} ${className}`} />;
}
