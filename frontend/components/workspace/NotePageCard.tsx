"use client";

import { memo } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { StickyNote, ExternalLink } from "lucide-react";
import type { WsPage } from "@/lib/workspace";

export interface PageNodeData {
  page: WsPage;
  /** Open in split view (with source when this note is a resource's output). */
  onOpen: (page: WsPage) => void;
  onRemove: (page: WsPage) => void;
  [key: string]: unknown;
}

function NotePageCardInner({ data, selected }: NodeProps) {
  const { page, onOpen, onRemove } = data as PageNodeData;
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={200} minHeight={140} />
      <div
        className="w-full h-full flex flex-col rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 shadow-sm hover:shadow-md transition-shadow overflow-hidden select-none"
        onDoubleClick={() => onOpen(page)}
        title="Double-click to open"
      >
        <div className="flex items-center gap-1.5 px-2.5 pt-2">
          <StickyNote size={13} className="text-amber-500 shrink-0" />
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">
            {page.note_title || "Untitled"}
          </span>
          <a
            href={`/brain/${page.note_id}`}
            className="ml-auto text-gray-300 hover:text-indigo-500"
            title="Open as full note"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={12} />
          </a>
          <button
            className="text-[10px] text-gray-300 hover:text-red-400"
            onClick={(e) => { e.stopPropagation(); onRemove(page); }}
            title="Remove from canvas (note is kept)"
          >
            ✕
          </button>
        </div>
        <p className="flex-1 min-h-0 px-2.5 py-1.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400 overflow-hidden">
          {page.note_snippet || "Empty note"}
        </p>
      </div>
    </>
  );
}

export const NotePageCard = memo(NotePageCardInner);
