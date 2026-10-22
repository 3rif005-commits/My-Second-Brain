"use client";

// Thin dispatcher from a source's `kind` onto the proven viewers. It also loads
// the source detail (elements + signed image URLs), which is what the viewers'
// element overlays and send-to-note actions need.
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertCircle, Layers } from "lucide-react";
import { wsApi, type NoteSource, type SendAction } from "@/lib/workspace";
import type { Passage } from "./viewers/passageMarks";
import { YouTubePlayer } from "./viewers/YouTubePlayer";
import { VideoPlayer } from "./viewers/VideoPlayer";
import { WebsiteViewer } from "./viewers/WebsiteViewer";
import { TranscriptList } from "./viewers/TranscriptList";
import { readTranscript } from "./viewers/transcript";

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
  /** Passages the note quotes (any source); a PDF tints its own. */
  passages?: Passage[];
}

function Message({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2.5 px-8 text-center">
      {icon}
      <p className="max-w-xs text-[12.5px] leading-relaxed text-gray-400">{children}</p>
    </div>
  );
}

/** Slow, calm spinner for the states where the server is still working. */
function Spinner({ tone = "indigo" }: { tone?: "indigo" | "gray" }) {
  return (
    <span
      className={`w-6 h-6 rounded-full border-2 border-t-transparent animate-spin ${
        tone === "indigo" ? "border-accent-400" : "border-gray-300 dark:border-gray-600"
      }`}
    />
  );
}

export function SourceViewer({ source, onPosition, onAction, seekRef, passages }: SourceViewerProps) {
  const [detail, setDetail] = useState<NoteSource | null>(null);
  // The playhead also feeds the transcript list. Both callbacks go through refs so this
  // stays one stable function: the YouTube player keeps the first one it is given.
  const positionRef = useRef(onPosition);
  positionRef.current = onPosition;
  const timeSinkRef = useRef<((t: number) => void) | null>(null);
  const onVideoPosition = useCallback((t: number) => {
    positionRef.current(t);
    timeSinkRef.current?.(t);
  }, []);

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

  if (!source) {
    return (
      <Message icon={<Layers size={22} className="text-gray-300 dark:text-gray-600" />}>
        Pick a source above to open it here.
      </Message>
    );
  }
  if (source.status === "failed") {
    return (
      <Message icon={
        <span className="w-10 h-10 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center">
          <AlertCircle size={20} />
        </span>
      }>
        Couldn’t read this one: {source.error ?? "unknown error"}.
        Use the retry arrow in the rail to try again.
      </Message>
    );
  }
  if (source.status !== "ready") {
    return (
      <Message icon={<Spinner />}>
        Reading “{source.title}” — the note gets written once every source is in.
      </Message>
    );
  }
  if (!detail || detail.id !== source.id) {
    return <Message icon={<Spinner tone="gray" />}>Opening source…</Message>;
  }

  const common = { resource: detail, onPosition, onAction, seekRef };
  if (detail.kind === "pdf") return <PdfViewer {...common} passages={passages} />;
  if (detail.kind === "youtube" || detail.kind === "video") {
    const { lines, chapters } = readTranscript(detail.meta);
    const Player = detail.kind === "youtube" ? YouTubePlayer : VideoPlayer;
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <Player {...common} onPosition={onVideoPosition} />
        <TranscriptList lines={lines} chapters={chapters} timeSinkRef={timeSinkRef}
          onSeek={(sec) => seekRef.current?.(sec)} />
      </div>
    );
  }
  // `document` (.md/.txt) and `website` both arrive as a flat list of
  // section-anchored elements, so one viewer renders both. `document` used to be
  // routed to PdfViewer alongside `pdf`, which handed a markdown file to
  // react-pdf — it cannot parse one, so those sources never rendered at all.
  return <WebsiteViewer {...common} />;
}
