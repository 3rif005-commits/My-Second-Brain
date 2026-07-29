"use client";

// YouTube source viewer — official IFrame Player API wrapper.
// Cross-origin video means frames/clips/audio are captured server-side
// (yt-dlp section download + ffmpeg) via /capture.
import { useEffect, useRef, useState } from "react";
import { fmtTime, wsApi, youtubeVideoId, type SendAction, type WsResource } from "@/lib/workspace";
import { useToast } from "@/app/providers";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    YT: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
  }
  return apiPromise;
}

interface YouTubePlayerProps {
  resource: WsResource;
  onPosition: (seconds: number) => void;
  onAction: (action: SendAction) => void;
  seekRef: React.MutableRefObject<((value: number) => void) | null>;
}

export function YouTubePlayer({ resource, onPosition, onAction, seekRef }: YouTubePlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [clipStart, setClipStart] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timeRef = useRef(0);
  const { showToast } = useToast();

  const videoId = youtubeVideoId(resource.source_url || "");

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    loadYouTubeApi().then(() => {
      if (cancelled || !hostRef.current || !videoId) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            setReady(true);
            interval = setInterval(() => {
              try {
                const t = playerRef.current?.getCurrentTime?.() ?? 0;
                if (Math.abs(t - timeRef.current) > 0.4) {
                  timeRef.current = t;
                  onPosition(t);
                }
              } catch { /* player not ready */ }
            }, 500);
          },
        },
      });
    });
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      try { playerRef.current?.destroy?.(); } catch { /* already gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    seekRef.current = (t: number) => {
      try {
        playerRef.current?.seekTo?.(t, true);
        playerRef.current?.playVideo?.();
      } catch { /* not ready */ }
    };
    return () => { seekRef.current = null; };
  }, [seekRef]);

  async function captureNow(type: "frame" | "clip" | "audio") {
    const t = timeRef.current;
    if (type === "frame") {
      setBusy("frame");
      try {
        const r = await wsApi.capture(resource.id, "frame", t);
        onAction({ type: "image", url: r.url, caption: `Frame @ ${fmtTime(t)}` });
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Frame capture failed");
      } finally { setBusy(null); }
      return;
    }
    // clip / audio need a range
    if (clipStart === null) {
      setClipStart(t);
      return;
    }
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

  if (!videoId) {
    return <div className="flex-1 flex items-center justify-center text-sm text-red-400">Invalid YouTube URL</div>;
  }

  return (
    <div className="flex-1 flex flex-col bg-black min-h-0">
      <div className="flex-1 min-h-0">
        <div ref={hostRef} className="w-full h-full" />
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-xs shrink-0 flex-wrap">
        <button
          className="px-2 py-1 rounded bg-amber-600/80 hover:bg-amber-600 transition-colors"
          disabled={!ready}
          onClick={() => onAction({
            type: "checkpoint", anchorType: "time", value: timeRef.current,
          })}
        >
          📍 Checkpoint {fmtTime(timeRef.current)}
        </button>
        <button
          className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
          disabled={!ready || busy !== null}
          onClick={() => captureNow("frame")}
        >
          {busy === "frame" ? "Capturing…" : "🖼 Frame"}
        </button>
        <button
          className={`px-2 py-1 rounded transition-colors ${clipStart !== null ? "bg-red-600" : "bg-gray-700 hover:bg-gray-600"}`}
          disabled={!ready || busy !== null}
          onClick={() => captureNow("clip")}
        >
          {busy === "clip" ? "Extracting…"
            : clipStart !== null ? `⏹ End clip (from ${fmtTime(clipStart)})` : "🎬 Clip"}
        </button>
        <button
          className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
          disabled={!ready || busy !== null}
          onClick={() => captureNow("audio")}
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
