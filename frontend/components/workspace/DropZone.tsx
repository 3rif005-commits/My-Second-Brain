"use client";

// Empty state of the workspace shell: one drop target, and a recents strip so a
// session can be resumed without a sidebar section to maintain.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Link2 } from "lucide-react";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { wsApi, type RecentSession } from "@/lib/workspace";

interface DropZoneProps {
  onAddFiles: (files: File[]) => void;
  onAddUrl: (url: string) => void;
  busy?: boolean;
}

export function DropZone({ onAddFiles, onAddUrl, busy }: DropZoneProps) {
  const router = useRouter();
  const [recents, setRecents] = useState<RecentSession[]>([]);
  const [showUrl, setShowUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    wsApi.recentSessions().then(setRecents).catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-y-auto flex flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="w-full max-w-xl rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 px-8 py-12 text-center">
        <p className="text-3xl mb-3">📥</p>
        <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          Drop your sources here
        </h1>
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          PDFs, notes, videos, YouTube links, articles — as many as you like.
          They all feed one note, written for you once the last one finishes.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <FileUp size={15} /> {busy ? "Uploading…" : "Choose files"}
          </button>
          <button
            onClick={() => setShowUrl(true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            <Link2 size={15} /> Paste a link
          </button>
        </div>
      </div>

      {recents.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
            Pick up where you left off
          </p>
          <div className="flex flex-wrap gap-2">
            {recents.map((r) => (
              <button
                key={r.note_id}
                onClick={() => router.push(`/brain/workspace/${r.note_id}`)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate max-w-[220px]">
                  {r.title}
                </span>
                <span className="text-[10px] text-gray-400 shrink-0">
                  {r.source_count} source{r.source_count === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

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
    </div>
  );
}
