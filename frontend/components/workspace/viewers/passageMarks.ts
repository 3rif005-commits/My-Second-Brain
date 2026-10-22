// Tint, in a PDF's text layer, the passages the note quotes (ArtCraft study item 5, second
// half). Nothing is stored: the passages are read from the note itself — each quote sent from
// a page is followed by its page pill (sendBlocks.ts) — so deleting the quote removes the tint.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export interface Passage { resourceId: string; page: number; text: string }

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function inlineText(b: AnyBlock): string {
  if (typeof b?.content === "string") return b.content; // a block just inserted, not yet saved
  return Array.isArray(b?.content)
    ? b.content.map((c: AnyBlock) => (c?.type === "text" ? c.text ?? "" : c?.type === "link" ? inlineText(c) : "")).join("")
    : "";
}

/** Quotes the note keeps from source pages: the run of quote blocks right before each page
 *  pill, at any nesting depth. */
export function quotedPassages(blocks: AnyBlock[] | null | undefined): Passage[] {
  const out: Passage[] = [];
  const walk = (list: AnyBlock[]) => {
    list.forEach((b, i) => {
      const p = b?.props;
      if (b?.type === "checkpoint" && p?.anchorType === "page" && p.resourceId && Number(p.value) >= 1) {
        for (let j = i - 1; j >= 0 && list[j]?.type === "quote"; j--) {
          const text = squash(inlineText(list[j]));
          if (text) out.push({ resourceId: p.resourceId, page: Number(p.value), text });
        }
      }
      if (Array.isArray(b?.children) && b.children.length) walk(b.children);
    });
  };
  if (Array.isArray(blocks)) walk(blocks);
  return out;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const mark = (s: string) => `<mark class="sb-passage">${escapeHtml(s)}</mark>`;
const MIN_EDGE = 12; // a run's edge must share this much with a quote's edge to count

/** One text run of a PDF page as HTML, with the parts inside a quoted passage marked. A run
 *  inside a passage is marked whole; a passage inside a run, or a passage starting at a run's
 *  end / ending at a run's start, marks just that part. */
export function markTextRun(str: string, passages: string[]): string {
  const run = squash(str);
  if (run.length < 3 || !passages.length) return escapeHtml(str);
  for (const p of passages) {
    if (p.includes(run)) return mark(str);
    const at = str.indexOf(p);
    if (at >= 0) return escapeHtml(str.slice(0, at)) + mark(p) + escapeHtml(str.slice(at + p.length));
    const tail = str.trimEnd();
    for (let k = Math.min(tail.length, p.length); k >= MIN_EDGE; k--) {
      if (tail.endsWith(p.slice(0, k))) {
        return escapeHtml(str.slice(0, tail.length - k)) + mark(tail.slice(tail.length - k)) + escapeHtml(str.slice(tail.length));
      }
    }
    const lead = str.length - str.trimStart().length;
    const head = str.slice(lead);
    for (let k = Math.min(head.length, p.length); k >= MIN_EDGE; k--) {
      if (head.startsWith(p.slice(p.length - k))) {
        return escapeHtml(str.slice(0, lead)) + mark(head.slice(0, k)) + escapeHtml(head.slice(k));
      }
    }
  }
  return escapeHtml(str);
}

/** Passages of one source, by page — what the PDF viewer needs. */
export function passagesByPage(passages: Passage[], resourceId: string): Map<number, string[]> {
  const byPage = new Map<number, string[]>();
  for (const p of passages) {
    if (p.resourceId !== resourceId) continue;
    byPage.set(p.page, [...(byPage.get(p.page) ?? []), p.text]);
  }
  return byPage;
}
