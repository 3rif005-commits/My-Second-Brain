"use client";

// The capture bar — one control surface shared by every time-based viewer
// (YouTube, uploaded video). A labelled row under the media, always visible
// (it was a hover-only rail until 2026-10-25), driven by single-key shortcuts,
// and alive in fullscreen.
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
// 3. HOVER (historical note: the rail used to be hover-only). A cross-origin iframe eats *every* pointer event, boundary
//    events included — measured, not assumed: with the YouTube player mounted,
//    the wrapper's `mouseenter` never fires at all, so a wrapper-hover trigger
//    leaves the rail permanently invisible. The only slice of the media that
//    can still report the pointer is one this document paints itself, so the
//    rail lives inside a narrow transparent hover zone along the right edge
//    (stopping short of the bottom, where every player keeps its transport
//    controls). A thin pull-tab marks the zone while the rail is hidden.
//    The wrapper is *also* watched, which is what drives the uploaded-video
//    player — no iframe there, so the whole surface reports hover normally.
import { useCallback, useEffect, useRef, useState } from "react";
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

function BarButton({
  icon, label, hint, shortcut, onClick, disabled, tone = "default", iconOnly,
}: {
  icon: React.ReactNode;
  label: string;
  /** What it does, in the tooltip. */
  hint?: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "accent" | "danger";
  iconOnly?: boolean;
}) {
  const tip = [hint ?? label, shortcut ? `(${shortcut})` : ""].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tip}
      aria-label={shortcut ? `${label} (shortcut ${shortcut})` : label}
      aria-keyshortcuts={shortcut?.toLowerCase()}
      className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md ${iconOnly ? "w-8 justify-center" : "px-2.5"}
        transition-colors duration-instant disabled:pointer-events-none disabled:opacity-40
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 ${
        tone === "accent"
          ? "bg-accent font-medium text-ink-on-accent hover:bg-accent-hover"
          : tone === "danger"
            ? "bg-surface-danger-soft text-ink-danger hover:brightness-95"
            : "text-ink hover:bg-surface-hover"
      }`}
    >
      {icon}
      {!iconOnly && label}
      {!iconOnly && shortcut && tone === "default" && (
        <kbd className="font-sans text-[11px] text-ink-tertiary">{shortcut}</kbd>
      )}
    </button>
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

  const spin = <Loader2 size={15} className="animate-spin" />;

  // A source pane on a 921 px window is ~460 px: labels don't fit there, so the
  // bar drops to icons (each keeps its tooltip and shortcut) below 600 px.
  const barRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setCompact(el.clientWidth < 600);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // An always-visible bar under the media (redesign 2026-10-25): the old rail
  // only appeared on hover, over the player's own controls. It stays inside the
  // wrapper, so it comes along into fullscreen.
  return (
    <div ref={barRef} role="toolbar" aria-label="Capture tools"
      onFocus={() => setFocusWithin(true)}
      onBlur={() => setFocusWithin(false)}
      className="flex h-11 shrink-0 items-center gap-1 overflow-hidden border-t border-line bg-surface-sidebar px-2 text-[13px] text-ink">
      <BarButton
        tone="accent"
        label={`Mark ${fmtTime(time)}`}
        hint="Put a link to this moment in the note"
        shortcut={KEY.checkpoint}
        disabled={!ready}
        icon={<Bookmark size={14} />}
        onClick={onCheckpoint}
      />
      <BarButton
        label="Frame"
        iconOnly={compact}
        hint="Add this frame to the note"
        shortcut={KEY.frame}
        disabled={locked}
        icon={busy === "frame" ? spin : <Camera size={15} />}
        onClick={onFrame}
      />
      {/* Clip and Audio keep their places when a range opens (they become its
          two ways to end), so the second press lands where the first did. */}
      <BarButton tone={recording ? "danger" : "default"}
        label={recording ? "End clip" : "Clip"}
        iconOnly={compact}
        hint={recording ? "End the range here and add it as a video clip" : "Start a video clip here; press again to end it"}
        shortcut={KEY.clip} disabled={locked}
        icon={busy === "clip" ? spin : recording ? <Square size={12} fill="currentColor" /> : <Film size={15} />}
        onClick={() => onRange("clip")} />
      <BarButton tone={recording ? "danger" : "default"}
        label={recording ? "End audio" : "Audio"}
        iconOnly={compact}
        hint={recording ? "End the range here and add it as audio" : "Start an audio excerpt here; press again to end it"}
        shortcut={KEY.audio} disabled={locked}
        icon={busy === "audio" ? spin : <AudioLines size={15} />}
        onClick={() => onRange("audio")} />
      {recording && (
        <>
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-1.5 font-mono text-xs tabular-nums text-ink-secondary">
            <span className="ws-recording size-2 rounded-full bg-red-500" />
            {fmtTime(clipStart)} → {fmtTime(Math.max(time, clipStart))}
          </span>
          <BarButton label="Discard" iconOnly={compact} hint="Throw this range away" shortcut="Esc"
            icon={<X size={15} />} onClick={onCancelRange} />
        </>
      )}
      <span className="flex-1" />
      <span className="group/keys relative shrink-0">
        <span className="flex size-7 cursor-help items-center justify-center rounded-md text-ink-icon hover:bg-surface-hover"
          aria-label="Keyboard shortcuts" title="Keyboard shortcuts">
          <Keyboard size={15} />
        </span>
        <span className="pointer-events-none absolute bottom-full right-0 z-40 mb-2 hidden grid-cols-[auto_auto]
          items-center gap-x-3 gap-y-1 whitespace-nowrap rounded-lg border border-line-strong bg-surface-elevated
          px-3 py-2.5 text-[11px] text-ink shadow-float group-hover/keys:grid">
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
              <span className="text-ink-secondary">{label}</span>
              <kbd className="justify-self-end rounded bg-surface-chip px-1.5 py-px font-mono text-[10px] leading-4">{key}</kbd>
            </span>
          ))}
        </span>
      </span>
      <BarButton
        label={isFullscreen ? "Leave fullscreen" : "Fullscreen"}
        iconOnly
        shortcut={KEY.fullscreen}
        icon={isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        onClick={toggleFullscreen}
      />
    </div>
  );
}
