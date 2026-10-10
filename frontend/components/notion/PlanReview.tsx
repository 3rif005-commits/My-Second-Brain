"use client";

// The preview: what a send would do, item by item, before anything is sent (DESIGN §7.2).
// Tabs (New / Changed / Unchanged / Needs you / Not sent), a checkbox per row, losses in plain
// words, and for a page edited in Notion the diff with Overwrite / Skip / Keep both.
import { useState } from "react";
import { AlertTriangle, ChevronRight, Database, FileText, Folder, Lock, MessageSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ItemKind, PlanItem, PlanState, Resolution } from "@/lib/notion";
import { FidelityPill } from "./NotionPill";

export const STATE_WORD: Record<PlanState, string> = {
  new: "New in Notion", changed: "Changed since the last send", unchanged: "Already up to date",
  private: "Private: stays on this device", paused: "Mirroring is paused for this item",
  missing: "This could not be found", deleted: "Deleted in Second Brain", needs_you: "Needs you",
};

export type TabId = "new" | "changed" | "unchanged" | "needs_you" | "not_sent";
export const TAB_LABEL: Record<TabId, string> = {
  new: "New", changed: "Changed", unchanged: "Unchanged", needs_you: "Needs you", not_sent: "Not sent",
};

export function tabOf(i: PlanItem): TabId {
  if (i.state === "new") return "new";
  if (i.state === "changed") return "changed";
  if (i.state === "unchanged") return "unchanged";
  if (i.state === "needs_you") return "needs_you";
  return "not_sent";
}

const KIND_ICON: Record<ItemKind, typeof FileText> = {
  note: FileText, collection: Folder, database: Database, thread: MessageSquare, skill: Sparkles,
};

interface RowProps {
  item: PlanItem;
  checked: boolean;
  onToggle: () => void;
  onResolve: (r: Resolution | null) => void;
  onRelease: () => void;
  onStopMirroring: () => void;
  focusRef?: (el: HTMLDivElement | null) => void;
  onKeyNav: (dir: 1 | -1) => void;
  defaultOpen?: boolean;
}

function DiffView({ lines }: { lines: NonNullable<PlanItem["needs"]>["diff"] }) {
  if (!lines || lines.length === 0) return <p className="text-[12px] opacity-60">No text difference to show.</p>;
  return (
    <div className="grid grid-cols-2 gap-px rounded-md overflow-hidden border border-[color:var(--menu-divider)] text-[12px] font-mono"
      data-testid="notion-diff" role="table" aria-label="What is in Notion now, and what would be sent">
      <div className="px-2 py-1 font-sans font-medium bg-[var(--menu-field-bg)]">In Notion now</div>
      <div className="px-2 py-1 font-sans font-medium bg-[var(--menu-field-bg)]">What we would send</div>
      {lines.map((l, i) => (
        <div key={i} className="contents">
          <div className={`px-2 py-0.5 whitespace-pre-wrap break-words ${l.op === "notion" ? "bg-rose-50 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200" : ""}`}>
            {l.op !== "ours" ? l.text || " " : ""}
          </div>
          <div className={`px-2 py-0.5 whitespace-pre-wrap break-words ${l.op === "ours" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : ""}`}>
            {l.op !== "notion" ? l.text || " " : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlanRow({ item, checked, onToggle, onResolve, onRelease, onStopMirroring, focusRef, onKeyNav, defaultOpen }: RowProps) {
  const [open, setOpen] = useState(defaultOpen || item.state === "needs_you");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const Icon = KIND_ICON[item.kind];
  const sendable = item.state === "new" || item.state === "changed" || item.state === "deleted";
  const expandable = item.losses.length > 0 || item.state === "needs_you";

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); onKeyNav(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); onKeyNav(-1); }
    else if (e.key === "ArrowRight" && expandable) { e.preventDefault(); setOpen(true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setOpen(false); }
    else if (e.key === " " && sendable) { e.preventDefault(); onToggle(); }
  }

  return (
    <div ref={focusRef} tabIndex={0} role="group" aria-label={item.title} onKeyDown={onKeyDown}
      className="rounded-lg border border-[color:var(--menu-divider)] p-3 space-y-2 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      data-testid="notion-item" data-state={item.state} data-kind={item.kind}>
      <div className="flex items-start gap-2.5">
        {sendable ? (
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Send ${item.title}`} className="mt-1 h-4 w-4 accent-indigo-600" />
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
        )}
        <Icon size={15} className="mt-0.5 shrink-0 opacity-60" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{item.title}</div>
          <div className="text-[12px] opacity-70 truncate">
            {item.path ? `${item.path} · ` : ""}{STATE_WORD[item.state]}
            {item.moved ? " · moved to another folder" : ""}{item.restore ? " · restored" : ""}
            {item.resolution ? ` · you chose: ${RESOLUTION_WORD[item.resolution]}` : ""}
          </div>
        </div>
        {(item.state === "new" || item.state === "changed" || item.state === "unchanged") && (
          <FidelityPill fidelity={item.fidelity} losses={item.losses.length} />
        )}
        {expandable && (
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? "Hide details" : "Show details"}
            className="p-1 rounded hover:bg-[var(--menu-row-hover-bg)]">
            <ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        )}
      </div>

      {open && item.losses.length > 0 && (
        <ul className="text-[13px] space-y-1.5 pt-2 border-t border-[color:var(--menu-divider)]">
          {item.losses.map((l, i) => (
            <li key={i}><span className="opacity-90">{l.what}</span>{" "}<span className="opacity-60">{l.fallback}</span></li>
          ))}
        </ul>
      )}

      {item.state === "private" && (
        <div className="rounded-md px-3 py-2.5 text-[13px] bg-amber-50 dark:bg-amber-500/10 space-y-2">
          <p className="flex items-center gap-1.5 font-medium"><Lock size={13} /> Private</p>
          <p className="opacity-80">Private items never leave this device unless you let this one through, once.</p>
          <Button size="sm" variant="ghost" onClick={onRelease}>Send once anyway</Button>
        </div>
      )}

      {item.state === "deleted" && (
        <p className="text-[12px] opacity-70 pl-6">
          Tick it to move its Notion page to “Deleted in Second Brain”. It is never put in Notion's trash.
          {item.selected ? "" : " It stays where it is until you tick it."}
        </p>
      )}

      {item.state === "needs_you" && item.needs && (
        <div className="space-y-2.5 pt-2 border-t border-[color:var(--menu-divider)]" data-testid="needs-you">
          {item.needs.reason === "edited_in_notion" ? (
            <>
              <p className="flex items-start gap-1.5 text-[13px] text-violet-700 dark:text-violet-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>Edited in Notion{item.needs.edited_at ? ` (${new Date(item.needs.edited_at).toLocaleString()})` : ""}
                  {item.needs.foreign_blocks ? `, ${item.needs.foreign_blocks} block(s) added there` : ""}. Nothing is overwritten unless you say so.</span>
              </p>
              {open && <DiffView lines={item.needs.diff} />}
              <div className="flex flex-wrap items-center gap-2">
                {confirmOverwrite ? (
                  <>
                    <Button size="sm" variant="danger" onClick={() => { onResolve("overwrite"); setConfirmOverwrite(false); }}>
                      Yes, overwrite what is in Notion
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmOverwrite(false)}>Cancel</Button>
                  </>
                ) : (
                  <Button size="sm" variant="danger" onClick={() => setConfirmOverwrite(true)}>Overwrite with Second Brain…</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => onResolve(null)}>Skip this time</Button>
                <Button size="sm" variant="ghost" onClick={() => onResolve("copy")}>Keep both: send as a copy</Button>
              </div>
              <button className="text-[12px] underline opacity-70 hover:opacity-100" onClick={onStopMirroring}>
                Stop mirroring this page
              </button>
            </>
          ) : (
            <>
              <p className="flex items-start gap-1.5 text-[13px] text-violet-700 dark:text-violet-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>This page is no longer reachable in Notion (deleted or unshared).</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => onResolve("recreate")}>Create it again</Button>
                <Button size="sm" variant="ghost" onClick={() => onResolve("forget")}>Forget it (leave Notion alone)</Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const RESOLUTION_WORD: Record<Resolution, string> = {
  overwrite: "overwrite", copy: "keep both", recreate: "create it again", forget: "forget it",
};
