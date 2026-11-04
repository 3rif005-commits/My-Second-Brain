// Ready-made blocks carried inside HTML: `<div data-sb-blocks="[…block JSON…]"></div>`.
//
// Every draft reaches the editor as HTML (an AI answer, a job's result, a staged
// draft), and BlockNote's HTML parser knows nothing of this app's own blocks —
// a page pill, a math block, a captured clip. So the blocks are built first and
// travel as JSON in one attribute; the editor swaps them in after parsing, the
// same way calloutChildren.ts restores callout bodies. The backend reads the
// same format (services/note_html.py), so one placeholder works on both sides.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

const ATTR = "data-sb-blocks";
const MARK = (i: number) => `⟦sb:${i}⟧`;   // ⟦sb:0⟧ — never typed by anyone
const MARK_RE = /^⟦sb:(\d+)⟧$/;

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The HTML that carries these blocks. */
export function embedBlocksHtml(blocks: AnyBlock[]): string {
  return `<div ${ATTR}="${escapeAttr(JSON.stringify(blocks))}"></div>`;
}

/** Take the embedded blocks out of `html`, leaving a marker paragraph where each was. */
export function extractEmbeddedBlocks(html: string): { html: string; embedded: AnyBlock[][] } {
  if (!html.includes(ATTR)) return { html, embedded: [] };
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const embedded: AnyBlock[][] = [];
  for (const el of [...doc.querySelectorAll(`div[${ATTR}]`)]) {
    let blocks: AnyBlock[] = [];
    try {
      const parsed = JSON.parse(el.getAttribute(ATTR) ?? "[]");
      blocks = Array.isArray(parsed) ? parsed : [parsed];
    } catch { /* a damaged payload is dropped, never shown as JSON */ }
    const p = doc.createElement("p");
    p.textContent = MARK(embedded.length);
    embedded.push(blocks);
    el.replaceWith(p);
  }
  return { html: doc.body.innerHTML, embedded };
}

function textOf(b: AnyBlock): string {
  return Array.isArray(b?.content)
    ? b.content.map((c: AnyBlock) => (c?.type === "text" ? c.text ?? "" : "")).join("").trim()
    : "";
}

/** Put the embedded blocks back where their markers landed after parsing. */
export function restoreEmbeddedBlocks(blocks: AnyBlock[], embedded: AnyBlock[][]): AnyBlock[] {
  if (!embedded.length) return blocks;
  const walk = (list: AnyBlock[]): AnyBlock[] => list.flatMap((b) => {
    const m = b?.type === "paragraph" ? MARK_RE.exec(textOf(b)) : null;
    if (m) return embedded[Number(m[1])] ?? [];
    return [Array.isArray(b?.children) && b.children.length ? { ...b, children: walk(b.children) } : b];
  });
  return walk(blocks);
}
