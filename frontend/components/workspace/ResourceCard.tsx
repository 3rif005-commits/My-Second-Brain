"use client";

import { memo } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { FileText, Globe, Video, MonitorPlay, RefreshCw } from "lucide-react";
import type { WsResource } from "@/lib/workspace";

const KIND_ICON = {
  pdf: FileText,
  document: FileText,
  youtube: MonitorPlay,
  video: Video,
  website: Globe,
} as const;

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300",
  processing: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300",
  ready: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  failed: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
};

export interface ResourceNodeData {
  resource: WsResource;
  onOpen: (resource: WsResource) => void;
  onRetry: (resource: WsResource) => void;
  onDelete: (resource: WsResource) => void;
  [key: string]: unknown;
}

function ResourceCardInner({ data, selected }: NodeProps) {
  const { resource, onOpen, onRetry, onDelete } = data as ResourceNodeData;
  const Icon = KIND_ICON[resource.kind] ?? FileText;
  const thumb = resource.thumbnail_url || (resource.meta?.thumbnail as string | undefined);

  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={180} minHeight={120} />
      <div
        className="w-full h-full flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-shadow overflow-hidden select-none"
        onDoubleClick={() => resource.status === "ready" && onOpen(resource)}
        title={resource.status === "ready" ? "Double-click to open" : resource.title}
      >
        <div className="flex-1 min-h-0 bg-gray-50 dark:bg-gray-900/40 flex items-center justify-center overflow-hidden">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="w-full h-full object-cover" draggable={false} />
          ) : (
            <Icon size={36} className="text-gray-300 dark:text-gray-600" />
          )}
        </div>
        <div className="p-2.5 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-1.5 mb-1">
            <Icon size={13} className="text-gray-400 shrink-0" />
            <span className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">
              {resource.title}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLE[resource.status]}`}>
              {resource.status === "processing" && (
                <RefreshCw size={9} className="inline animate-spin mr-1" />
              )}
              {resource.status}
            </span>
            {resource.status === "failed" && (
              <button
                className="text-[10px] text-indigo-500 hover:underline"
                onClick={(e) => { e.stopPropagation(); onRetry(resource); }}
              >
                retry
              </button>
            )}
            <button
              className="ml-auto text-[10px] text-gray-300 hover:text-red-400"
              onClick={(e) => { e.stopPropagation(); onDelete(resource); }}
              title="Remove resource"
            >
              ✕
            </button>
          </div>
          {resource.status === "failed" && resource.error && (
            <p className="mt-1 text-[10px] text-red-400 line-clamp-2">{resource.error}</p>
          )}
        </div>
      </div>
    </>
  );
}

export const ResourceCard = memo(ResourceCardInner);
