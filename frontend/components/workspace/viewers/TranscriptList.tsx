"use client";

// Collapsed by default: one "Transcript" row under the player. Open, the spoken line is
// highlighted and kept in view; clicking any line (or a chapter) jumps the video there.
// An uploaded file's chapters carry a picture; with chapters but no transcript (no Whisper
// on the server) the row is just "Chapters".
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { activeLine, clock, transcriptRows, type Chapter, type TranscriptLine } from "./transcript";

interface Props {
  lines: TranscriptLine[];
  chapters: Chapter[];
  /** The viewer writes the playhead here (no re-render of the player). */
  timeSinkRef: React.MutableRefObject<((t: number) => void) | null>;
  onSeek: (seconds: number) => void;
}

export function TranscriptList({ lines, chapters, timeSinkRef, onSeek }: Props) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => transcriptRows(lines, chapters), [lines, chapters]);
  const active = activeLine(lines, t);

  useEffect(() => {
    timeSinkRef.current = setT;
    return () => { timeSinkRef.current = null; };
  }, [timeSinkRef]);

  // Keep the spoken line in view inside the list only — never scroll the page.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!open || !list || !row) return;
    if (row.offsetTop < list.scrollTop || row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop - list.clientHeight / 3;
    }
  }, [active, open]);

  if (!lines.length && !chapters.length) return null;
  return (
    <div className="shrink-0 border-t border-gray-100 dark:border-white/5">
      <button
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {lines.length ? "Transcript" : "Chapters"}
        {lines.length > 0 && chapters.length > 0 && <span className="text-gray-400 font-normal">· {chapters.length} chapters</span>}
      </button>
      {open && (
        <div ref={listRef} className="relative max-h-56 overflow-y-auto px-2 pb-2" role="list">
          {rows.map((r) =>
            r.kind === "chapter" ? (
              <button
                key={`c${r.start}-${r.title}`}
                className="flex w-full items-center gap-2 text-left px-2 pt-3 pb-1 text-[12px] font-semibold text-gray-800 dark:text-gray-100 hover:text-accent-600"
                onClick={() => onSeek(r.start)}
              >
                {r.thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumb} alt="" loading="lazy" className="w-16 aspect-video shrink-0 rounded object-cover bg-gray-100 dark:bg-white/5" />
                )}
                <span>{r.title}</span>
                {r.thumb && <span className="ml-auto shrink-0 tabular-nums text-[11px] font-normal text-gray-400">{clock(r.start)}</span>}
              </button>
            ) : (
              <button
                key={r.index}
                data-line={r.index}
                role="listitem"
                className={`flex w-full gap-2 text-left rounded-md px-2 py-1 text-[12.5px] leading-relaxed transition-colors ${
                  r.index === active
                    ? "bg-accent-50 text-gray-900 dark:bg-accent-900/30 dark:text-gray-100"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5"
                }`}
                onClick={() => onSeek(r.start)}
              >
                <span className="shrink-0 tabular-nums text-[11px] text-gray-400 pt-0.5">{clock(r.start)}</span>
                <span>{r.text}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
