"use client";

// The note half of the compact workspace shell.
//
// Everything that used to live in SplitView, moved here unchanged in substance:
// the editor host, the synthesis-HTML → blocks handoff, anchor collection and
// registration, forward/reverse sync, the send-to-note bus, autosave + debounced
// reindex. What changed is that anchors are now source-indexed ("2:p:14"), so a
// single note's sections can point at several different sources.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Link2 } from "lucide-react";
import type { BlockEditorHandle } from "@/components/editor/BlockEditor";
import {
  anchorLabel, parseSourceAnchor, sourceColor, wsApi,
  type AnchorType, type NoteAnchor, type NoteSource, type SendAction,
} from "@/lib/workspace";

const BlockEditor = dynamic(
  () => import("@/components/editor/BlockEditor").then((m) => m.BlockEditor),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-gray-50 dark:bg-gray-800 rounded-lg m-4" /> }
) as React.ForwardRefExoticComponent<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any & React.RefAttributes<BlockEditorHandle>
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export interface NoteData {
  id: string;
  title: string;
  content: AnyBlock[];
}

export interface NoteApplyApi {
  /** Apply a synthesis draft. `sourceIds` is the draft's source order — the
   *  1-based source index inside each data-anchor indexes into it. */
  apply: (html: string, sourceIds: string[], mode: "replace" | "append") => void;
  /** True when the note holds content that did not come from the last applied
   *  draft — i.e. the user's own work is in there and must not be clobbered. */
  hasUserEdits: () => boolean;
}

interface PendingAnchor { sourceIndex: number; type: AnchorType; value: number }

interface NotePaneProps {
  note: NoteData;
  sources: NoteSource[];
  activeSourceId: string | null;
  /** Switch the viewer to a source (if needed) and seek it once it is ready.
   *  The shell owns the ordering — clearing the outgoing viewer's seek function
   *  and setting the active source have to happen together. */
  onJump: (sourceId: string, value: number) => void;
  /** NotePane publishes its send-to-note sink here so the viewer can push blocks. */
  actionSinkRef: React.MutableRefObject<((a: SendAction) => void) | null>;
  /** NotePane publishes its forward-sync handler here (source position → block). */
  positionSinkRef: React.MutableRefObject<((value: number) => void) | null>;
  applyRef: React.MutableRefObject<NoteApplyApi | null>;
  onApplied: () => void;
  onSavingChange?: (saving: boolean) => void;
}

function getPlainText(blocks: AnyBlock[]): string {
  return blocks
    .map((b: AnyBlock) => {
      const inline = Array.isArray(b.content)
        ? b.content.map((c: AnyBlock) => (c?.type === "text" ? c.text ?? "" : "")).join("")
        : "";
      const child = b.children?.length ? getPlainText(b.children) : "";
      return [inline, child].filter(Boolean).join("\n");
    })
    .join("\n");
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function markdownTableToBlock(md: string): AnyBlock | null {
  const rows = md.trim().split("\n")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("|"))
    .filter((r) => !/^\|[\s:|-]+\|$/.test(r)) // drop separator row
    .map((r) => r.slice(1, r.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim()));
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((r) => r.length));
  return {
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((cells) => ({
        cells: Array.from({ length: width }, (_, i) => [
          { type: "text", text: cells[i] ?? "", styles: {} },
        ]),
      })),
    },
  };
}

export function NotePane({
  note, sources, activeSourceId, onJump, actionSinkRef,
  positionSinkRef, applyRef, onApplied, onSavingChange,
}: NotePaneProps) {
  const [anchors, setAnchors] = useState<NoteAnchor[]>([]);
  const [ingestHtml, setIngestHtml] = useState<string | undefined>();
  const [syncOn, setSyncOn] = useState(true);
  const editorRef = useRef<BlockEditorHandle>(null);
  const pendingRef = useRef<{ anchors: (PendingAnchor | null)[]; sourceIds: string[] } | null>(null);
  const anchorsRef = useRef<NoteAnchor[]>([]);
  const dirtyRef = useRef(false);
  const lastSyncedBlock = useRef<string | null>(null);
  const reindexDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTextRef = useRef<string>(getPlainText(note.content ?? []));
  const baselineTextRef = useRef<string | null>(null);

  // ── anchors ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    wsApi.getAnchors(note.id)
      .then((a) => { if (!cancelled) { anchorsRef.current = a; setAnchors(a); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [note.id]);

  const sourceById = useMemo(
    () => new Map(sources.map((s) => [s.id, s])), [sources]);

  const registerAnchors = useCallback((blocks: AnyBlock[], mode: "replace" | "append") => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending || pending.anchors.length === 0) return;
    const headings = blocks.filter(
      (b: AnyBlock) => b.type === "heading" && (b.props?.level ?? 1) === 2);
    if (headings.length !== pending.anchors.length) {
      // The positional zip only holds while parsed level-2 headings line up 1:1
      // with the draft's <h2>s. Say so loudly rather than pinning anchors to the
      // wrong sections.
      console.warn(
        `[workspace] anchor/heading mismatch: ${pending.anchors.length} <h2> in the draft ` +
        `vs ${headings.length} level-2 heading blocks — anchoring the first ` +
        `${Math.min(headings.length, pending.anchors.length)} only`);
    }
    const rows: NoteAnchor[] = [];
    headings.forEach((h: AnyBlock, i: number) => {
      const p = pending.anchors[i];
      if (!p) return;                          // that <h2> carried no anchor
      const rid = pending.sourceIds[p.sourceIndex - 1];
      if (!rid) return;                        // model invented a source index
      rows.push({
        block_id: h.id, resource_id: rid, anchor_type: p.type,
        anchor_start: p.value, anchor_end: p.value,
      });
    });
    if (rows.length === 0) return;
    // Read through the ref, not state: two appends can land before React
    // re-renders, and PUT replaces every row, so a stale list would erase the
    // earlier one. Drop anchors whose block the user has since deleted.
    const live = new Set(editorRef.current?.blockIds() ?? []);
    const kept = mode === "append"
      ? anchorsRef.current.filter((a) => live.has(a.block_id))
      : [];
    const merged = [...kept, ...rows];
    anchorsRef.current = merged;
    setAnchors(merged);
    wsApi.putAnchors(note.id, merged).catch(() => {});
  }, [note.id]);

  // ── synthesis apply API (used by useSynthesis) ─────────────────────────────
  const collect = useCallback((html: string, sourceIds: string[]) => {
    // Read anchors in document order BEFORE BlockNote parsing strips unknown
    // attributes. One entry per <h2> — null where that heading carried none —
    // so the zip against parsed heading blocks stays aligned.
    const doc = new window.DOMParser().parseFromString(html, "text/html");
    const list: (PendingAnchor | null)[] = [];
    doc.querySelectorAll("h2").forEach((h) => {
      const raw = h.getAttribute("data-anchor");
      list.push(raw ? parseSourceAnchor(raw) : null);
    });
    pendingRef.current = { anchors: list, sourceIds };
  }, []);

  useEffect(() => {
    applyRef.current = {
      apply: (html, sourceIds, mode) => {
        collect(html, sourceIds);
        baselineTextRef.current = null;
        if (mode === "append") {
          editorRef.current?.insertHtmlAtEnd(html).then((blocks) => {
            registerAnchors(blocks, "append");
            baselineTextRef.current = currentTextRef.current;
            dirtyRef.current = false;
            onApplied();
          }).catch(() => {});
        } else {
          setIngestHtml(html);   // BlockEditor's proven replace path
        }
      },
      hasUserEdits: () => {
        // Dirty beats text comparison: autosave is debounced ~2s, so the text
        // snapshot lags the editor and must never be the only signal.
        if (dirtyRef.current) return true;
        const cur = normalize(currentTextRef.current);
        if (!cur) return false;
        if (baselineTextRef.current !== null
            && normalize(baselineTextRef.current) === cur) return false;
        return true;   // content we can't prove came from a draft → the user's
      },
    };
    return () => { applyRef.current = null; };
  }, [applyRef, collect, registerAnchors, onApplied]);

  const handleBlocksApplied = useCallback((blocks: AnyBlock[]) => {
    registerAnchors(blocks, "replace");
    baselineTextRef.current = getPlainText(blocks);
    dirtyRef.current = false;
    onApplied();
  }, [registerAnchors, onApplied]);

  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);

  // ── save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async (blocks: AnyBlock[], plainText: string) => {
    currentTextRef.current = plainText;
    onSavingChange?.(true);
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: blocks, content_text: plainText }),
    }).catch(() => {});
    onSavingChange?.(false);
    if (reindexDebounceRef.current) clearTimeout(reindexDebounceRef.current);
    reindexDebounceRef.current = setTimeout(() => {
      fetch("/api/internal/reindex-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_id: note.id }),
      }).catch(() => {});
    }, 30_000);
  }, [note.id, onSavingChange]);

  // ── forward sync: active source position → highlight the matching block ───
  const activeAnchors = useMemo(
    () => anchors.filter((a) => a.resource_id === activeSourceId)
      .sort((a, b) => a.anchor_start - b.anchor_start),
    [anchors, activeSourceId]);

  const handlePosition = useCallback((value: number) => {
    if (!syncOn || activeAnchors.length === 0) return;
    let match: NoteAnchor | null = null;
    for (const a of activeAnchors) {
      if (a.anchor_start <= value + 0.01) match = a;
      else break;
    }
    if (match && match.block_id !== lastSyncedBlock.current) {
      lastSyncedBlock.current = match.block_id;
      editorRef.current?.scrollToBlock(match.block_id);
    }
  }, [syncOn, activeAnchors]);

  useEffect(() => {
    positionSinkRef.current = handlePosition;
    return () => { positionSinkRef.current = null; };
  }, [positionSinkRef, handlePosition]);

  // ── reverse sync: section chip → switch source, seek, scroll the note ─────
  const jumpToAnchor = useCallback((a: NoteAnchor) => {
    onJump(a.resource_id, a.anchor_start);
    editorRef.current?.scrollToBlock(a.block_id);
    lastSyncedBlock.current = a.block_id;
  }, [onJump]);

  // ── send-to-note bus ──────────────────────────────────────────────────────
  const handleAction = useCallback((action: SendAction) => {
    const ed = editorRef.current;
    if (!ed) return;
    const blocks: AnyBlock[] = [];
    if (action.type === "text") {
      for (const para of action.text.split("\n\n")) {
        if (para.trim()) blocks.push({ type: "paragraph", content: para.trim() });
      }
    } else if (action.type === "image") {
      blocks.push({ type: "image", props: { url: action.url, caption: action.caption ?? "" } });
    } else if (action.type === "table") {
      const t = markdownTableToBlock(action.markdown);
      if (t) blocks.push(t);
      else if (action.markdown.trim()) blocks.push({ type: "paragraph", content: action.markdown });
    } else if (action.type === "latex") {
      blocks.push({ type: "math", props: { latex: action.latex } });
    } else if (action.type === "checkpoint") {
      blocks.push({
        type: "checkpoint",
        props: {
          noteId: note.id,
          resourceId: activeSourceId ?? "",
          anchorType: action.anchorType,
          value: String(action.value),
          label: action.label ?? "",
        },
      });
    } else if (action.type === "clip") {
      blocks.push({ type: "video", props: { url: action.url, caption: action.label ?? "" } });
    } else if (action.type === "audio") {
      blocks.push({ type: "audio", props: { url: action.url, caption: action.label ?? "" } });
    }
    if (blocks.length) ed.insertBlocksAtEnd(blocks);
  }, [note.id, activeSourceId]);

  useEffect(() => {
    actionSinkRef.current = handleAction;
    return () => { actionSinkRef.current = null; };
  }, [actionSinkRef, handleAction]);

  // ── render ────────────────────────────────────────────────────────────────
  const chips = useMemo(() => {
    const order = new Map(sources.map((s) => [s.id, s.order_index]));
    // A source that has been removed takes its chips with it — keeping them would
    // mean a dead jump target wearing whichever colour order_index 0 happens to be.
    return [...anchors]
      .filter((a) => order.has(a.resource_id))
      .sort((a, b) => (order.get(a.resource_id) ?? 99) - (order.get(b.resource_id) ?? 99)
        || a.anchor_start - b.anchor_start);
  }, [anchors, sources]);

  return (
    <div className="h-full min-w-0 flex flex-col bg-white dark:bg-gray-900">
      {chips.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 overflow-x-auto shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-1 shrink-0">
            Sections
          </span>
          {chips.map((a) => {
            const src = sourceById.get(a.resource_id);
            return (
              <button
                key={a.block_id}
                onClick={() => jumpToAnchor(a)}
                title={`${src?.title ?? "source"} — ${anchorLabel(a.anchor_type, a.anchor_start)}`}
                className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 hover:text-indigo-600 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: sourceColor(src?.order_index ?? 0) }} />
                {anchorLabel(a.anchor_type, a.anchor_start)}
              </button>
            );
          })}
          <button
            onClick={() => setSyncOn((v) => !v)}
            title="Toggle source ↔ note sync"
            className={`ml-auto shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border transition-colors ${
              syncOn
                ? "border-indigo-300 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
                : "border-gray-200 text-gray-400 dark:border-gray-700"
            }`}
          >
            <Link2 size={10} /> {syncOn ? "on" : "off"}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-5 py-4">
          <BlockEditor
            ref={editorRef}
            noteId={note.id}
            initialContent={
              Array.isArray(note.content) && note.content.length > 0
                ? note.content : undefined
            }
            onSave={handleSave}
            ingestHtml={ingestHtml}
            onBlocksApplied={handleBlocksApplied}
            onDirty={markDirty}
          />
        </div>
      </div>
    </div>
  );
}
