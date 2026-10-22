"use client";

// Full-screen slides from the note on screen. The slides are copies of the editor's own
// rendered blocks, so math, callouts, images and live blocks look exactly as in the note.
// Keys (lib/present.ts): → / Space next, ← back, number + Enter jumps, G all slides,
// B black screen, Esc leaves.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FIT_FLOOR, fitScale, groupSlides, initialPresent, presentKey, splitSlide, type PresentState } from "@/lib/present";

interface Slide { html: string; label: string }

/** Copy the editor's rendered top-level blocks into slides (toggles opened, nothing editable). */
export function slidesFromEditor(root: ParentNode, title: string): Slide[] {
  const outers = [...root.querySelectorAll(".bn-editor > .bn-block-group > .bn-block-outer")];
  const levels = outers.map((o) => {
    const c = o.querySelector(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content");
    return c?.getAttribute("data-content-type") === "heading" ? Number(c.getAttribute("data-level")) || null : null;
  });
  const slides: Slide[] = [{ html: "", label: title || "Untitled" }];
  for (const group of groupSlides(levels)) {
    const holder = document.createElement("div");
    for (const i of group) holder.appendChild(outers[i].cloneNode(true));
    holder.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
    holder.querySelectorAll(".bn-toggle-wrapper").forEach((el) => el.setAttribute("data-show-children", "true"));
    holder.querySelectorAll(".bn-toggle-add-block-button, .bn-side-menu").forEach((el) => el.remove());
    if (!holder.textContent?.trim() && !holder.querySelector("img,iframe,svg,video,table")) continue;
    const first = outers[group[0]].querySelector("[data-content-type='heading']")?.textContent?.trim();
    slides.push({ html: holder.innerHTML, label: first || `Slide ${slides.length + 1}` });
  }
  return slides;
}

// The slide area: FitSlide's box (inset-x-10 top-10 bottom-14) and its content classes.
const SLIDE_INSET_X = 80, SLIDE_INSET_Y = 96;
const SLIDE_CONTENT = "bn-editor bn-default-styles text-[1.35rem]";

/** Continue a slide that won't fit even at the fit floor on a "(cont.)" slide, splitting
 *  between blocks as laid out at slide size (DeckCraft's auto-fit: shrink first, then split).
 *  Without layout (no window size, jsdom) every slide stays whole. */
export function splitToFit(slides: Slide[], boxW: number, boxH: number): Slide[] {
  if (!(boxW > 0) || !(boxH > 0)) return slides;
  const probe = document.createElement("div");
  probe.className = "bn-container mx-auto max-w-4xl";
  probe.style.cssText = `position:fixed;left:-100000px;top:0;visibility:hidden;width:${boxW}px`;
  const content = document.createElement("div");
  content.className = SLIDE_CONTENT;
  probe.appendChild(content);
  document.body.appendChild(probe);
  try {
    return slides.flatMap((slide, n) => {
      if (n === 0) return [slide];
      content.innerHTML = slide.html;
      const blocks = [...content.children] as HTMLElement[];
      const tops = blocks.map((b) => b.offsetTop);
      const heights = tops.map((t, i) => (i + 1 < tops.length ? tops[i + 1] : content.scrollHeight) - t);
      const headings = blocks.map((b) => b.querySelector(".bn-block-content")?.getAttribute("data-content-type") === "heading");
      const parts = splitSlide(heights, boxH / FIT_FLOOR, headings);
      if (parts.length < 2) return [slide];
      return parts.map((part, k) => ({
        html: part.map((i) => blocks[i].outerHTML).join(""),
        label: k === 0 ? slide.label : `${slide.label} (cont.)`,
      }));
    });
  } finally {
    probe.remove();
  }
}

function FitSlide({ html }: { html: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const box = boxRef.current, inner = innerRef.current;
    if (!box || !inner) return;
    const measure = () => setScale(fitScale(inner.scrollWidth, inner.scrollHeight, box.clientWidth, box.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box); ro.observe(inner);
    return () => ro.disconnect();
  }, [html]);
  return (
    <div ref={boxRef} className={`absolute inset-0 ${scale <= FIT_FLOOR ? "overflow-y-auto" : "overflow-hidden"}`}>
      <div ref={innerRef} style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
        className="bn-container mx-auto max-w-4xl">
        <div className={SLIDE_CONTENT} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

export function PresentMode({ title, onClose }: { title: string; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [slides, setSlides] = useState(() => (typeof document === "undefined" ? [] : slidesFromEditor(document, title)));
  const [s, setS] = useState<PresentState>(() => initialPresent(slides.length));

  // Once, before the first paint: continue overlong slides (needs real layout, so not in
  // the useState initialiser above).
  useLayoutEffect(() => {
    const fitted = splitToFit(slides, Math.min(896, window.innerWidth - SLIDE_INSET_X), window.innerHeight - SLIDE_INSET_Y);
    if (fitted.length !== slides.length) {
      setSlides(fitted);
      setS((p) => ({ ...p, count: fitted.length }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const wentFullscreen = useRef(false);

  const handle = useCallback((key: string) => {
    setS((prev) => {
      const next = presentKey(prev, key);
      if (next === "exit") { queueMicrotask(onClose); return prev; }
      return next;
    });
  }, [onClose]);

  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.(); // keys must not type into the note
    const el = overlayRef.current;
    el?.requestFullscreen?.().then(() => { wentFullscreen.current = true; }).catch(() => {});
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      handle(e.key);
    }
    function onFs() { if (wentFullscreen.current && !document.fullscreenElement) onClose(); }
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [handle, onClose]);

  // Typed slide numbers disappear after 3 s.
  useEffect(() => {
    if (!s.typed) return;
    const t = setTimeout(() => setS((p) => ({ ...p, typed: "" })), 3000);
    return () => clearTimeout(t);
  }, [s.typed]);

  const slide = slides[s.index];
  return (
    <div ref={overlayRef} className="fixed inset-0 z-[100] bg-white text-gray-900 select-none"
      role="dialog" aria-label={`Presenting ${title}`}
      onClick={(e) => { if (!s.grid && e.target === e.currentTarget) handle("ArrowRight"); }}>
      {s.index === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center px-16">
          <h1 className="text-5xl font-bold text-center leading-tight">{slide?.label}</h1>
        </div>
      ) : (
        <div className="absolute inset-x-10 top-10 bottom-14">{slide && <FitSlide html={slide.html} />}</div>
      )}

      {s.grid && (
        <div className="absolute inset-0 z-10 bg-gray-50/95 overflow-y-auto p-10 grid grid-cols-2 md:grid-cols-4 gap-4 content-start">
          {slides.map((sl, i) => (
            <button key={i} onClick={() => setS((p) => ({ ...p, index: i, grid: false }))}
              className={`text-left rounded-xl border p-4 h-28 bg-white hover:border-accent-400 ${i === s.index ? "border-accent-500 ring-2 ring-accent-200" : "border-gray-200"}`}>
              <span className="block text-[11px] text-gray-400 tabular-nums">{i + 1}</span>
              <span className="block mt-1 text-sm font-medium line-clamp-3">{sl.label}</span>
            </button>
          ))}
        </div>
      )}
      {s.black && <div className="absolute inset-0 z-20 bg-black" onClick={() => handle("b")} />}
      {s.typed && (
        <div className="absolute z-30 bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-gray-900/80 text-white text-sm px-4 py-1.5">
          Go to slide {s.typed}
        </div>
      )}
      <div className="absolute bottom-4 right-6 text-xs tabular-nums text-gray-400">
        {s.index + 1} / {s.count}
      </div>
    </div>
  );
}
