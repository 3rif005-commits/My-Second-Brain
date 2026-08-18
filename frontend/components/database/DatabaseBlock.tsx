"use client";

// Inline databases in BlockNote (Milestone 11, task-36) — the other entry
// point Notion has for a database besides its own full page
// (app/(brain)/brain/db/[databaseId]/page.tsx -> DatabaseShell.tsx). A
// `database` block is a contentEditable={false} island that either mints a
// brand-new database on first insert (empty databaseId prop) or renders the
// existing one's active view (table only — see InlineDatabaseTable below).
import { useContext, useEffect, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { NoteIdContext } from "../editor/noteIdContext";
import { useDatabaseView } from "@/lib/database/useDatabaseView";
import { TableView } from "./views/TableView";
import type { DatabaseDetailResponse } from "@/lib/database/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

/** Same body-shape convention as Sidebar.tsx's handleNewDatabase: FastAPI's
 * HTTPException responses are `{"detail": "..."}`. */
async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.detail || body?.error || `Request failed (${res.status})`;
}

export const DatabaseBlockSpec = createReactBlockSpec(
  {
    type: "database",
    // Spec text (§11.3) calls these dataSourceId/viewId; this app operates
    // at *database* granularity everywhere else (useDatabaseView(databaseId),
    // the /brain/db/[databaseId] route) and has no "database by data source
    // id" lookup, so the stored key is databaseId — see task-36-brief.md.
    propSchema: {
      databaseId: { default: "" },
      viewId: { default: "" },
    },
    content: "none",
  },
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: ({ block, editor }: { block: any; editor: any }) => (
      <div contentEditable={false}>
        <InlineDatabaseView block={block} editor={editor} />
      </div>
    ),
  }
);

/** Inserts a fresh `database` block (empty databaseId/viewId — filled in by
 * InlineDatabaseView on mount) immediately after `afterBlockId`, or at the
 * end of the document when no block id is given. Extracted out of the slash
 * menu's onItemClick so it's a directly unit-testable function against a
 * real BlockNoteEditor instance, mirroring BlockEditor's own
 * `insertBlocksAtEnd` fallback (last top-level block, or replaceBlocks on an
 * empty document). */
export function insertDatabaseBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  afterBlockId: string | undefined
) {
  const newBlock = { type: "database", props: { databaseId: "", viewId: "" } };
  if (afterBlockId) {
    editor.insertBlocks([newBlock], afterBlockId, "after");
    return;
  }
  const doc = editor.document as AnyBlock[];
  const last = doc[doc.length - 1];
  if (last) {
    editor.insertBlocks([newBlock], last.id, "after");
  } else {
    editor.replaceBlocks(editor.document, [newBlock]);
  }
}

// Exported (not just used internally by DatabaseBlockSpec's render) so
// DatabaseBlock.test.tsx can mount each independently rather than only
// through the full BlockNote render pipeline.
export function InlineDatabaseView({ block, editor }: { block: AnyBlock; editor: AnyBlock }) {
  const noteId = useContext(NoteIdContext);
  const [error, setError] = useState<string | null>(null);
  // Guards a StrictMode/re-render double-fire from minting two databases
  // for the same freshly-inserted block — same convention as TableView.tsx's
  // `databasesFetchStarted` ref (a ref, not `databaseId` state, since
  // setting state itself would re-run this effect before the in-flight
  // POST resolves).
  const startedRef = useRef(false);

  const databaseId: string = block.props.databaseId;
  const viewId: string = block.props.viewId;

  useEffect(() => {
    if (databaseId || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/db/databases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Untitled", parent_note_id: noteId || null }),
        });
        if (!res.ok) throw new Error(await errorMessage(res));
        const created: DatabaseDetailResponse = await res.json();
        editor.updateBlock(block, {
          props: { databaseId: created.database.id, viewId: created.views[0]?.id ?? "" },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create database");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId]);

  if (error) {
    return (
      <div className="my-1 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (!databaseId) {
    return (
      <div className="my-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-400 dark:text-gray-500">
        Creating database…
      </div>
    );
  }

  return <InlineDatabaseTable databaseId={databaseId} viewId={viewId} />;
}

export function InlineDatabaseTable({ databaseId, viewId }: { databaseId: string; viewId: string }) {
  const {
    database,
    dataSource,
    properties,
    views,
    activeViewId,
    setActiveViewId,
    rows,
    loading,
    error,
    updateCell,
    refetch,
    refetchRows,
    relationLinks,
    ensureRelationLinks,
    ensureRelationLinksBulk,
    setRelationLinks,
  } = useDatabaseView(databaseId);

  // The block's own `viewId` prop (if set and valid) wins over the hook's
  // default-to-views[0] — but only once; this must not fight the hook's own
  // default once the two already agree, or a user manually switching tabs
  // inline (not built by this task, but the underlying activeViewId state
  // is still the hook's) would get yanked back every render.
  useEffect(() => {
    if (viewId && viewId !== activeViewId && views.some((v) => v.id === viewId)) {
      setActiveViewId(viewId);
    }
  }, [viewId, activeViewId, views, setActiveViewId]);

  if (loading && !database) {
    return (
      <div className="my-1 px-3 py-2 text-sm text-gray-400 dark:text-gray-500">Loading…</div>
    );
  }

  if (error && !database) {
    return <div className="my-1 px-3 py-2 text-sm text-red-500">{error}</div>;
  }

  if (!database || !dataSource) return null;

  const activeView = views.find((v) => v.id === activeViewId) ?? views[0] ?? null;
  const href = `/brain/db/${databaseId}`;

  return (
    <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
        {database.icon && <span className="text-base leading-none">{database.icon}</span>}
        <a
          href={href}
          className="text-sm font-medium text-gray-800 dark:text-gray-200 no-underline hover:underline"
        >
          {database.title}
        </a>
      </div>
      {/* overscroll-contain stops scroll *chaining* past this table's own
       * scroll boundary into the outer note editor/page once the table
       * itself is scrolled to its end — see task-36-brief.md's "nested
       * virtualiser does not capture editor scroll" test case. No
       * virtualizer library involved (none exists anywhere in this
       * codebase's database views today), just a bounded-height wrapper. */}
      <div className="max-h-96 overflow-auto overscroll-contain">
        {activeView?.type === "table" ? (
          <TableView
            properties={properties}
            rows={rows}
            editable={true}
            onCellChange={updateCell}
            dataSourceId={dataSource.id}
            refetch={refetch}
            refetchRows={refetchRows}
            relationLinks={relationLinks}
            ensureRelationLinks={ensureRelationLinks}
            ensureRelationLinksBulk={ensureRelationLinksBulk}
            setRelationLinks={setRelationLinks}
          />
        ) : (
          // Scope cut (task-36-brief.md §3): no inline view-switcher tabs.
          // Every freshly created database's one view is `table` (see
          // create_database), so this path is only reached for a
          // pre-existing database embedded inline whose default view was
          // since changed to something else.
          <div className="px-3 py-4 text-sm text-gray-400 dark:text-gray-500">
            This view isn&apos;t supported inline yet —{" "}
            <a href={href} className="text-indigo-500 hover:underline">
              open the full database
            </a>
            .
          </div>
        )}
      </div>
    </div>
  );
}
