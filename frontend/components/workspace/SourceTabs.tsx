"use client";

// The session's sources as tabs above the viewer, like browser tabs: one click
// switches, + adds a file or a link, × on hover removes. A tab tells its own
// state: the source's colour dot when ready, a spinning ring while it is read,
// a red mark when reading failed (the viewer then offers Retry).
// Replaced SourceRail (2026-10-25): a stacked list took ~150px above the viewer
// on a 649px-high window.
import { useRef, useState } from "react";
import { AlertCircle, Link2, PanelLeftClose, Plus, Upload, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { IconButton } from "@/components/ui";
import { Popover } from "@/components/ui/primitives/Popover";
import { ACCEPTED_WORKSPACE_FILES, sourceColor, type NoteSource } from "@/lib/workspace";

interface SourceTabsProps {
  sources: NoteSource[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  onAddUrl: (url: string) => void;
  onRemove: (s: NoteSource) => void;
  /** Hides the source pane; absent where it can't be hidden (one-pane mode). */
  onCollapse?: () => void;
  busy?: boolean;
}

function TabMark({ source }: { source: NoteSource }) {
  if (source.status === "failed") {
    return <AlertCircle size={13} className="shrink-0 text-ink-danger" aria-label="Couldn't read" />;
  }
  if (source.status === "queued" || source.status === "processing") {
    return (
      <span
        aria-label="Reading"
        className="size-3 shrink-0 rounded-full border-[1.5px] border-t-transparent animate-spin"
        style={{ borderColor: sourceColor(source.order_index), borderTopColor: "transparent" }}
      />
    );
  }
  return (
    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: sourceColor(source.order_index) }} />
  );
}

export function SourceTabs({
  sources, activeId, onSelect, onAddFiles, onAddUrl, onRemove, onCollapse, busy,
}: SourceTabsProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<NoteSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-[38px] shrink-0 items-end gap-0.5 border-b border-line pl-2 pr-1">
      <div role="tablist" aria-label="Sources" className="ws-scroll-x flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
        {sources.map((s) => {
          const active = s.id === activeId;
          return (
            <div
              key={s.id}
              className={`group relative flex h-8 max-w-[180px] shrink-0 items-center rounded-t-md transition-colors duration-instant ${
                active ? "bg-surface text-ink shadow-[inset_0_-2px_0_var(--c-accent)]" : "text-ink-secondary hover:bg-surface-hover"}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(s.id)}
                title={s.status === "failed" ? `${s.title}: couldn't read it` : s.title}
                className="flex h-full min-w-0 items-center gap-2 pl-2.5 pr-1 text-[13px]"
              >
                <TabMark source={s} />
                <span className="truncate">{s.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${s.title}`}
                onClick={() => setPendingRemove(s)}
                className="mr-1 flex size-5 shrink-0 items-center justify-center rounded text-ink-icon opacity-0
                  hover:bg-surface-hover hover:text-ink focus:opacity-100 group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        {sources.length === 0 && (
          <span className="flex h-8 items-center px-2 text-[13px] text-ink-tertiary">No sources yet</span>
        )}
      </div>

      <div className="flex h-[37px] shrink-0 items-center gap-0.5">
        <Popover
          open={addOpen}
          onOpenChange={setAddOpen}
          align="end"
          width={248}
          label="Add a source"
          trigger={
            <button
              type="button"
              aria-label="Add a source"
              title="Add a source: a file, a YouTube video or a web page"
              disabled={busy}
              className="flex size-7 items-center justify-center rounded-md text-ink-icon hover:bg-surface-hover disabled:opacity-40"
            >
              {busy
                ? <span className="size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                : <Plus size={16} />}
            </button>
          }
        >
          <div className="flex flex-col p-1">
            <button
              type="button"
              className="flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
              onClick={() => { setAddOpen(false); fileInputRef.current?.click(); }}
            >
              <Upload size={16} className="mt-0.5 shrink-0 text-ink-icon" />
              <span className="min-w-0">
                <span className="block text-sm text-ink">Upload a file</span>
                <span className="block text-xs text-ink-secondary">PDF, Word, PowerPoint, Excel, text, video, subtitles</span>
              </span>
            </button>
            <button
              type="button"
              className="flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
              onClick={() => { setAddOpen(false); setShowUrl(true); }}
            >
              <Link2 size={16} className="mt-0.5 shrink-0 text-ink-icon" />
              <span className="min-w-0">
                <span className="block text-sm text-ink">Paste a link</span>
                <span className="block text-xs text-ink-secondary">A web page or a YouTube video</span>
              </span>
            </button>
          </div>
        </Popover>
        {onCollapse && (
          <IconButton label="Hide the source" title="Hide the source" onClick={onCollapse}>
            <PanelLeftClose />
          </IconButton>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_WORKSPACE_FILES}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onAddFiles(files);
        }}
      />
      <PromptDialog
        open={showUrl}
        title="Add a source"
        label="Link"
        placeholder="https://… (a web page or a YouTube video)"
        confirmLabel="Add"
        onSubmit={(v) => { setShowUrl(false); if (v.trim()) onAddUrl(v.trim()); }}
        onCancel={() => setShowUrl(false)}
      />
      <ConfirmDialog
        open={pendingRemove !== null}
        title={`Remove "${pendingRemove?.title ?? ""}"?`}
        description="It is detached from this note and its extracted data is deleted. Your note keeps everything you already wrote."
        confirmLabel="Remove"
        onConfirm={() => {
          const s = pendingRemove;
          setPendingRemove(null);
          if (s) onRemove(s);
        }}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
