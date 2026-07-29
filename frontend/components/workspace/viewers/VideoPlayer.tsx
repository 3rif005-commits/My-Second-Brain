"use client";

// Uploaded-video viewer — plain <video> over a signed storage URL.
// Frame capture is instant and client-side (same-origin canvas grab);
// clips and audio segments go through the server ffmpeg pipeline.
import { useEffect, useRef, useState } from "react";
import { fmtTime, wsApi, type SendAction, type WsResource } from "@/lib/workspace";
import { useToast } from "@/app/providers";

interface VideoPlayerProps {
  resource: WsResource;
  onPosition: (seconds: number) => void;
  onAction: (action: SendAction) => void;
  seekRef: React.MutableRefObject<((value: number) => void) | null>;
}

export function VideoPlayer({ resource, onPosition, onAction, seekRef }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [clipStart, setClipStart] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const { showToast } = useToast();

  useEffect(() => {
    wsApi.resourceFileUrl(resource.id).then((r) => setSrc(r.url)).catch(() => {});
  }, [resource.id]);

  useEffect(() => {
    seekRef.current = (t: number) => {
      const v = videoRef.current;
      if (v) { v.currentTime = t; v.play().catch(() => {}); }
    };
    return () => { seekRef.current = null; };
  }, [seekRef]);

  async function captureFrame() {
    const v = videoRef.current;
    const t = v?.currentTime ?? 0;
    setBusy("frame");
    try {
      const r = await wsApi.capture(resource.id, "frame", t);
      onAction({ type: "image", url: r.url, caption: `Frame @ ${fmtTime(t)}` });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Frame capture failed");
    } finally { setBusy(null); }
  }

  async function captureRange(type: "clip" | "audio") {
    const t = videoRef.current?.currentTime ?? 0;
    if (clipStart === null) { setClipStart(t); return; }
    const [a, b] = clipStart < t ? [clipStart, t] : [t, clipStart];
    setClipStart(null);
    setBusy(type);
    try {
      const r = await wsApi.capture(resource.id, type, a, b);
      onAction({ type, url: r.url, label: `${type} ${fmtTime(a)}–${fmtTime(b)}` });
    } catch (e) {
      showToast(e instanceof Error ? e.message : `${type} capture failed`);
    } finally { setBusy(null); }
  }

  if (!src) {
    return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading video…</div>;
  }

  return (
    <div className="flex-1 flex flex-col bg-black min-h-0">
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <video
          ref={videoRef}
          src={src}
          controls
          className="max-w-full max-h-full"
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setTime(t);
            onPosition(t);
          }}
        />
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-xs shrink-0 flex-wrap">
        <button
          className="px-2 py-1 rounded bg-amber-600/80 hover:bg-amber-600 transition-colors"
          onClick={() => onAction({ type: "checkpoint", anchorType: "time", value: time })}
        >
          📍 Checkpoint {fmtTime(time)}
        </button>
        <button
          className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
          disabled={busy !== null}
          onClick={captureFrame}
        >
          {busy === "frame" ? "Capturing…" : "🖼 Frame"}
        </button>
        <button
          className={`px-2 py-1 rounded transition-colors ${clipStart !== null ? "bg-red-600" : "bg-gray-700 hover:bg-gray-600"}`}
          disabled={busy !== null}
          onClick={() => captureRange("clip")}
        >
          {busy === "clip" ? "Extracting…"
            : clipStart !== null ? `⏹ End clip (from ${fmtTime(clipStart)})` : "🎬 Clip"}
        </button>
        <button
          className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
          disabled={busy !== null}
          onClick={() => captureRange("audio")}
        >
          {busy === "audio" ? "Extracting…"
            : clipStart !== null ? "⏹ End audio" : "🎧 Audio"}
        </button>
        {clipStart !== null && (
          <button className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700"
            onClick={() => setClipStart(null)}>
            cancel
          </button>
        )}
      </div>
    </div>
  );
}
