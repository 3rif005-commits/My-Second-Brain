// The editor AI (BlockNote xl-ai): what the model is told, what it is shown,
// and how its answer is read back.
//
// Measured on a live worksheet note (2026-11-23), before this file:
//   - no system prompt at all: ClientSideTransport only sends one when given
//     `systemPrompt`, and BlockNote's reference setup always passes
//     aiDocumentFormats.html.systemPrompt. The model didn't know the block
//     format, the `$`-suffixed ids, or this app's formulas and colours, so a
//     "fix this formula" came back as `\[ … \]` typed as text, and a request
//     on a selected line added a new line instead of changing it;
//   - every request sent the whole note as editor HTML: 133,719 characters
//     for 20,578 characters of text (style/class/title attributes, KaTeX's
//     rendering of each formula in a table cell, a 65k-character answer key),
//     about 54k tokens to rewrite one 600-character line.
// Notion does the same three things this file does: a written spec of its own
// block dialect, a compact page format, and focus on the selected blocks.
// @ts-ignore — xl-ai@0.48.0 exports these at runtime but its index.d.ts is empty
import { aiDocumentFormats, promptHelpers } from "@blocknote/xl-ai";
import { looksLikeMath } from "./notionPaste";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;
type Item = { id?: string; block?: string; cursor?: true };

/** This app's own HTML, on top of BlockNote's generic block format. */
export const HOUSE_RULES = `---
THIS EDITOR'S HTML. Use exactly these shapes; anything else becomes plain text.
- Inline formula: <span data-inline-content-type="inlineMath" data-latex="LATEX"></span>. The LaTeX goes only in data-latex (write " as &quot;).
- Formula on its own line: <div data-type="math">LATEX</div>, one block. Use it for long formulas, matrices and anything with \\begin…\\end.
- NEVER write maths as text: no $…$, $$…$$, \\(…\\), \\[…\\], no bare \\frac or \\vec in a sentence.
- The LaTeX must compile in KaTeX: balanced braces, \\left and \\right in pairs, no $ inside.
- Text colour: <span data-style-type="textColor" data-value="red">…</span>. Highlight: data-style-type="backgroundColor". A whole block: data-background-color="green" (or data-text-color) on its element. Colours: gray, brown, red, orange, yellow, green, blue, purple, pink.
- <strong>, <em>, <u>, <s>, <code>, <a href="…"> as usual.
EDITING
- With a selection, "update" the selected blocks by their ids. Add or delete blocks only when the user asks for more or less content.
- Keep everything the user did not ask to change: wording, formulas, colours, attributes, the block type.
- Fixing a formula: rewrite it as valid LaTeX in the shapes above, same meaning.
- Write in the note's language. Be brief.
- "[… not shown …]" marks parts of the note left out to save space: you can't see or edit them.
---
`;

export const EDITOR_AI_PROMPT: string = aiDocumentFormats.html.systemPrompt + HOUSE_RULES;

// ---- what the model is shown ------------------------------------------------

// data-html repeats a diagram's code; data-snapshot is its picture.
const NOISE_ATTRS = new Set(["style", "class", "title", "contenteditable", "spellcheck", "data-editable",
  "data-html", "data-snapshot"]);

/** A block's editor HTML without what only the browser needs. Everything
 *  BlockNote reads back is in data-* attributes (colours, alignment, levels,
 *  formulas); style/class/title repeat it or are for the screen, and a
 *  formula's KaTeX rendering is hundreds of characters for its data-latex. */
export function compactBlockHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const el of doc.querySelectorAll('[data-inline-content-type="inlineMath"]')) el.textContent = "";
  for (const el of doc.querySelectorAll(".katex, colgroup")) el.remove();
  for (const el of doc.body.querySelectorAll("*")) {
    for (const { name, value } of [...el.attributes]) {
      if (NOISE_ATTRS.has(name) || name.startsWith("aria-") || value.startsWith("data:")
          || ((name === "colspan" || name === "rowspan") && value === "1")) {
        el.removeAttribute(name);
      }
    }
  }
  return doc.body.innerHTML;
}

const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const isHeading = (html: string) => /^<(h[1-6]|details[^>]*data-level)/.test(html);

/** "[… 40 blocks not shown: Exercise 03 · Complex wave; Revision sheet …]" */
function gap(items: Item[]): Item {
  const headings = items.filter((x) => x.block && isHeading(x.block))
    .map((x) => plain(x.block!).slice(0, 60)).slice(0, 15);
  const outline = headings.length ? `; headings there: ${headings.join("; ")}` : "";
  return { block: `<p>[… ${items.length} blocks not shown${outline} …]</p>` };
}

/** The blocks around the anchors, within `budget` characters, with the rest
 *  of the note folded into "not shown" markers that keep its outline. The
 *  anchors (the selection, or the cursor) are always kept whole. */
export function windowAround(items: Item[], anchorIds: string[], budget: number): Item[] {
  const size = (x: Item) => (x.block?.length ?? 0) + 20;
  const total = items.reduce((n, x) => n + size(x), 0);
  if (total <= budget) return items;
  const hits = items.map((x, i) => (x.id && anchorIds.includes(x.id)) || x.cursor ? i : -1).filter((i) => i >= 0);
  let lo = hits.length ? Math.min(...hits) : 0;
  let hi = hits.length ? Math.max(...hits) : 0;
  let used = items.slice(lo, hi + 1).reduce((n, x) => n + size(x), 0);
  for (let grew = true; grew;) {
    grew = false;
    if (hi + 1 < items.length && used + size(items[hi + 1]) <= budget) { used += size(items[++hi]); grew = true; }
    if (lo > 0 && used + size(items[lo - 1]) <= budget) { used += size(items[--lo]); grew = true; }
  }
  return [
    ...(lo > 0 ? [gap(items.slice(0, lo))] : []),
    ...items.slice(lo, hi + 1),
    ...(hi + 1 < items.length ? [gap(items.slice(hi + 1))] : []),
  ];
}

/** Context around a selection (~4k tokens), and the note around the cursor
 *  when nothing is selected (~12k tokens: a whole worksheet fits). */
export const SELECTION_BUDGET = 16_000;
export const DOCUMENT_BUDGET = 48_000;

const toHtml = async (editor: AnyEditor, block: AnyBlock) =>
  compactBlockHtml(await editor.blocksToHTMLLossy([block]));

/** xl-ai's default document state (DocumentStateBuilder.ts), with compact
 *  HTML and a window instead of the whole note. Same shape, same wording on
 *  the model's side. */
export async function editorDocumentState(aiRequest: {
  editor: AnyEditor; selectedBlocks?: AnyBlock[]; emptyCursorBlockToDelete?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<any> {
  const { flattenBlocks, trimEmptyBlocks, convertBlocks, addCursorPosition, suffixIDs } = promptHelpers;
  const { editor } = aiRequest;
  const isEmptyDocument = trimEmptyBlocks(editor.document).length === 0;
  const convert = (blocks: AnyBlock[]) => convertBlocks(flattenBlocks(blocks), (b: AnyBlock) => toHtml(editor, b));

  if (aiRequest.selectedBlocks) {
    const selected: Item[] = await convert(aiRequest.selectedBlocks);
    const all: Item[] = await convert(editor.document);
    const context = windowAround(all, selected.map((x) => x.id!), SELECTION_BUDGET);
    return {
      isEmptyDocument,
      selection: true as const,
      selectedBlocks: suffixIDs(selected),
      // ids stripped, as xl-ai does, so the model can't edit outside the selection
      blocks: context.map((x) => ({ block: x.block })),
    };
  }
  const cursorBlockId = editor.getTextCursorPosition().block.id;
  const input = trimEmptyBlocks(editor.document, { cursorBlockId });
  const withCursor: Item[] = addCursorPosition(editor, await convert(input))
    .filter((x: Item) => x.cursor || x.id !== aiRequest.emptyCursorBlockToDelete);
  return {
    selection: false as const,
    blocks: suffixIDs(windowAround(withCursor, [cursorBlockId], DOCUMENT_BUDGET)),
    isEmptyDocument,
  };
}

// ---- how the answer is read back ---------------------------------------------

/** `\(…\)`, `\[…\]`, `$$…$$` or `$…$`, written as text in a sentence. */
const DELIMITED = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|(?<![$\\])\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\$)/g;
const LATEX_CMD = /\\[A-Za-z]+/;

/** A whole line of bare LaTeX ("\nabla \times \vec{E} = -\frac{…}{…}"): has a
 *  command, and once commands and braces are gone no prose word is left. */
function isBareFormula(text: string): boolean {
  if (!LATEX_CMD.test(text) || /[A-Za-z]:\\/.test(text)) return false;      // C:\Users\…
  if (!/[=^_{}<>+]|\\(frac|sqrt|sum|int|times|cdot|nabla|partial|vec|hat|approx)/.test(text)) return false;
  const rest = text.replace(/\\[A-Za-z]+/g, " ").replace(/\\./g, " ").replace(/[{}^_]/g, " ");
  return !/[A-Za-z]{4,}/.test(rest.replace(/\b(sin|cos|tan|exp|log|det|lim|max|min|mathrm|text|operatorname)\b/g, ""));
}

const span = (doc: Document, latex: string) => {
  const el = doc.createElement("span");
  el.setAttribute("data-inline-content-type", "inlineMath");
  el.setAttribute("data-latex", latex.trim());
  return el;
};

/** Maths the model wrote as text becomes real formulas: a block that is only
 *  a formula becomes a math block, a formula in a sentence an inline one.
 *  Leaves code, links and existing formulas alone. */
export function normalizeAIHtml(html: string): string {
  if (!/[$\\]/.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const skip = 'code, pre, a, [data-inline-content-type="inlineMath"], [data-type="math"]';

  // A paragraph that is one formula, delimited or bare → a math block.
  for (const p of [...doc.body.querySelectorAll("p")]) {
    if (p.closest(skip) || p.querySelector(skip) || p.closest("li, td, th, summary, blockquote")) continue;
    const text = (p.textContent ?? "").trim();
    const whole = /^(?:\$\$([\s\S]+)\$\$|\\\[([\s\S]+)\\\]|\$([^$]+)\$|\\\(([\s\S]+)\\\))$/.exec(text);
    const latex = whole ? (whole[1] ?? whole[2] ?? whole[3] ?? whole[4]) : isBareFormula(text) ? text : null;
    if (!latex || !looksLikeMath(latex)) continue;
    const div = doc.createElement("div");
    div.setAttribute("data-type", "math");
    div.textContent = latex.trim();
    p.replaceWith(div);
  }

  // Formulas inside a sentence → inline formulas.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (/[$\\]/.test(n.data) && !n.parentElement?.closest(skip)) nodes.push(n);
  }
  for (const node of nodes) {
    const text = node.data;
    // A list item, heading or cell that is nothing but bare LaTeX.
    if (!/[$]|\\[([]/.test(text) && isBareFormula(text) && looksLikeMath(text)
        && (node.parentElement?.textContent ?? "").trim() === text.trim()) {
      node.replaceWith(span(doc, text));
      continue;
    }
    const frag = doc.createDocumentFragment();
    let cursor = 0;
    let matched = false;
    DELIMITED.lastIndex = 0;
    for (let m = DELIMITED.exec(text); m; m = DELIMITED.exec(text)) {
      const latex = m[1] ?? m[2] ?? m[3] ?? m[4];
      // "$5-$10": a digit after the closing $ means it opened another amount.
      if (!looksLikeMath(latex) || (m[4] !== undefined && /\d/.test(text[m.index + m[0].length] ?? ""))) continue;
      matched = true;
      if (m.index > cursor) frag.appendChild(doc.createTextNode(text.slice(cursor, m.index)));
      frag.appendChild(span(doc, latex));
      cursor = m.index + m[0].length;
    }
    if (!matched) continue;
    if (cursor < text.length) frag.appendChild(doc.createTextNode(text.slice(cursor)));
    node.replaceWith(frag);
  }
  return doc.body.innerHTML;
}

/** The editor as the AI's tools see it: the model's HTML is normalised before
 *  BlockNote parses it. Everything else goes to the real editor.
 *
 *  Not the editor's own HTML: before each edit xl-ai turns the current block
 *  into HTML and back (html-blocks/tools/rebaseTool.ts) and refuses the edit
 *  if anything changed ("html diff"). Normalising that round trip turned a
 *  block's `\[ … \]` text into a formula, and every fix of such a block
 *  failed with "Oops! Something went wrong" (live, 2026-11-23). */
export function withNormalizedParse(editor: AnyEditor): AnyEditor {
  const own = new Set<string>();
  return new Proxy(editor, {
    get(target, prop) {
      if (prop === "blocksToHTMLLossy") {
        return async (...args: unknown[]) => {
          const html: string = await target.blocksToHTMLLossy(...args);
          own.add(html);
          return html;
        };
      }
      if (prop === "tryParseHTMLToBlocks") {
        return (html: string) => target.tryParseHTMLToBlocks(own.delete(html) ? html : normalizeAIHtml(html));
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** aiDocumentFormats.html's tools, reading the model's HTML through
 *  normalizeAIHtml. `opts` as for getStreamToolsProvider. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function editorStreamTools(opts: any = {}) {
  const base = aiDocumentFormats.html.getStreamToolsProvider(opts);
  return {
    getStreamTools: (editor: AnyEditor, selectionInfo: boolean | { from: number; to: number } | undefined, onBlockUpdate?: (id: string) => void) =>
      base.getStreamTools(withNormalizedParse(editor), selectionInfo, onBlockUpdate),
  };
}
