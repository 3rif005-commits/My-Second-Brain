"use client";

// A row's "page" as a side peek — matches Notion's own default row-click
// behavior (open a panel over the table, not navigate away to a full
// page). Controller design, approved by the user after they found
// TableView's row click did nothing: previously the only way to see a
// row's body/content at all was "Open in Workspace" (the heavier
// sources/AI-synthesis/chat experience) or nothing. This is the
// lightweight middle ground — properties + body, editable, without leaving
// the table.
//
// Scope (TableView-only for now, by design — see the brainstorm this was
// approved from): reuses exactly the same per-type cell components
// TableView's own columns render (`renderCellValue`), the same
// `onCellChange` write path, and the same `BlockEditor` body component
// `NoteEditorPage.tsx` uses (dynamically imported with `ssr: false`,
// mirroring that file's own pattern — BlockNote has browser-only
// dependencies). No backend changes: the property data comes from props
// already loaded by TableView; only the note's body content is fetched
// fresh here, via the pre-existing `GET/PATCH /api/notes/{id}` routes
// `NoteEditorPage.tsx` already uses, not a new endpoint.
//
// Relation and button property cells fall back to `renderCellValue`'s own
// existing read-only degradation (no `relation`/`button` handler argument
// passed) — the same "older/other caller" convention this codebase already
// established for Board/Gallery/List/Feed, not a regression specific to
// this component. Full relation/button interactivity in the peek is a
// disclosed, deliberately-deferred follow-up, not silently dropped.
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { BlockEditorHandle } from "../editor/BlockEditor";
import { noteWorkspacePath } from "@/lib/database/useOpenNote";
import type { DatabaseRow, PropertyResponse, PropertyValue } from "@/lib/database/types";
import { renderCellValue } from "./cells/renderCellValue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

// Same dynamic-import shape NoteEditorPage.tsx uses — BlockNote depends on
// browser-only APIs, and casting is needed to preserve forwardRef through
// next/dynamic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BlockEditor = dynamic(
  () => import("../editor/BlockEditor").then((m) => m.BlockEditor),
  { ssr: false, loading: () => <div className="h-48 animate-pulse bg-gray-50 dark:bg-gray-800 rounded-lg" /> }
) as React.ForwardRefExoticComponent<
  React.ComponentProps<typeof import("../editor/BlockEditor").BlockEditor> &
    React.RefAttributes<BlockEditorHandle>
>;

export interface RowPeekProps {
  row: DatabaseRow;
  properties: PropertyResponse[];
  editable: boolean;
  onCellChange: (rowId: string, propertyKey: string, value: PropertyValue | null) => void;
  onClose: () => void;
}

export function RowPeek({ row, properties, editable, onCellChange, onClose }: RowPeekProps) {
  const router = useRouter();
  const [content, setContent] = useState<AnyBlock[] | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const reindexDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleProperty = properties.find((p) => p.type === "title");
  const otherProperties = properties
    .filter((p) => p.type !== "title")
    .slice()
    .sort((a, b) => a.position - b.position);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    fetch(`/api/notes/${row.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((note) => {
        if (cancelled) return;
        setContent(note?.content ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setContent([]);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (reindexDebounceRef.current) clearTimeout(reindexDebounceRef.current);
    };
  }, []);

  async function handleSaveContent(blocks: AnyBlock[], plainText: string) {
    await fetch(`/api/notes/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: blocks, content_text: plainText }),
    });

    // Debounced re-index, same 30s cadence NoteEditorPage.tsx uses — best
    // effort, never blocks the save.
    if (reindexDebounceRef.current) clearTimeout(reindexDebounceRef.current);
    reindexDebounceRef.current = setTimeout(() => {
      fetch("/api/internal/reindex-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_id: row.id }),
      }).catch(() => {
        // silent — reindex is best-effort
      });
    }, 30_000);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/30 flex justify-end z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-label="Row details"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="h-full w-full max-w-2xl bg-white dark:bg-gray-900 shadow-xl overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between gap-2 px-6 py-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => router.push(`/brain/${row.id}`)}
              className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Open as full page
            </button>
            <button
              type="button"
              onClick={() => router.push(noteWorkspacePath(row.id))}
              className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Open in Workspace
            </button>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1 rounded"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-4">
          {titleProperty && (
            <div className="text-xl font-semibold mb-4">
              {renderCellValue(
                titleProperty,
                row.properties[titleProperty.key],
                editable,
                (value) => onCellChange(row.id, titleProperty.key, value)
              )}
            </div>
          )}

          {otherProperties.length > 0 && (
            <div className="space-y-2 mb-6 pb-6 border-b border-gray-100 dark:border-gray-800">
              {otherProperties.map((property) => (
                <div key={property.key} className="grid grid-cols-[120px_1fr] items-center gap-3 text-sm">
                  <span className="text-gray-500 dark:text-gray-400 truncate">{property.name}</span>
                  <div>
                    {renderCellValue(
                      property,
                      row.properties[property.key],
                      editable,
                      (value) => onCellChange(row.id, property.key, value)
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {loaded ? (
            <BlockEditor noteId={row.id} initialContent={content} onSave={handleSaveContent} />
          ) : (
            <div className="h-48 animate-pulse bg-gray-50 dark:bg-gray-800 rounded-lg" />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
