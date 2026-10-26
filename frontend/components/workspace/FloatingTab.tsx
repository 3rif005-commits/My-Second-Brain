"use client";

// A note or a source (a video beside your note) lifted out of the panes into a
// window over them, as the AI panel can float (2026-10-26). Up to MAX_FLOAT at
// once, a click brings one to the front. Drag the bar
// to move it, any edge or corner to size it; ⇲ or a double-click on the bar
// puts it back in the pane you're in. Where it sat is remembered on this device.
import { useEffect, useState } from "react";
import { Minimize2, X } from "lucide-react";
import { clampFloat, readFloatRect, type FloatRect } from "@/components/ai/panelTabs";
import { TabIcon, type TabView } from "./PaneTabs";

const RECT_KEY = "workspace:float:";

type Edges = { n?: boolean; s?: boolean; e?: boolean; w?: boolean };
const HANDLES: { edges: Edges; className: string; cursor: string }[] = [
  { edges: { e: true }, className: "inset-y-3 -right-1 w-2", cursor: "ew-resize" },
  { edges: { w: true }, className: "inset-y-3 -left-1 w-2", cursor: "ew-resize" },
  { edges: { s: true }, className: "inset-x-3 -bottom-1 h-2", cursor: "ns-resize" },
  { edges: { n: true }, className: "inset-x-3 -top-1 h-2", cursor: "ns-resize" },
  { edges: { s: true, e: true }, className: "-bottom-1 -right-1 size-4", cursor: "nwse-resize" },
  { edges: { s: true, w: true }, className: "-bottom-1 -left-1 size-4", cursor: "nesw-resize" },
  { edges: { n: true, e: true }, className: "-top-1 -right-1 size-4", cursor: "nesw-resize" },
  { edges: { n: true, w: true }, className: "-top-1 -left-1 size-4", cursor: "nwse-resize" },
];

/** Upper middle of the screen, under the session header: clear of the AI's corner.
 *  Each window opens a step down and right of the one before, so none hides another. */
function defaultRect(vw: number, vh: number, order: number): FloatRect {
  const width = Math.min(520, vw - 32), height = Math.min(620, vh - 72);
  return clampFloat({ left: Math.round((vw - width) / 2) + order * 28, top: 56 + order * 28, width, height }, vw, vh);
}

function useFloatRect(key: string, order: number) {
  const [rect, setRect] = useState<FloatRect | null>(null);
  useEffect(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(RECT_KEY + key); } catch { /* private mode */ }
    setRect(raw ? readFloatRect(raw, vw, vh) : defaultRect(vw, vh, order));
    // A smaller browser keeps the window on screen.
    const onResize = () => setRect((r) => (r ? clampFloat(r, window.innerWidth, window.innerHeight) : r));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (r: FloatRect) => {
    setRect(r);
    try { window.localStorage.setItem(RECT_KEY + key, JSON.stringify(r)); } catch { /* private mode */ }
  };
  return [rect, save] as const;
}

interface FloatingTabProps {
  /** Drawn as its pane tab is: title, and the icon (pen on the note being written in). */
  tab: TabView;
  /** What its place on screen is remembered under. */
  storageKey: string;
  /** Its place in the stack: later is in front, and opens further down and right. */
  order: number;
  onDock: () => void;
  onClose: () => void;
  /** A press anywhere inside (a note there becomes the one being written in). */
  onFocus: () => void;
  children: React.ReactNode;
}

export function FloatingTab({ tab, storageKey, order, onDock, onClose, onFocus, children }: FloatingTabProps) {
  const [rect, setRect] = useFloatRect(storageKey, order);
  const title = tab.title;
  if (!rect) return null;

  function onPointerDown(e: React.PointerEvent, edges: Edges | "move") {
    if (!rect || e.button !== 0) return;
    if (edges === "move" && (e.target as Element).closest("button")) return;
    e.preventDefault();
    const start = rect, x0 = e.clientX, y0 = e.clientY;
    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      let { left: l, top: t, width: w, height: h } = start;
      if (edges === "move") { l += dx; t += dy; }
      else {
        // Moving the left or top edge keeps the opposite edge still.
        if (edges.e) w += dx;
        if (edges.s) h += dy;
        if (edges.w) { w = Math.max(300, w - dx); l = start.left + start.width - w; }
        if (edges.n) { h = Math.max(240, h - dy); t = start.top + start.height - h; }
      }
      setRect(clampFloat({ left: l, top: t, width: w, height: h }, window.innerWidth, window.innerHeight));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = edges === "move" ? "grabbing" : HANDLES.find((hd) => hd.edges === edges)?.cursor ?? "";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const iconBtn = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-icon hover:bg-surface-hover hover:text-ink";

  return (
    <section
      aria-label={`${title} (floating)`}
      onPointerDownCapture={onFocus}
      // Stacked 30-33: under the AI's window (z-40), over the panes. Opaque, like the AI's.
      className="fixed flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-modal"
      style={{ ...rect, zIndex: 30 + order }}
    >
      {HANDLES.map((hd, i) => (
        <div key={i} aria-hidden onPointerDown={(e) => onPointerDown(e, hd.edges)}
          className={`absolute z-20 ${hd.className}`} style={{ cursor: hd.cursor }} />
      ))}
      {/* The bar: a pane's one tab, shown */}
      <div
        onPointerDown={(e) => onPointerDown(e, "move")}
        onDoubleClick={(e) => { if (!(e.target as Element).closest("button")) onDock(); }}
        title="Drag to move · double-click to put back"
        className="flex h-[38px] shrink-0 cursor-grab items-end gap-0.5 border-b border-line pl-1.5 pr-1"
      >
        <div className="flex h-8 min-w-0 flex-1 items-center">
          <span className="flex h-full min-w-0 max-w-full items-center gap-2 rounded-t-md px-2.5 text-[13px] text-ink shadow-[inset_0_-2px_0_var(--c-accent)]">
            <TabIcon t={tab} />
            <span className="truncate">{title}</span>
          </span>
        </div>
        <div className="flex h-[37px] shrink-0 items-center gap-0.5">
          <button type="button" onClick={onDock} aria-label={`Put ${title} back in a pane`}
            title="Put back in the pane (or double-click the bar)" className={iconBtn}>
            <Minimize2 size={14} />
          </button>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`}
            title="Close (it stays in this session)" className={iconBtn}>
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </section>
  );
}
