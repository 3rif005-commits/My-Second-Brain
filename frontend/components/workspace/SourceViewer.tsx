"use client";

// Thin dispatcher from a source's `kind` onto the proven viewers. It also loads
// the source detail (elements + signed image URLs), which is what the viewers'
// element overlays and send-to-note actions need.
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { wsApi, type NoteSource, type SendAction } from "@/lib/workspace";
import { YouTubePlayer } from "./viewers/YouTubePlayer";
import { VideoPlayer } from "./viewers/VideoPlayer";
import { WebsiteViewer } from "./viewers/WebsiteViewer";

// react-pdf's pdfjs touches DOMMatrix at import time, which does not exist in
// Node — this viewer can never be server-rendered.
const PdfViewer = dynamic(
  () => import("./viewers/PdfViewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-400">
        Loading PDF viewer…
      </div>
    ),
  }
);

interface SourceViewerProps {
  source: NoteSource | null;
  onPosition: (value: number) => void;
  onAction: (a: SendAction) => void;
  seekRef: React.MutableRefObject<((value: number) => void) | null>;
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 text-center text-xs text-gray-400">
      {children}
    </div>
  );
}

export function SourceViewer({ source, onPosition, onAction, seekRef }: SourceViewerProps) {
  const [detail, setDetail] = useState<NoteSource | null>(null);

  const sourceId = source?.id ?? null;
  const status = source?.status ?? null;
  // The shell re-derives `source` on every 2s poll tick, so keying the fetch on
  // the object identity would remount the viewer (and lose a PDF's scroll
  // position) twice a second. Key on what actually matters instead.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    if (!sourceId) { setDetail(null); return; }
    let cancelled = false;
    // Only blank the pane when we are switching to a DIFFERENT source.
    setDetail((prev) => (prev && prev.id === sourceId ? prev : null));
    wsApi.getSource(sourceId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(sourceRef.current ?? null); });
    return () => { cancelled = true; };
  }, [sourceId, status]);

  if (!source) return <Message>Select a source to open it here.</Message>;
  if (source.status === "failed") {
    return <Message>Processing failed: {source.error ?? "unknown error"} — use retry in the rail.</Message>;
  }
  if (source.status !== "ready") {
    return <Message>Processing “{source.title}”… the note is written once every source is in.</Message>;
  }
  if (!detail || detail.id !== source.id) return <Message>Loading source…</Message>;

  const common = { resource: detail, onPosition, onAction, seekRef };
  if (detail.kind === "pdf" || detail.kind === "document") return <PdfViewer {...common} />;
  if (detail.kind === "youtube") return <YouTubePlayer {...common} />;
  if (detail.kind === "video") return <VideoPlayer {...common} />;
  return <WebsiteViewer {...common} />;
}
