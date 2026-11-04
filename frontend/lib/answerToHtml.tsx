// An AI answer, made ready for the note: its Markdown becomes the HTML the
// editor's insert path takes, and two kinds of marker become real blocks:
//  - [n] citations → a page/time pill after the paragraph that cites them, so
//    the note can jump back to the source (a bare [1] means nothing in a note);
//  - [[src:…]] tokens from the source tools → the quote, table, formula, figure,
//    frame, clip or audio they stand for (lib/sourceInserts.ts).
// Both travel as embedded blocks (lib/embeddedBlocks.ts).
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { anchorLabel, type Citation } from "@/lib/workspace";
import { embedBlocksHtml } from "@/lib/embeddedBlocks";
import { insertBlocks, pillBlock, type SourceInsert } from "@/lib/sourceInserts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

const CITE_RUN = /\s*((?:\[\d{1,2}\])+)(?!\()/g;

/** For reading (the chat bubble without chips): [n] → "(Lecture 10, p. 3)". */
export function resolveCitations(md: string, citations: Citation[]): string {
  const byN = new Map(citations.map((c) => [c.n, c]));
  return md.replace(CITE_RUN, (run) => {
    const labels = [...run.matchAll(/\[(\d{1,2})\]/g)]
      .map((m) => byN.get(Number(m[1])))
      .filter((c): c is Citation => !!c)
      .map((c) => (c.kind === "note" ? `${c.title} (note)` : `${c.title}, ${anchorLabel(c.anchor_type, c.anchor_start)}`));
    return labels.length ? ` (${[...new Set(labels)].join("; ")})` : "";
  });
}

/** [n] runs → `[[cite:1.2]]` for source passages; a brought-in note's own text
 *  has no place to jump to inside a source, so it keeps its name in words. */
function citeTokens(md: string, citations: Citation[]): string {
  const byN = new Map(citations.map((c) => [c.n, c]));
  return md.replace(CITE_RUN, (run) => {
    const cited = [...run.matchAll(/\[(\d{1,2})\]/g)]
      .map((m) => byN.get(Number(m[1])))
      .filter((c): c is Citation => !!c);
    const notes = [...new Set(cited.filter((c) => c.kind === "note").map((c) => `${c.title} (note)`))];
    const srcs = cited.filter((c) => c.kind !== "note").map((c) => c.n);
    return (notes.length ? ` (${notes.join("; ")})` : "") + (srcs.length ? ` [[cite:${srcs.join(".")}]]` : "");
  });
}

const MARKER = /\s*\[\[(src:[0-9a-f]{6}|cite:[\d.]+)\]\]/g;

function placeBlocks(html: string, citations: Citation[], inserts: SourceInsert[], noteId: string): string {
  if (!html.includes("[[")) return html;
  const byN = new Map(citations.map((c) => [c.n, c]));
  const byToken = new Map(inserts.map((r) => [`[[${r.token.slice(2, -2)}]]`, r]));
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  const after = new Map<Element, { blocks: AnyBlock[]; pills: Set<string> }>();
  const holders = new Set<Element>();

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.nodeValue ?? "").includes("[[")) texts.push(n as Text);
  }
  for (const t of texts) {
    let top: Element | null = t.parentElement;
    while (top && top.parentElement && top.parentElement !== body) top = top.parentElement;
    if (!top || top === body) continue;
    const slot = after.get(top) ?? { blocks: [], pills: new Set<string>() };
    after.set(top, slot);
    t.nodeValue = (t.nodeValue ?? "").replace(MARKER, (_m, inner: string) => {
      if (inner.startsWith("src:")) {
        const r = byToken.get(`[[${inner}]]`);
        if (r) slot.blocks.push(...insertBlocks(r, noteId));
        return "";
      }
      for (const n of inner.slice(5).split(".").map(Number)) {
        const c = byN.get(n);
        if (!c) continue;
        const key = `${c.resource_id}|${c.anchor_type}|${c.anchor_start}`;
        if (slot.pills.has(key)) continue;
        slot.pills.add(key);
        slot.blocks.push(pillBlock({
          noteId: c.source_note_id || noteId, resourceId: c.resource_id,
          anchorType: c.anchor_type, value: c.anchor_start, label: c.title,
        }));
      }
      return "";
    });
    const holder = t.parentElement?.closest("p, li");
    if (holder) holders.add(holder);
  }
  const empty = (el: Element) => !el.textContent?.trim() && !el.querySelector("img");
  for (const [top, { blocks }] of after) {
    if (!blocks.length) continue;
    const tpl = doc.createElement("template");
    tpl.innerHTML = embedBlocksHtml(blocks);
    top.after(tpl.content.firstElementChild!);
  }
  // A paragraph or list item that held only a token goes with it (and a list
  // left with no items).
  for (const h of holders) if (h.isConnected && empty(h)) h.remove();
  for (const top of after.keys()) if (top.isConnected && empty(top)) top.remove();
  return body.innerHTML;
}

export function answerToHtml(md: string, citations: Citation[] = [],
                             inserts: SourceInsert[] = [], noteId = ""): string {
  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{citeTokens(md, citations)}</ReactMarkdown>,
  );
  return placeBlocks(html, citations, inserts, noteId);
}
