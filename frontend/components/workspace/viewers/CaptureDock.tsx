"use client";

// The capture rail — one control surface shared by every time-based viewer
// (YouTube, uploaded video): a slim vertical column over the right edge of the
// media that slides in when the pointer comes near and out when it leaves,
// driven by single-key shortcuts and alive in fullscreen. History: a hover rail
// (2026-08), then an always-on labelled bar under the player (2026-10-25 a.m.),
// then back to a rail on the user's call (2026-10-25 p.m.) — this time centred
// on the edge, clear of the players' own top and bottom controls, with a
// pull-tab while hidden and a label beside each button.
//
// Three things make that work, and each is load-bearing:
//
// 1. FULLSCREEN. The rail is a sibling of the media inside a wrapper, and it is
//    the *wrapper* that goes fullscreen — `Element.requestFullscreen()` shows
//    only that element's subtree, so fullscreening the <video> or the YouTube
//    <iframe> itself would leave the rail behind. Both players therefore hide
//    their own fullscreen button (`fs: 0` for the YouTube IFrame API,
//    `controlsList="nofullscreen"` for <video>, Chromium-only) and defer to the
//    rail's, which fullscreens the wrapper.
//
// 2. KEYBOARD. A cross-origin iframe keeps every keystroke to itself: once the
//    user clicks the YouTube player, keydown never reaches this document again
//    and the shortcuts die silently. So while the pointer is over the media we
//    take focus back off the iframe. That trades YouTube's own key handling for
//    ours — which is why the rail reimplements the essentials (play/pause,
//    ±5s). Mouse control of the YouTube UI is untouched.
//
// 3. HOVER. A cross-origin iframe eats *every* pointer event, boundary
//    events included — measured, not assumed: with the YouTube player mounted,
//    the wrapper's `mouseenter` never fires at all, so a wrapper-hover trigger
//    leaves the rail permanently invisible. The only slice of the media that
//    can still report the pointer is one this document paints itself, so the
//    rail lives inside a narrow transparent hover zone along the right edge
//    (stopping short of the bottom, where every player keeps its transport
//    controls). A thin pull-tab marks the zone while the rail is hidden.
//    The wrapper is *also* watched, which is what drives the uploaded-video
//    player — no iframe there, so the whole surface reports hover normally.
import { useCallback, useEffect, useState } from "react";
import {
  AudioLines, Bookmark, Camera, Film, Keyboard, Loader2, Maximize2,
  Minimize2, Square, X,
} from "lucide-react";
import { fmtTime } from "@/lib/workspace";

export type CaptureKind = "frame" | "clip" | "audio";

/** Single keys, no modifiers — shown in every tooltip so they stay discoverable. */
const KEY = {
  checkpoint: "C",
  frame: "S",
  clip: "V",
  audio: "A",
  fullscreen: "F",
} as const;

interface CaptureDockProps {
  /** The element that goes fullscreen, and the hover scope for the shortcuts.
   *  Must be positioned (`relative`) and focusable (`tabIndex={-1}`). */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Current playhead, in seconds. */
  time: number;
  /** False while the player is still booting — every action is disabled. */
  ready?: boolean;
  /** Which capture is in flight, if any. */
  busy: CaptureKind | null;
  /** Start of an open clip/audio range, or null when none is open. */
  clipStart: number | null;
  onCheckpoint: () => void;
  onFrame: () => void;
  onRange: (kind: "clip" | "audio") => void;
  onCancelRange: () => void;
  /** Play/pause, for the keys the iframe can no longer receive itself. */
  onTogglePlay?: () => void;
  /** Seek by a delta in seconds (negative = back). */
  onSeekBy?: (delta: number) => void;
}

/** One rail button: an icon, its name and key in a label that opens to its left. */
function RailButton({
  icon, label, hint, shortcut, onClick, disabled, tone = "default", caption,
}: {
  icon: React.ReactNode;
  label: string;
  /** What it does, in the label. */
  hint?: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "accent" | "danger";
  /** A line under the icon (Mark shows the time it would mark). */
  caption?: string;
}) {
  return (
    <span className="group/btn relative flex">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={[hint ?? label, shortcut ? `(shortcut ${shortcut})` : ""].filter(Boolean).join(" ")}
        aria-keyshortcuts={shortcut?.toLowerCase()}
        className={`flex w-10 flex-col items-center justify-center gap-0.5 rounded-lg ${caption ? "py-1.5" : "h-10"}
          transition-colors duration-instant disabled:pointer-events-none disabled:opacity-40
          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 ${
          tone === "accent"
            ? "bg-accent text-ink-on-accent hover:bg-accent-hover"
            : tone === "danger"
              ? "bg-red-500/90 text-white hover:bg-red-500"
              : "text-white/85 hover:bg-white/15 hover:text-white"
        }`}
      >
        {icon}
        {caption && <span className="font-mono text-[10px] leading-none tabular-nums">{caption}</span>}
      </button>
      {/* The label: to the left, so it never leaves the media's edge. */}
      <span className="pointer-events-none absolute right-full top-1/2 mr-2 flex -translate-y-1/2 translate-x-1 items-center gap-2
        whitespace-nowrap rounded-md bg-black/85 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition
        duration-150 group-hover/btn:translate-x-0 group-hover/btn:opacity-100 group-focus-within/btn:translate-x-0 group-focus-within/btn:opacity-100">
        {hint ?? label}
        {shortcut && <kbd className="rounded bg-white/15 px-1.5 font-mono text-[10px] leading-4">{shortcut}</kbd>}
      </span>
    </span>
  );
}

export function CaptureDock({
  containerRef, time, ready = true, busy, clipStart,
  onCheckpoint, onFrame, onRange, onCancelRange, onTogglePlay, onSeekBy,
}: CaptureDockProps) {
  const [zoneHover, setZoneHover] = useState(false);
  const [stageHover, setStageHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const recording = clipStart !== null;
  const locked = !ready || busy !== null;
  const hovering = zoneHover || stageHover;

  // Shown briefly when a video opens (so it's found), then whenever the pointer
  // is near or a key is focused in it, and held while a range records or a
  // capture runs. Leaving hides it after a beat, so a slip off the edge doesn't.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 2500);
    return () => clearTimeout(t);
  }, []);
  const wanted = intro || hovering || focusWithin || recording || busy !== null;
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (wanted) { setShown(true); return; }
    const t = setTimeout(() => setShown(false), 700);
    return () => clearTimeout(t);
  }, [wanted]);

  // ── fullscreen (on the wrapper, so this rail comes along) ──────────────────
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  }, [containerRef]);

  useEffect(() => {
    function onChange() {
      const full = document.fullscreenElement === containerRef.current;
      setIsFullscreen(full);
      // Entering fullscreen does not fire mouseenter, so reveal the rail
      // explicitly — otherwise the tools are invisible at the exact moment the
      // user has committed to the video.
      if (full) setZoneHover(true);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [containerRef]);

  // ── pointer presence over the wrapper ─────────────────────────────────────
  // Real for the uploaded-video player; silent whenever a cross-origin iframe
  // covers the wrapper, which is what the hover zone below exists for.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const enter = () => setStageHover(true);
    const leave = () => setStageHover(false);
    el.addEventListener("mouseenter", enter);
    el.addEventListener("mouseleave", leave);
    return () => {
      el.removeEventListener("mouseenter", enter);
      el.removeEventListener("mouseleave", leave);
    };
  }, [containerRef]);

  // ── take the keyboard back from a cross-origin iframe ─────────────────────
  // Clicking the YouTube player moves focus into its iframe, and from then on
  // every keystroke belongs to YouTube — this document stops seeing keydown at
  // all. Focus *is* observable from out here though: the top window blurs and
  // `document.activeElement` becomes the iframe element. Catch that and hand
  // focus back to the wrapper, which is also what makes the shortcuts "hot".
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function reclaim() {
      // activeElement settles a tick after the focus actually moves.
      setTimeout(() => {
        const active = document.activeElement;
        if (active && active.tagName === "IFRAME" && el?.contains(active)) {
          (active as HTMLElement).blur();
          el.focus({ preventScroll: true });
        }
      }, 0);
    }
    window.addEventListener("blur", reclaim);
    document.addEventListener("focusin", reclaim);
    return () => {
      window.removeEventListener("blur", reclaim);
      document.removeEventListener("focusin", reclaim);
    };
  }, [containerRef]);

  // ── shortcuts ─────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable
        || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      const el = containerRef.current;
      if (!el) return;
      // Scoped, so these letters stay usable everywhere else in the app: the
      // player must be fullscreen, hovered, or holding focus.
      const hot = document.fullscreenElement === el
        || hovering
        || el.contains(document.activeElement);
      if (!hot) return;

      const key = e.key.toLowerCase();
      const run = (fn: () => void) => { e.preventDefault(); fn(); };

      if (key === "escape" && recording) return run(onCancelRange);
      if (key === " " || key === "k") return onTogglePlay ? run(onTogglePlay) : undefined;
      if (key === "arrowleft") return onSeekBy ? run(() => onSeekBy(-5)) : undefined;
      if (key === "arrowright") return onSeekBy ? run(() => onSeekBy(5)) : undefined;
      if (key === KEY.fullscreen.toLowerCase()) return run(toggleFullscreen);
      if (!ready) return;
      if (key === KEY.checkpoint.toLowerCase()) return run(onCheckpoint);
      if (busy !== null) return;
      if (key === KEY.frame.toLowerCase()) return run(onFrame);
      if (key === KEY.clip.toLowerCase()) return run(() => onRange("clip"));
      if (key === KEY.audio.toLowerCase()) return run(() => onRange("audio"));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    containerRef, hovering, recording, ready, busy, toggleFullscreen,
    onCheckpoint, onFrame, onRange, onCancelRange, onTogglePlay, onSeekBy,
  ]);

  const spin = <Loader2 size={16} className="animate-spin" />;

  return (
    <>
      {/* While a range records: what it covers, and how to throw it away. */}
      {recording && (
        <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full
          ws-glass-dark py-1 pl-3 pr-1 text-xs text-white">
          <span className="ws-recording size-2 rounded-full bg-red-500" />
          <span className="font-mono tabular-nums">{fmtTime(clipStart)} → {fmtTime(Math.max(time, clipStart))}</span>
          <button type="button" onClick={onCancelRange} aria-label="Discard this range (Esc)" title="Discard (Esc)"
            className="flex h-6 items-center gap-1 rounded-full px-2 text-white/80 hover:bg-white/15 hover:text-white">
            <X size={12} /> Discard
          </button>
        </div>
      )}

      {/* The hover zone: a strip along the right edge, short of the top and the
          bottom where the players keep their own controls. It's what notices the
          pointer over a YouTube iframe (see 3. above), and it holds the rail. */}
      <div
        onPointerEnter={() => setZoneHover(true)}
        onPointerLeave={() => setZoneHover(false)}
        className="absolute bottom-16 right-0 top-14 z-20 flex w-16 items-center justify-end pr-2"
      >
        {/* The pull-tab, while the rail is away. */}
        <span aria-hidden className={`absolute right-1 top-1/2 h-10 w-1 -translate-y-1/2 rounded-full bg-white/50 shadow
          transition-opacity duration-200 ${shown ? "opacity-0" : "opacity-100"}`} />

        <div
          role="toolbar"
          aria-orientation="vertical"
          aria-label="Capture tools"
          onFocus={() => setFocusWithin(true)}
          onBlur={() => setFocusWithin(false)}
          className={`ws-glass-dark flex flex-col items-center gap-1 rounded-xl p-1 transition-[opacity,transform] duration-200 ${
            shown ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3 opacity-0"}`}
        >
          <RailButton
            tone="accent"
            label="Mark"
            hint="Mark this moment in the note"
            caption={fmtTime(time)}
            shortcut={KEY.checkpoint}
            disabled={!ready}
            icon={<Bookmark size={15} />}
            onClick={onCheckpoint}
          />
          <span className="my-0.5 h-px w-6 bg-white/15" />
          <RailButton
            label="Frame"
            hint="Add this frame to the note"
            shortcut={KEY.frame}
            disabled={locked}
            icon={busy === "frame" ? spin : <Camera size={17} />}
            onClick={onFrame}
          />
          {/* Clip and Audio keep their places when a range opens (they become its
              two ways to end), so the second press lands where the first did. */}
          <RailButton tone={recording ? "danger" : "default"}
            label={recording ? "End clip" : "Clip"}
            hint={recording ? "End here and add it as a video clip" : "Start a video clip here; press again to end"}
            shortcut={KEY.clip} disabled={locked}
            icon={busy === "clip" ? spin : recording ? <Square size={13} fill="currentColor" /> : <Film size={17} />}
            onClick={() => onRange("clip")} />
          <RailButton tone={recording ? "danger" : "default"}
            label={recording ? "End audio" : "Audio"}
            hint={recording ? "End here and add it as audio" : "Start an audio excerpt here; press again to end"}
            shortcut={KEY.audio} disabled={locked}
            icon={busy === "audio" ? spin : <AudioLines size={17} />}
            onClick={() => onRange("audio")} />
          <span className="my-0.5 h-px w-6 bg-white/15" />
          <span className="group/keys relative flex">
            <span tabIndex={0} aria-label="Keyboard shortcuts"
              className="flex size-10 cursor-help items-center justify-center rounded-lg text-white/70 hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
              <Keyboard size={16} />
            </span>
            <span className="pointer-events-none absolute right-full top-1/2 z-40 mr-2 hidden -translate-y-1/2 grid-cols-[auto_auto]
              items-center gap-x-3 gap-y-1 whitespace-nowrap rounded-lg bg-black/85 px-3 py-2.5 text-[11px] text-white
              shadow-lg group-hover/keys:grid group-focus-within/keys:grid">
              {([
                ["Play / pause", "Space"],
                ["Back / forward 5s", "← →"],
                ["Mark this moment", KEY.checkpoint],
                ["Capture frame", KEY.frame],
                ["Clip start / end", KEY.clip],
                ["Audio start / end", KEY.audio],
                ["Fullscreen", KEY.fullscreen],
              ] as const).map(([label, key]) => (
                <span key={label} className="contents">
                  <span className="text-white/70">{label}</span>
                  <kbd className="justify-self-end rounded bg-white/15 px-1.5 py-px font-mono text-[10px] leading-4">{key}</kbd>
                </span>
              ))}
            </span>
          </span>
          <RailButton
            label={isFullscreen ? "Leave fullscreen" : "Fullscreen"}
            shortcut={KEY.fullscreen}
            icon={isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            onClick={toggleFullscreen}
          />
        </div>
      </div>
    </>
  );
}
