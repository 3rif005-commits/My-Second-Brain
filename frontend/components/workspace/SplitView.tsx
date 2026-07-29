"use client";

// Split view: source viewer (left) ↔ output note in the normal block editor
// (right). The AI summary IS the note — on first open the summary HTML is
// parsed into blocks (same handoff as the classic ingest flow) and per-section
// anchors are registered so the two panes stay in sync both ways.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { X, Link2 } from "lucide-react";
import type { BlockEditorHandle } from "@/components/editor/BlockEditor";
import {
  anchorLabel, wsApi,
  type AnchorType, type NoteAnchor, type SendAction, type WsResource,
} from "@/lib/workspace";
import { PdfViewer } from "./viewers/PdfViewer";
import { YouTubePlayer } from "./viewers/YouTubePlayer";
import { VideoPlayer } from "./viewers/VideoPlayer";
import { WebsiteViewer } from "./viewers/WebsiteViewer";

const BlockEditor = dynamic(
  () => import("@/components/editor/BlockEditor").then((m) => m.BlockEditor),
  { ssr: false, loading: () => <div className="h-40 animate-pulse bg-gray-50 dark:bg-gray-800 rounded-lg m-4" /> }
) as React.ForwardRefExoticComponent<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any & React.RefAttributes<BlockEditorHandle>
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

interface NoteData {
  id: string;
  title: string;
  content: AnyBlock[];
}

interface SplitViewProps {
  workspaceId: string;
  resource: WsResource | null;   // null → note-only view
  noteId: string | null;
  initialSeek?: { type: AnchorType; value: number } | null;
  onClose: () => void;
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

function parseAnchorAttr(v: string): { type: AnchorType; value: number } | null {
  const m = v.match(/^([tps]):([\d.]+)$/);
  if (!m) return null;
  const type: AnchorType = m[1] === "t" ? "time" : m[1] === "p" ? "page" : "section";
  return { type, value: parseFloat(m[2]) };
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

export function SplitView({ workspaceId, resource, noteId, initialSeek, onClose }: SplitViewProps) {
  const [note, setNote] = useState<NoteData | null>(null);
  const [detail, setDetail] = useState<WsResource | null>(null);
  const [anchors, setAnchors] = useState<NoteAnchor[]>([]);
  const [ingestHtml, setIngestHtml] = useState<string | undefined>();
  const [syncOn, setSyncOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<BlockEditorHandle>(null);
  const seekRef = useRef<((value: number) => void) | null>(null);
  const pendingAnchorsRef = useRef<{ anchor: string }[]>([]);
  const lastSyncedBlock = useRef<string | null>(null);
  const reindexDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveNoteId = noteId ?? resource?.note_id ?? null;

  // load resource detail (elements + summary_html)
  useEffect(() => {
    if (!resource) { setDetail(null); return; }
    let cancelled = false;
    wsApi.getResource(resource.id).then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => setDetail(resource));
    return () => { cancelled = true; };
  }, [resource]);

  // load note + anchors; hand summary over as ingestHtml when note is empty
  useEffect(() => {
    if (!effectiveNoteId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/notes/${effectiveNoteId}`);
      if (!res.ok || cancelled) return;
      const n = await res.json();
      setNote({ id: n.id, title: n.title, content: n.content ?? [] });
      const a = await wsApi.getAnchors(effectiveNoteId).catch(() => []);
      if (!cancelled) setAnchors(a);
    })();
    return () => { cancelled = true; };
  }, [effectiveNoteId]);

  useEffect(() => {
    if (!note || !detail?.summary_html) return;
    const empty = !Array.isArray(note.content) || note.content.length === 0;
    if (!empty || ingestHtml) return;
    // Collect data-anchor values (in document order) BEFORE BlockNote parsing
    // strips unknown attributes; they get zipped with heading blocks after.
    const doc = new window.DOMParser().parseFromString(detail.summary_html, "text/html");
    pendingAnchorsRef.current = [...doc.querySelectorAll("h2[data-anchor]")]
      .map((h) => ({ anchor: h.getAttribute("data-anchor") || "" }));
    setIngestHtml(detail.summary_html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, detail]);

  // After the summary HTML is applied: match anchors to level-2 heading blocks
  const handleBlocksApplied = useCallback((blocks: AnyBlock[]) => {
    const pending = pendingAnchorsRef.current;
    if (!pending.length || !detail || !effectiveNoteId) return;
    const headings = blocks.filter(
      (b: AnyBlock) => b.type === "heading" && (b.props?.level ?? 1) === 2);
    const rows: NoteAnchor[] = [];
    headings.forEach((h: AnyBlock, i: number) => {
      const raw = pending[i]?.anchor;
      if (!raw) return;
      const parsed = parseAnchorAttr(raw);
      if (!parsed) return;
      rows.push({
        block_id: h.id,
        resource_id: detail.id,
        anchor_type: parsed.type,
        anchor_start: parsed.value,
        anchor_end: parsed.value,
      });
    });
    if (rows.length) {
      wsApi.putAnchors(effectiveNoteId, rows)
        .then(() => setAnchors(rows))
        .catch(() => {});
    }
    pendingAnchorsRef.current = [];
  }, [detail, effectiveNoteId]);

  const handleSave = useCallback(async (blocks: AnyBlock[], plainText: string) => {
    if (!effectiveNoteId) return;
    setSaving(true);
    await fetch(`/api/notes/${effectiveNoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: blocks, content_text: plainText }),
    }).catch(() => {});
    setSaving(false);
    if (reindexDebounceRef.current) clearTimeout(reindexDebounceRef.current);
    reindexDebounceRef.current = setTimeout(() => {
      fetch("/api/internal/reindex-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_id: effectiveNoteId }),
      }).catch(() => {});
    }, 30_000);
  }, [effectiveNoteId]);

  // ── forward sync: source position → highlight matching note section ──────
  const sortedAnchors = useMemo(
    () => [...anchors].sort((a, b) => a.anchor_start - b.anchor_start),
    [anchors]);

  const handlePosition = useCallback((value: number) => {
    if (!syncOn || sortedAnchors.length === 0) return;
    let match: NoteAnchor | null = null;
    for (const a of sortedAnchors) {
      if (a.anchor_start <= value + 0.01) match = a;
      else break;
    }
    if (match && match.block_id !== lastSyncedBlock.current) {
      lastSyncedBlock.current = match.block_id;
      editorRef.current?.scrollToBlock(match.block_id);
    }
  }, [syncOn, sortedAnchors]);

  // ── reverse sync: anchor chip → seek source + scroll note ────────────────
  const jumpToAnchor = useCallback((a: NoteAnchor) => {
    seekRef.current?.(a.anchor_start);
    editorRef.current?.scrollToBlock(a.block_id);
    lastSyncedBlock.current = a.block_id;
  }, []);

  // deep link (?t= / ?p= / ?s=) → initial seek once the viewer is ready
  useEffect(() => {
    if (!initialSeek) return;
    const timer = setInterval(() => {
      if (seekRef.current) {
        seekRef.current(initialSeek.value);
        clearInterval(timer);
      }
    }, 300);
    const stop = setTimeout(() => clearInterval(timer), 15000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [initialSeek]);

  // ── send-to-note bus ─────────────────────────────────────────────────────
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
          workspaceId,
          resourceId: detail?.id ?? resource?.id ?? "",
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
  }, [workspaceId, detail, resource]);

  const viewer = useMemo(() => {
    if (!detail) return null;
    const common = { onAction: handleAction, seekRef };
    if (detail.kind === "pdf" || detail.kind === "document") {
      return <PdfViewer resource={detail} onPosition={handlePosition} {...common} />;
    }
    if (detail.kind === "youtube") {
      return <YouTubePlayer resource={detail} onPosition={handlePosition} {...common} />;
    }
    if (detail.kind === "video") {
      return <VideoPlayer resource={detail} onPosition={handlePosition} {...common} />;
    }
    return <WebsiteViewer resource={detail} onPosition={handlePosition} {...common} />;
  }, [detail, handleAction, handlePosition]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white dark:bg-gray-900">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
        >
          <X size={16} /> Canvas
        </button>
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
          {detail?.title ?? note?.title ?? ""}
        </span>
        <span className="text-xs text-gray-400 ml-auto">{saving ? "Saving…" : ""}</span>
        {resource && (
          <button
            onClick={() => setSyncOn((v) => !v)}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors ${
              syncOn
                ? "border-indigo-300 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
                : "border-gray-200 text-gray-400 dark:border-gray-700"
            }`}
            title="Toggle source ↔ note sync"
          >
            <Link2 size={12} /> Sync {syncOn ? "on" : "off"}
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* left: source viewer */}
        {resource && (
          <div className="w-1/2 min-w-0 flex flex-col border-r border-gray-200 dark:border-gray-800">
            {viewer ?? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                Loading source…
              </div>
            )}
          </div>
        )}

        {/* right: the output note (ordinary block editor) */}
        <div className={`${resource ? "w-1/2" : "w-full"} min-w-0 flex flex-col`}>
          {/* anchor sync bar */}
          {sortedAnchors.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 overflow-x-auto shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-1 shrink-0">
                Sections
              </span>
              {sortedAnchors.map((a) => (
                <button
                  key={a.block_id}
                  onClick={() => jumpToAnchor(a)}
                  className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 hover:text-indigo-600 transition-colors"
                  title="Jump source and note to this section"
                >
                  {anchorLabel(a.anchor_type, a.anchor_start)}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            {note ? (
              <div className="px-5 py-4">
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">
                  {note.title}
                </h1>
                {detail?.meta?.summary_error != null && (
                  <div className="mb-3 text-xs px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
                    Summary generation failed: {String(detail.meta.summary_error)} — use
                    “retry” on the card to regenerate.
                  </div>
                )}
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
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">
                {effectiveNoteId ? "Loading note…" : "This resource has no note yet — retry processing."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
