"use client";

// An answer from a note's sources: [n] markers become source chips that jump
// to the cited page (Markdown everywhere else). Used by the AI panel when it
// sits in the workspace, where there is a source viewer to jump to.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Markdown } from "@/lib/markdown/Markdown";
import { BlockPreviewLink, HOVER_DELAY_MS, positionFor } from "@/lib/markdown/components/BlockPreviewLink";
import { anchorLabel, sourceColor, type Citation } from "@/lib/workspace";

export function Answer({ content, citations, colorIndex, onCitation }: {
  content: string;
  citations: Citation[];
  colorIndex: Map<string, number>;
  onCitation: (c: Citation) => void;
}) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const linked = content.replace(/\[(\d{1,2})\](?!\()/g, (m, n) => (byN.has(Number(n)) ? `[${n}](#cite-${n})` : m));
  const components = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a: ({ href, children }: any) => {
      const m = /^#cite-(\d+)$/.exec(href ?? "");
      const c = m ? byN.get(Number(m[1])) : undefined;
      if (!c) return <BlockPreviewLink href={href}>{children}</BlockPreviewLink>;
      return <SourceChip c={c} color={sourceColor(colorIndex.get(c.resource_id) ?? 0)} onOpen={() => onCitation(c)} />;
    },
  };
  return <Markdown components={components}>{linked}</Markdown>;
}

/** A [n] chip. Hovering it shows where the claim comes from — the source, the
 *  page or time, the quoted passage — in the same card the note citations use
 *  (BlockPreviewLink); a click still jumps the viewer there. */
function SourceChip({ c, color, onOpen }: { c: Citation; color: string; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const where = c.kind === "note" ? "your note" : anchorLabel(c.anchor_type, c.anchor_start);
  // Extracted passages keep markdown heading marks ("## 3. Self-attention").
  const snippet = c.snippet?.replace(/(^|\s)#{1,6}\s+/g, "$1");

  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPos(null);
  };
  const open = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos(positionFor(rect, 34, snippet ? 96 : 0));
  };
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const cardId = `source-cite-${c.n}`;
  return (
    <>
      <button ref={ref} type="button" onClick={() => { close(); onOpen(); }}
        onMouseEnter={() => { timer.current = setTimeout(open, HOVER_DELAY_MS); }}
        onMouseLeave={close} onFocus={open} onBlur={close}
        aria-label={`Source ${c.n}: ${c.title}, ${where}`}
        aria-describedby={pos ? cardId : undefined}
        className="inline-flex items-center gap-1 mx-0.5 px-1.5 h-[18px] rounded-md align-baseline
          text-[10.5px] font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300
          hover:bg-accent-100 dark:hover:bg-accent-500/20 transition-colors not-prose">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        {c.n}
      </button>
      {pos && createPortal(
        <div id={cardId} role="tooltip"
          className="block-preview-card pointer-events-none fixed z-50 overflow-hidden rounded-xl bg-white ring-1 ring-black/[0.07] dark:bg-gray-800 dark:ring-white/10"
          style={{ top: pos.top, left: pos.left, width: 360,
                   boxShadow: "0 1px 2px rgba(16,24,40,0.06), 0 12px 28px -8px rgba(16,24,40,0.18)" }}>
          <div className="flex items-center gap-2 border-b border-gray-100 px-3.5 py-2 text-[11px] dark:border-gray-700/70">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="min-w-0 flex-1 truncate font-medium text-gray-600 dark:text-gray-300">{c.title}</span>
            <span className="shrink-0 text-gray-400 dark:text-gray-500">{where}</span>
          </div>
          {snippet && (
            <p className="m-0 px-3.5 pb-3.5 pt-3 text-[12.5px] leading-[1.5] text-gray-800 dark:text-gray-100"
              style={{ boxShadow: "inset 2px 0 0 rgb(var(--accent-500))", background: "rgb(var(--accent-500) / 0.06)" }}>
              {snippet.length > 420 ? `${snippet.slice(0, 420)}…` : snippet}
            </p>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
