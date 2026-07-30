"use client";

// The source rail: every source attached to this note, one compact row each.
// Add (file picker or pasted URL), select → viewer, retry a failed source,
// remove. Rows are ~28px so five sources still leave the viewer usable.
import { useRef, useState } from "react";
import { FileText, Globe, PlaySquare, Plus, RefreshCw, Video, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { sourceColor, type NoteSource, type ResourceKind } from "@/lib/workspace";

function KindIcon({ kind }: { kind: ResourceKind }) {
  const Icon = kind === "youtube" ? PlaySquare
    : kind === "video" ? Video
    : kind === "website" ? Globe
    : FileText;
  return <Icon size={12} className="shrink-0 text-gray-400" />;
}

function StatusDot({ source }: { source: NoteSource }) {
  if (source.status === "failed") {
    return <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />;
  }
  if (source.status === "ready") {
    return <span className="w-1.5 h-1.5 rounded-full shrink-0"
                 style={{ backgroundColor: sourceColor(source.order_index) }} />;
  }
  return <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />;
}

interface SourceRailProps {
  sources: NoteSource[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  onAddUrl: (url: string) => void;
  onRemove: (s: NoteSource) => void;
  onRetry: (s: NoteSource) => void;
  busy?: boolean;
}

export function SourceRail({
  sources, activeId, onSelect, onAddFiles, onAddUrl, onRemove, onRetry, busy,
}: SourceRailProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<NoteSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="shrink-0 max-h-[38%] flex flex-col border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          Sources {sources.length > 0 && `(${sources.length})`}
        </span>
        <div className="relative">
          <button
            onClick={() => setShowAdd((v) => !v)}
            disabled={busy}
            title="Add a source"
            className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            <Plus size={14} />
          </button>
          {showAdd && (
            <div className="absolute right-0 top-full mt-1 w-52 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 overflow-hidden">
              <button
                className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => { setShowAdd(false); fileInputRef.current?.click(); }}
              >
                Upload file (PDF, MD, TXT, video)
              </button>
              <button
                className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => { setShowAdd(false); setShowUrl(true); }}
              >
                Paste URL (website / YouTube)
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-1.5">
        {sources.length === 0 && (
          <p className="px-1.5 pb-2 text-[11px] text-gray-400">
            Drop a PDF, a video, or paste a link anywhere in this panel.
          </p>
        )}
        {sources.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`group flex items-center gap-1.5 h-7 px-2 rounded-md cursor-pointer transition-colors ${
              s.id === activeId
                ? "bg-indigo-50 dark:bg-indigo-900/30"
                : "hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <StatusDot source={s} />
            <KindIcon kind={s.kind} />
            <span className={`flex-1 min-w-0 truncate text-xs ${
              s.id === activeId
                ? "text-indigo-700 dark:text-indigo-300 font-medium"
                : "text-gray-700 dark:text-gray-300"
            }`} title={s.error ? `Failed: ${s.error}` : s.title}>
              {s.title}
            </span>
            {s.status === "processing" && (
              <span className="text-[10px] text-amber-500 shrink-0">processing</span>
            )}
            {s.status === "queued" && (
              <span className="text-[10px] text-gray-400 shrink-0">queued</span>
            )}
            {s.status === "failed" && (
              <button
                onClick={(e) => { e.stopPropagation(); onRetry(s); }}
                title={s.error ?? "Retry"}
                className="shrink-0 text-red-400 hover:text-red-600"
              >
                <RefreshCw size={11} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setPendingRemove(s); }}
              title="Remove this source"
              className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.md,.txt,.mp4,.webm,.mov,.mkv,.m4v"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onAddFiles(files);
        }}
      />
      <PromptDialog
        open={showUrl}
        title="Add a source URL"
        label="URL"
        placeholder="https://… (website or YouTube video)"
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
