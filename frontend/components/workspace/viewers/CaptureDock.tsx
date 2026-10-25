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
  AudioLines, Bookmark, Camera, ChevronLeft, Film, Keyboard, Loader2, Maximize2,
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

/** Icons on the rail share one size and a lighter stroke than the app's default. */
const ICON = { size: 17, strokeWidth: 1.75 } as const;

/** A label beside a rail control: what it does and its key, opening to the left. */
function RailLabel({ text, shortcut }: { text: string; shortcut?: string }) {
  return (
    <span className="ws-media-glass pointer-events-none absolute right-full top-1/2 mr-2.5 flex -translate-y-1/2 translate-x-1.5
      items-center gap-2 whitespace-nowrap rounded-lg py-1.5 pl-2.5 pr-1.5 text-[12px] font-medium tracking-[0.01em]
      opacity-0 transition-[opacity,transform] duration-150 ease-out
      group-hover/btn:translate-x-0 group-hover/btn:opacity-100 group-focus-within/btn:translate-x-0 group-focus-within/btn:opacity-100">
      <span className="text-white/90">{text}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-white/15
      bg-white/[0.08] px-1 font-sans text-[10.5px] font-semibold leading-none text-white/80 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
      {children}
    </kbd>
  );
}

/** One rail button: a 36 px square with its label opening to the left. */
function RailButton({
  icon, label, hint, shortcut, onClick, disabled, tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  /** What it does, in the label. */
  hint?: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "accent" | "danger";
}) {
  return (
    <span className="group/btn relative flex">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={[hint ?? label, shortcut ? `(shortcut ${shortcut})` : ""].filter(Boolean).join(" ")}
        aria-keyshortcuts={shortcut?.toLowerCase()}
        className={`flex size-9 items-center justify-center rounded-[10px] transition-[background-color,color,transform,box-shadow]
          duration-150 ease-out active:scale-[0.92] disabled:pointer-events-none disabled:opacity-35
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
          tone === "accent"
            ? "bg-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_8px_-2px_rgb(var(--accent-600)/0.7)] hover:brightness-110"
            : tone === "danger"
              ? "bg-red-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_8px_-2px_rgba(239,68,68,0.7)] hover:bg-red-400"
              : "text-white/75 hover:bg-white/[0.12] hover:text-white"
        }`}
      >
        {icon}
      </button>
      <RailLabel text={hint ?? label} shortcut={shortcut} />
    </span>
  );
}

const Divider = () => <span aria-hidden className="mx-auto my-1 h-px w-5 bg-white/[0.12]" />;

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

  const spin = <Loader2 {...ICON} className="animate-spin" />;
  const elapsed = recording ? Math.max(0, time - clipStart) : 0;

  return (
    <>
      {/* While a range records: how long, what it covers, and how to throw it away. */}
      {recording && (
        // Top-right, under the player's own title row and lined up with the rail.
        // Placed by the outer box: ws-rise animates `transform`, which would undo a translate here.
        <div className="pointer-events-none absolute right-2.5 top-16 z-30 flex justify-end">
        <div role="status" className="ws-media-glass ws-rise pointer-events-auto flex items-center
          gap-2.5 rounded-full py-1 pl-3 pr-1 text-xs">
          <span className="relative flex size-2">
            <span className="ws-recording absolute inset-0 rounded-full bg-red-500" />
            <span className="relative size-2 rounded-full bg-red-500" />
          </span>
          <span className="text-[10.5px] font-bold tracking-[0.12em] text-red-400">REC</span>
          <span className="font-mono text-[13px] font-medium tabular-nums">{fmtTime(elapsed)}</span>
          <span className="h-3.5 w-px bg-white/15" />
          <span className="font-mono text-[11px] tabular-nums text-white/55">
            {fmtTime(clipStart)} – {fmtTime(Math.max(time, clipStart))}
          </span>
          <button type="button" onClick={onCancelRange} aria-label="Discard this range (Esc)" title="Discard (Esc)"
            className="flex h-6 items-center gap-1 rounded-full bg-white/[0.08] px-2.5 text-[11.5px] font-medium text-white/80
              transition-colors hover:bg-white/[0.16] hover:text-white">
            <X size={12} strokeWidth={2} /> Discard
          </button>
        </div>
        </div>
      )}

      {/* The hover zone: a strip along the right edge, short of the top and the
          bottom where the players keep their own controls. It's what notices the
          pointer over a YouTube iframe (see 3. above), and it holds the rail. */}
      <div
        onPointerEnter={() => setZoneHover(true)}
        onPointerLeave={() => setZoneHover(false)}
        className="absolute bottom-16 right-0 top-14 z-20 flex w-[72px] items-center justify-end pr-2.5"
      >
        {/* The handle, while the rail is away: a small glass tab that says "pull". */}
        <span aria-hidden className={`ws-media-glass absolute right-0 top-1/2 flex h-12 w-4 -translate-y-1/2 items-center
          justify-center rounded-l-lg transition-[opacity,transform] duration-200 ease-out ${
          shown ? "translate-x-2 opacity-0" : "translate-x-0 opacity-100"}`}>
          <ChevronLeft size={12} strokeWidth={2.25} className="text-white/70" />
        </span>

        <div
          role="toolbar"
          aria-orientation="vertical"
          aria-label="Capture tools"
          onFocus={() => setFocusWithin(true)}
          onBlur={() => setFocusWithin(false)}
          className={`ws-media-glass flex origin-right flex-col items-center gap-0.5 rounded-2xl p-1.5
            transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
            shown ? "translate-x-0 scale-100 opacity-100" : "pointer-events-none translate-x-3 scale-95 opacity-0"}`}
        >
          <RailButton
            tone="accent"
            label="Mark"
            hint="Mark this moment in the note"
            shortcut={KEY.checkpoint}
            disabled={!ready}
            icon={<Bookmark {...ICON} />}
            onClick={onCheckpoint}
          />
          {/* The moment Mark would link to. */}
          <span className="pb-0.5 pt-1 font-mono text-[10px] font-medium leading-none tabular-nums text-white/60">
            {fmtTime(time)}
          </span>
          <Divider />
          <RailButton
            label="Frame"
            hint="Add this frame to the note"
            shortcut={KEY.frame}
            disabled={locked}
            icon={busy === "frame" ? spin : <Camera {...ICON} />}
            onClick={onFrame}
          />
          {/* Clip and Audio keep their places when a range opens (they become its
              two ways to end), so the second press lands where the first did. */}
          <RailButton tone={recording ? "danger" : "default"}
            label={recording ? "End clip" : "Clip"}
            hint={recording ? "End here and add it as a video clip" : "Start a video clip here; press again to end"}
            shortcut={KEY.clip} disabled={locked}
            icon={busy === "clip" ? spin : recording ? <Square size={12} fill="currentColor" strokeWidth={0} /> : <Film {...ICON} />}
            onClick={() => onRange("clip")} />
          <RailButton tone={recording ? "danger" : "default"}
            label={recording ? "End audio" : "Audio"}
            hint={recording ? "End here and add it as audio" : "Start an audio excerpt here; press again to end"}
            shortcut={KEY.audio} disabled={locked}
            icon={busy === "audio" ? spin : <AudioLines {...ICON} />}
            onClick={() => onRange("audio")} />
          <Divider />
          <span className="group/keys relative flex">
            <span tabIndex={0} aria-label="Keyboard shortcuts"
              className="flex size-9 cursor-help items-center justify-center rounded-[10px] text-white/55 transition-colors
                hover:bg-white/[0.12] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
              <Keyboard {...ICON} />
            </span>
            <span className="ws-media-glass pointer-events-none absolute right-full top-1/2 z-40 mr-2.5 grid -translate-y-1/2
              translate-x-1.5 grid-cols-[auto_auto] items-center gap-x-5 gap-y-1.5 whitespace-nowrap rounded-xl px-3.5 py-3
              text-[12px] opacity-0 transition-[opacity,transform] duration-150 ease-out
              group-hover/keys:translate-x-0 group-hover/keys:opacity-100 group-focus-within/keys:translate-x-0 group-focus-within/keys:opacity-100">
              <span className="col-span-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/45">Shortcuts</span>
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
                  <span className="text-white/80">{label}</span>
                  <span className="justify-self-end"><Kbd>{key}</Kbd></span>
                </span>
              ))}
            </span>
          </span>
          <RailButton
            label={isFullscreen ? "Leave fullscreen" : "Fullscreen"}
            shortcut={KEY.fullscreen}
            icon={isFullscreen ? <Minimize2 {...ICON} /> : <Maximize2 {...ICON} />}
            onClick={toggleFullscreen}
          />
        </div>
      </div>
    </>
  );
}
