// Which PDF pages get a real canvas + text layer (ArtCraft study P1, after pdfcraft's page
// cache): the pages on screen plus a small window on each side. Every other page is an empty
// box of its exact size, so scroll position, jumps and anchors behave as if all were drawn.

/** Pages to draw, given the (1-based) pages currently on screen. */
export function pagesToRender(visible: Iterable<number>, total: number, pad = 2): Set<number> {
  const v = [...visible].filter((p) => p >= 1 && p <= total);
  const out = new Set<number>();
  if (total <= 0) return out;
  const lo = v.length ? Math.min(...v) : 1;
  const hi = v.length ? Math.max(...v) : 1;
  for (let p = Math.max(1, lo - pad); p <= Math.min(total, hi + pad); p++) out.add(p);
  return out;
}

/** Height in px of page `pno` drawn `width` px wide, or null when its size is unknown. */
export function pageHeight(sizes: [number, number][], pno: number, width: number): number | null {
  const s = sizes[pno - 1];
  if (!s || !(s[0] > 0) || !(s[1] > 0)) return null;
  return (s[1] * width) / s[0];
}
