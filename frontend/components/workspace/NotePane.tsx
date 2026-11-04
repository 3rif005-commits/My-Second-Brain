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
import type { BlockEditorHandle, ExtraSlashItem } from "@/components/editor/BlockEditor";
import {
  anchorLabel, sourceColor, wsApi,
  type NoteAnchor, type NoteSource, type SendAction,
} from "@/lib/workspace";
import { anchorRows, findLevelHeadings, readDraftAnchors, type DraftAnchor } from "./anchorHeadings";
import { markdownTableToBlock } from "@/lib/sourceInserts";
import { hasContent, textBlocks } from "./sendBlocks";
import { quotedPassages, type Passage } from "./viewers/passageMarks";

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
  /** Put the note back as it was before the last applied draft. False — and
   *  nothing changed — when there is no snapshot or the user has typed since:
   *  restoring then would throw their edits away. */
  undoApply: () => boolean;
  /** What the editor holds right now (null before it is ready), so a note moved
   *  to another pane or window opens with it rather than with what it opened with. */
  document: () => AnyBlock[] | null;
}

type PendingAnchor = DraftAnchor;

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
  /** Slash-menu entries the workspace supplies — its skills. */
  extraSlashItems?: ExtraSlashItem[];
  /** The source passages the note quotes, on open and after each save (tinted in the PDF). */
  onPassages?: (passages: Passage[]) => void;
  /** Scroll the note along with the source's page or playhead. */
  follow?: boolean;
  /** Shown under the editor while the note is empty: the session's first steps. */
  starters?: (focusEditor: () => void) => React.ReactNode;
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

export function NotePane({
  note, sources, activeSourceId, onJump, actionSinkRef,
  positionSinkRef, applyRef, onApplied, onSavingChange, extraSlashItems, onPassages,
  follow = true, starters,
}: NotePaneProps) {
  const [anchors, setAnchors] = useState<NoteAnchor[]>([]);
  const [ingestHtml, setIngestHtml] = useState<string | undefined>();
  const syncOn = follow;
  const [empty, setEmpty] = useState(() => !hasContent(note.content ?? []));
  const editorRef = useRef<BlockEditorHandle>(null);
  // The page's title heads the pane, as it heads the note page: without it the
  // pane opened on bare text (or nothing) and you couldn't tell which note it was.
  const [title, setTitle] = useState(note.title);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTitle = useCallback((val: string) => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      await fetch(`/api/notes/${note.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: val }),
      });
      window.dispatchEvent(new Event("notes-changed"));
    }, 600);
  }, [note.id]);
  const pendingRef = useRef<{ anchors: (PendingAnchor | null)[]; sourceIds: string[] } | null>(null);
  const anchorsRef = useRef<NoteAnchor[]>([]);
  const lastSyncedBlock = useRef<string | null>(null);
  const reindexDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTextRef = useRef<string>(getPlainText(note.content ?? []));
  const userEditedRef = useRef(false);   // a real user keystroke since the last applied draft
  const applyingRef = useRef(false);     // a programmatic apply is in flight
  const beforeApplyRef = useRef<AnyBlock[] | null>(null);  // the note before the last draft
  const appliedOnceRef = useRef(false);  // a draft has been applied in THIS session

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
    const headings = findLevelHeadings(blocks, 3);
    if (headings.length !== pending.anchors.length) {
      // The positional zip only holds while parsed level-3 headings line up 1:1
      // with the draft's <h3>s. Say so loudly rather than pinning anchors to the
      // wrong sections.
      console.warn(
        `[workspace] anchor/heading mismatch: ${pending.anchors.length} <h3> in the draft ` +
        `vs ${headings.length} level-3 heading blocks — anchoring the first ` +
        `${Math.min(headings.length, pending.anchors.length)} only`);
    }
    const rows = anchorRows(blocks, pending.anchors, pending.sourceIds);
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

  // ── save ──────────────────────────────────────────────────────────────────
  const passagesRef = useRef(onPassages);
  passagesRef.current = onPassages;
  useEffect(() => { passagesRef.current?.(quotedPassages(note.content)); }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async (blocks: AnyBlock[], plainText: string) => {
    currentTextRef.current = plainText;
    setEmpty(!hasContent(blocks));
    passagesRef.current?.(quotedPassages(blocks));
    onSavingChange?.(true);
    // Returns whether the note is durably stored — `persistApplied` below only
    // marks a synthesis draft applied once this has actually succeeded.
    const ok = await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: blocks, content_text: plainText }),
    }).then((r) => r.ok).catch(() => false);
    onSavingChange?.(false);
    if (reindexDebounceRef.current) clearTimeout(reindexDebounceRef.current);
    reindexDebounceRef.current = setTimeout(() => {
      fetch("/api/internal/reindex-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_id: note.id }),
      }).catch(() => {});
    }, 30_000);
    return ok;
  }, [note.id, onSavingChange]);

  /** Save a freshly applied draft, and only then tell the caller it landed.
   *
   *  `onApplied` sets `applied_at` server-side, which is the permanent "this
   *  draft is done" flag — the client never applies a draft again once it is
   *  set. Firing it as soon as the blocks hit the EDITOR (which is what used to
   *  happen) meant the flag could be recorded while the content was still
   *  sitting in BlockNote's ~2s autosave debounce: navigate away inside that
   *  window and the note was never PATCHed, yet the draft was marked applied and
   *  became unreachable. Observed live — a re-synthesis was silently discarded
   *  and the note kept the previous draft. Saving explicitly here, and marking
   *  only on a confirmed write, closes that window. */
  const persistApplied = useCallback(async () => {
    // Always the editor's own document. The append path's callback resolves with
    // only the appended slice, and this PATCHes whatever it is handed — writing
    // that slice would replace the note with just the new tail.
    const blocks = editorRef.current?.getDocument() ?? [];
    // A draft never applies to nothing. An empty document here means the editor
    // was not ready, and saving it would wipe the note.
    if (blocks.length === 0) return;
    const ok = await handleSave(blocks, getPlainText(blocks));
    if (ok) onApplied();
  }, [handleSave, onApplied]);

  // ── synthesis apply API (used by useSynthesis) ─────────────────────────────
  const collect = useCallback((html: string, sourceIds: string[]) => {
    pendingRef.current = { anchors: readDraftAnchors(html), sourceIds };
  }, []);

  // Close the apply window on a later tick: BlockNote's change events for the
  // apply can arrive after the apply callback returns.
  const finishApply = useCallback(() => {
    userEditedRef.current = false;
    appliedOnceRef.current = true;
    setTimeout(() => { applyingRef.current = false; }, 400);
  }, []);

  useEffect(() => {
    applyRef.current = {
      apply: (html, sourceIds, mode) => {
        // What the note held before this draft, for Undo.
        beforeApplyRef.current = structuredClone(editorRef.current?.getDocument() ?? []);
        collect(html, sourceIds);
        applyingRef.current = true;
        if (mode === "append") {
          editorRef.current?.insertHtmlAtEnd(html).then((blocks) => {
            registerAnchors(blocks, "append");
            finishApply();
            void persistApplied();
          }).catch(() => { applyingRef.current = false; });
        } else {
          setIngestHtml(html);   // BlockEditor's proven replace path
        }
      },
      undoApply: () => {
        const before = beforeApplyRef.current;
        if (!before || userEditedRef.current || !editorRef.current) return false;
        beforeApplyRef.current = null;
        applyingRef.current = true;           // not the user's typing
        editorRef.current.replaceDocument(before);
        setTimeout(() => { applyingRef.current = false; }, 400);
        // The draft's section anchors went with its blocks; left in place they
        // stayed as "Jump to" chips pointing at nothing.
        const live = new Set(editorRef.current.blockIds());
        const kept = anchorsRef.current.filter((a) => live.has(a.block_id));
        if (kept.length !== anchorsRef.current.length) {
          anchorsRef.current = kept;
          setAnchors(kept);
          wsApi.putAnchors(note.id, kept).catch(() => {});
        }
        const blocks = editorRef.current.getDocument();
        void handleSave(blocks, getPlainText(blocks));
        return true;
      },
      document: () => editorRef.current?.getDocument() ?? null,
      hasUserEdits: () => {
        // Without a draft applied in this session we cannot prove where the
        // note's content came from, so treat any content as the user's —
        // judged by blocks, not text: captured frames and clips have no text.
        if (userEditedRef.current) return true;
        if (!appliedOnceRef.current) return hasContent(editorRef.current?.getDocument() ?? []);
        return false;
      },
    };
    return () => { applyRef.current = null; };
  }, [applyRef, collect, registerAnchors, persistApplied, finishApply, handleSave, note.id]);

  const handleBlocksApplied = useCallback((blocks: AnyBlock[]) => {
    registerAnchors(blocks, "replace");
    finishApply();
    void persistApplied();
  }, [registerAnchors, persistApplied, finishApply]);

  const markDirty = useCallback(() => {
    // BlockNote fires onChange for our own replaceBlocks/insertBlocks too, and
    // may do so after the apply callback has run — so an apply window, not a
    // post-hoc reset, is what keeps a programmatic change from looking like typing.
    if (!applyingRef.current) userEditedRef.current = true;
  }, []);

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
      blocks.push(...textBlocks(action.text, action.page,
        { noteId: note.id, resourceId: activeSourceId ?? "" }));
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
    // Lands under the block the user last had their cursor in, not at the end
    // of the note — sending a table from page 12 while reading section 3 should
    // put it in section 3. Falls back to appending when the editor has never
    // been focused.
    if (blocks.length) ed.insertBlocksAtCursor(blocks);
  }, [note.id, activeSourceId]);

  useEffect(() => {
    actionSinkRef.current = handleAction;
    return () => { actionSinkRef.current = null; };
  }, [actionSinkRef, handleAction]);

  // ── render ────────────────────────────────────────────────────────────────
  // Each anchored heading gets its source's colour as a dot in the margin;
  // clicking it opens that place in the source. (Was a "Jump to §2 §2 §4" chip
  // bar, which named nothing.)
  const dotAnchors = useMemo(() => {
    const live = new Set(sources.map((s) => s.id));
    return anchors.filter((a) => live.has(a.resource_id));
  }, [anchors, sources]);
  const contentRef = useRef<HTMLDivElement>(null);
  const [dots, setDots] = useState<{ a: NoteAnchor; top: number }[]>([]);
  useEffect(() => {
    const box = contentRef.current;
    if (!box) return;
    const place = () => {
      const base = box.getBoundingClientRect().top;
      const next: { a: NoteAnchor; top: number }[] = [];
      for (const a of dotAnchors) {
        const el = box.querySelector(`[data-id="${CSS.escape(a.block_id)}"] .bn-inline-content`);
        if (el) next.push({ a, top: el.getBoundingClientRect().top - base });
      }
      setDots((prev) => (JSON.stringify(prev.map((d) => [d.a.block_id, d.top]))
        === JSON.stringify(next.map((d) => [d.a.block_id, d.top])) ? prev : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(box);
    return () => ro.disconnect();
  }, [dotAnchors]);

  const focusEditor = useCallback(() => {
    contentRef.current?.querySelector<HTMLElement>(".bn-editor")?.focus();
  }, []);

  return (
    <div className="h-full min-w-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div ref={contentRef} className="relative px-6 py-5">
          {dots.map(({ a, top }) => {
            const src = sourceById.get(a.resource_id);
            const where = `${src?.title ?? "source"} · ${anchorLabel(a.anchor_type, a.anchor_start)}`;
            return (
              <button
                key={a.block_id}
                type="button"
                onClick={() => jumpToAnchor(a)}
                aria-label={`Open ${where}`}
                title={`From ${where}`}
                className="absolute left-1 flex size-4 items-center justify-center rounded-full hover:bg-surface-hover"
                style={{ top: top + 4 }}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: sourceColor(src?.order_index ?? 0) }} />
              </button>
            );
          })}
          <label htmlFor={`pane-title-${note.id}`} className="sr-only">Note title</label>
          <input
            id={`pane-title-${note.id}`}
            className="mb-3 w-full border-none bg-transparent px-0 text-[30px] font-bold leading-[38px] text-ink outline-none placeholder:text-ink-placeholder"
            value={title}
            placeholder="Untitled"
            onChange={(e) => { setTitle(e.target.value); saveTitle(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusEditor(); } }}
          />
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
            extraSlashItems={extraSlashItems}
          />
          {empty && starters?.(focusEditor)}
        </div>
      </div>
    </div>
  );
}
