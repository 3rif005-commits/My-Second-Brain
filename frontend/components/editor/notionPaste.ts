// Paste-from-Notion transform layer.
//
// Every mapping below is built from REAL captured Notion clipboard payloads
// (a `paste` event listener reading `event.clipboardData` after a genuine
// ctrl+v — not exported HTML, not documentation, not a guess). The capture
// source is a purpose-built Notion page containing one of every block type,
// so each row of the table below was observed, not inferred.
//
// ---------------------------------------------------------------------------
// What Notion actually puts on the clipboard
// ---------------------------------------------------------------------------
//
//   - Four MIME types: `text/plain`, `text/html`,
//     `text/_notion-blocks-v3-production` and
//     `text/_notion-page-source-production`. The two proprietary ones read
//     back as the EMPTY STRING through `clipboardData.getData()` — they carry
//     nothing usable, so `text/html` genuinely is the richest available
//     source. There is no `text/markdown`.
//   - The HTML is flat and attribute-free: bare `h1`–`h3`, `p`, `ul`/`ol`/
//     `li`, `blockquote`, `pre`/`code`, `table`, `img`, `a`, `br`. No
//     `<div>`, no `<span>`, no classes (except `language-*` on `<code>`), no
//     data attributes, no inline styles, no `<details>`, no real `<aside>`.
//
// Block-by-block, as observed:
//
//   heading 1/2/3      -> <h1>/<h2>/<h3>                       native, fine
//   paragraph          -> <p>                                  native, fine
//   bulleted list      -> <ul><li>                              native, fine
//   numbered list      -> <ol><li>                              native, fine
//   quote              -> <blockquote><p>…</p></blockquote>     native, fine
//   code block         -> <pre><code class="language-x">        native, fine
//                         (BlockNote's codeBlock parse already reads the
//                         language off that class — nothing to do here)
//   table              -> <table>                               native, fine
//   to-do              -> <li><p>[ ] text</p></li>  /  [x] when checked
//                         A LITERAL bracket marker, not an <input>. Fixed by
//                         `rewriteNotionChecklists` below.
//   callout            -> <p>&lt;aside&gt;<br>{emoji}</p>
//                         <p>…body…</p> … <p>&lt;/aside&gt;</p>
//                         Literal, HTML-escaped text markers as their own
//                         top-level <p>s. Fixed by `rewriteAsideCallouts`.
//   block equation     -> <p>$$<br>{latex}<br>$$</p>            literal text.
//                         Fixed by `rewriteBlockEquations`.
//   inline equation    -> literal `$…$` inside the paragraph's text. Left as
//                         plain text: converting it needs a genuine *inline*
//                         content type (BlockNote's `createInlineContentSpec`,
//                         the pattern BlockEditor's `mention` spec uses)
//                         because it sits mid-sentence, not as its own block.
//                         Separate scope; unstyled but not lost.
//   image              -> <img src="attachment:<uuid>:<name>">  unfetchable.
//                         Fixed (as far as it can be) by
//                         `rewriteUnfetchableImages`.
//
// ---------------------------------------------------------------------------
// What is genuinely NOT RECOVERABLE from the clipboard (verified, not assumed)
// ---------------------------------------------------------------------------
//
//   - TOGGLE LISTS. A toggle arrives as
//         <ul><li><p>Title</p>…children…</li></ul>
//     which is byte-for-byte the same shape a PLAIN BULLET WITH NESTED
//     CHILDREN arrives as. Confirmed by capturing both from the same page:
//     Notion wraps every `<li>`'s own line in a `<p>` as soon as any item in
//     that list has children, and emits no attribute, class or marker to tell
//     the two apart. `text/plain` is no help either — both render as `- `.
//     So this module deliberately does NOT convert that shape: BlockNote's
//     own list parsing already turns it into a bulletListItem whose nested
//     blocks are the toggle's children, which keeps every line and the whole
//     hierarchy. Guessing "toggle" here would silently corrupt ordinary
//     nested bullets, which are far more common. (The one toggle shape that
//     IS unambiguous — `<blockquote>` wrapping a single list — is
//     reconstructed as a real toggle by `rewriteToggleBlockquotes` below.)
//   - TOGGLE HEADINGS. These arrive as a plain `<h2>` followed by their
//     children as flat sibling `<p>`s; both the toggle-ness and the
//     parent/child relationship are gone. Nothing distinguishes it from a
//     heading followed by paragraphs.
//   - TEXT AND HIGHLIGHT COLOURS. Notion strips them entirely — a paragraph
//     with red text and a yellow highlight arrives as one plain text node.
//   - CALLOUT COLOURS. Only the emoji survives; the colour does not. The
//     emoji is preserved verbatim (see `rewriteAsideCallouts`).
//   - IMAGE BYTES. `attachment:` URIs are internal Notion references, not
//     fetchable URLs, so the M1 re-hosting endpoint (built for a fetchable
//     external URL) cannot help. A labelled placeholder is the honest outcome.
//
// Every rewrite below runs unconditionally on any pasted HTML (Notion or
// not) rather than being gated on a "looks like Notion" sniff — each one
// only touches the exact structural shape it targets and is a no-op
// otherwise, so there's no real content this could get wrong by running on
// non-Notion paste too.

import { CALLOUT_PALETTE } from "./customBlocks";

/** Shared by every rewrite below: logs the actual markup to the console
 *  instead of silently dropping content this module doesn't recognize —
 *  the fastest path to fixing a mapping is reading what it didn't match. */
function logUnmapped(kind: string, el: Element): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[notionPaste] Unrecognized "${kind}" shape — that block's fidelity may ` +
      `be degraded. Please share the logged HTML so this mapping can be fixed:`,
    el.outerHTML.slice(0, 2000)
  );
}

// ---- Notion's own callout block, rendered as an <aside> text marker --------

// Derived from CALLOUT_PALETTE (single source of truth for icon↔type — see
// customBlocks.tsx) rather than a separately maintained copy.
const CALLOUT_ICON_TO_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(CALLOUT_PALETTE).map(([type, { icon }]) => [icon, type])
);

/** Matches one leading emoji, including its skin-tone modifiers, variation
 *  selector and ZWJ-joined parts, so a multi-codepoint emoji is taken whole
 *  rather than split down the middle. Used only as the fallback for a Notion
 *  callout whose emoji isn't one of this app's own nine. */
const LEADING_EMOJI =
  /^(\p{Extended_Pictographic}(?:[\u{1F3FB}-\u{1F3FF}]|\uFE0F|\u200D\p{Extended_Pictographic})*)/u;

/** Reads the callout's leading emoji off `node` and strips it in place, so the
 *  callout's own rendered icon pill isn't followed by a redundant duplicate
 *  emoji in its body text. Returns both the matching `calloutType` (falling
 *  back to "NOTE") and the RAW emoji.
 *
 *  Returning the raw emoji is the point: real Notion callouts carry any emoji
 *  at all, not just this app's nine palette icons, and collapsing every
 *  unrecognized one to a "Note" pill loses the only piece of the original
 *  callout's identity that survives the clipboard (its colour doesn't). With
 *  the emoji preserved, `CalloutBlockView` can render the source icon instead
 *  of a wrong palette label.
 *
 *  Only ever touches this one text node — any sibling elements (e.g.
 *  `<strong>`/`<em>` runs later in the same paragraph) are left alone. */
function stripLeadingCalloutIcon(node: Text): { calloutType: string; icon: string } {
  const trimmed = node.data.replace(/^\s+/, "");
  for (const [icon, type] of Object.entries(CALLOUT_ICON_TO_TYPE)) {
    if (trimmed.startsWith(icon)) {
      // Two things get dropped after the icon itself. A trailing variation
      // selector: a palette icon stored without one ("❗") still matches a
      // source emoji written with one ("❗️"), leaving a stray invisible
      // codepoint behind. And the space that separated the emoji from the
      // text: this node is the head of the callout's first line, so anything
      // left there would show as an indent in the rendered block.
      node.data = trimmed.slice(icon.length).replace(/^\uFE0F/, "").replace(/^\s+/, "");
      return { calloutType: type, icon };
    }
  }
  const match = LEADING_EMOJI.exec(trimmed);
  if (match) {
    node.data = trimmed.slice(match[1].length).replace(/^\s+/, "");
    return { calloutType: "NOTE", icon: match[1] };
  }
  return { calloutType: "NOTE", icon: "" };
}

/** The confirmed real shape for Notion's callout block — see file header. The
 *  open/close markers are plain `<p>`s holding the literal, HTML-escaped text
 *  "<aside>" / "</aside>", with the callout's real content sandwiched between
 *  them as further siblings.
 *
 *  Where those siblings live varies: at the top level of the document when the
 *  callout is top-level, but bunched in with several unrelated rows inside one
 *  outer `<li>` when the callout sits inside a toggle (Notion emits a toggle's
 *  children as flat siblings of its own line — see the file header). The one
 *  thing that holds either way: the closing marker is always reachable by
 *  walking forward through the opening marker's own siblings, so that's what
 *  this scans for rather than assuming anything about the parent.
 *
 *  Rewrites the span into `<div data-type="callout" data-callout-type="..."
 *  data-callout-icon="...">`, the exact format `CalloutBlockSpec.parse()`
 *  (customBlocks.tsx) already understands — so no new parsing logic is needed
 *  on the BlockNote side, only producing the input shape it already expects. */
function rewriteAsideCallouts(doc: Document): void {
  const openMarkers = [...doc.querySelectorAll("p")].filter((p) =>
    p.textContent?.trimStart().startsWith("<aside>")
  );

  for (const openP of openMarkers) {
    const parent = openP.parentElement;
    if (!parent) continue;

    const middle: Element[] = [];
    let closeP: Element | null = null;
    for (let node = openP.nextElementSibling; node; node = node.nextElementSibling) {
      if (node.textContent?.trim() === "</aside>") {
        closeP = node;
        break;
      }
      middle.push(node);
    }
    if (!closeP) {
      logUnmapped("aside-callout (no matching closing marker among later siblings)", openP);
      continue;
    }

    // Strip the "<aside>" text node and the <br> that follows it, leaving
    // whatever came after (the emoji, and the callout's first line when
    // Notion put it on the same paragraph) in place.
    const openNodes = [...openP.childNodes];
    const brIndex = openNodes.findIndex((n) => n.nodeName === "BR");
    if (brIndex !== -1) {
      for (let i = 0; i <= brIndex; i++) openP.removeChild(openNodes[i]);
    }

    const firstTextNode = openP.firstChild;
    const { calloutType, icon } =
      firstTextNode && firstTextNode.nodeType === Node.TEXT_NODE
        ? stripLeadingCalloutIcon(firstTextNode as Text)
        : { calloutType: "NOTE", icon: "" };

    // An opener with nothing left after stripping (no <br> found, or the
    // whole line was just the marker and the emoji — the common case, since
    // Notion puts the callout's text in its own following <p>) contributes no
    // content of its own.
    const openIsNowEmpty = !openP.textContent?.trim();

    const div = doc.createElement("div");
    div.setAttribute("data-type", "callout");
    div.setAttribute("data-callout-type", calloutType);
    // Only when the emoji isn't one of this app's own: a palette emoji is
    // already fully described by `data-callout-type`, and recording it here
    // too would make an old pasted callout suddenly render as "custom" if a
    // palette icon were ever changed.
    if (icon && !(icon in CALLOUT_ICON_TO_TYPE)) div.setAttribute("data-callout-icon", icon);
    if (!openIsNowEmpty) div.appendChild(openP); // appendChild moves it out of `parent`
    middle.forEach((m) => div.appendChild(m));   // ditto — each move detaches from `parent`

    parent.insertBefore(div, closeP);
    closeP.remove();
    if (openIsNowEmpty) openP.remove();
  }
}

// ---- to-do / checklist items, rendered as a literal "[ ]" text marker ------

/** `[ ]` (unchecked) or `[x]`/`[X]` (checked) at the head of a list item's own
 *  line — the literal marker Notion's clipboard HTML uses for a to-do block.
 *  Confirmed by capturing the same list before and after ticking the box. */
const TODO_MARKER = /^\s*\[([ xX])\]\s?/;

/** The list item's own first line of text, i.e. the first non-blank text node
 *  that is NOT inside a nested `<ul>`/`<ol>` (that would be a child block, a
 *  different item's line). Returns null when the item's line starts with a
 *  nested list or has no text at all. */
function ownLeadingTextNode(li: Element): Text | null {
  const walker = li.ownerDocument.createTreeWalker(li, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.data.trim()) {
      for (let p = node.parentElement; p && p !== li; p = p.parentElement) {
        if (p.tagName === "UL" || p.tagName === "OL") return null;
      }
      return node;
    }
    node = walker.nextNode() as Text | null;
  }
  return null;
}

/** Turns Notion's literal "[ ] "/"[x] " to-do markers into the `<li><input
 *  type="checkbox"><p>…</p></li>` shape BlockNote's NATIVE `checkListItem`
 *  block parses — the same markup BlockNote's own `toExternalHTML` emits for
 *  that block, so this produces a real check-list item with a working
 *  checkbox, not a bullet with a bracket typed into it (today's behavior).
 *
 *  Skips a to-do nested under a list item that ISN'T itself a to-do:
 *  BlockNote's `checkListItem.parse` looks for `input[type=checkbox]` among
 *  ALL descendants of an `<li>`, not just its own children, so handing a
 *  nested to-do a checkbox would make every enclosing plain bullet parse as a
 *  check-list item too. Corrupting the ancestor is worse than leaving one
 *  nested to-do as a bullet, so those are left alone and logged. When every
 *  enclosing item IS a to-do there's no problem: each gets its own input as
 *  its first child, so the ancestor's `querySelector` finds its own. */
function rewriteNotionChecklists(doc: Document): void {
  const todos = new Map<Element, { node: Text; checked: boolean }>();
  for (const li of [...doc.querySelectorAll("ul > li, ul > div > li")]) {
    const node = ownLeadingTextNode(li);
    if (!node) continue;
    const match = TODO_MARKER.exec(node.data);
    if (!match) continue;
    todos.set(li, { node, checked: match[1] !== " " });
  }

  for (const [li, { node, checked }] of todos) {
    let nestedUnderPlainItem = false;
    for (
      let ancestor = li.parentElement?.closest("li") ?? null;
      ancestor;
      ancestor = ancestor.parentElement?.closest("li") ?? null
    ) {
      if (!todos.has(ancestor)) {
        nestedUnderPlainItem = true;
        break;
      }
    }
    if (nestedUnderPlainItem) {
      logUnmapped("to-do nested under a non-to-do list item (left as plain text)", li);
      continue;
    }

    node.data = node.data.replace(TODO_MARKER, "");
    const input = doc.createElement("input");
    input.setAttribute("type", "checkbox");
    if (checked) input.setAttribute("checked", "");
    li.insertBefore(input, li.firstChild);
  }
}

// ---- block equations, rendered as literal $$…$$ text -----------------------

/** Notion emits a block equation as `<p>$$<br>{latex}<br>$$</p>` — literal
 *  delimiters, no MathML, no KaTeX markup. Rewrites it into the
 *  `<div data-type="math">` shape this app's own `MathBlockSpec` already
 *  parses (customBlocks.tsx), giving a real, KaTeX-rendered, click-to-edit
 *  math block instead of a paragraph with dollar signs in it.
 *
 *  Deliberately only handles the `$$…$$` BLOCK form. Inline `$…$` sits
 *  mid-sentence and needs an inline content spec to convert without
 *  destroying the sentence around it — see the file header. */
function rewriteBlockEquations(doc: Document): void {
  for (const p of [...doc.querySelectorAll("p")]) {
    const text = (p.textContent || "").trim();
    if (text.length < 5 || !text.startsWith("$$") || !text.endsWith("$$")) continue;
    const latex = text.slice(2, -2).trim();
    if (!latex) continue;
    const div = doc.createElement("div");
    div.setAttribute("data-type", "math");
    div.textContent = latex;
    p.replaceWith(div);
  }
}

// ---- inline equations, rendered as literal $…$ text mid-sentence ------------

/** One `$…$` run. Deliberately strict, because a stray dollar sign in prose
 *  ("costs $5 to $10") must not be swallowed as a formula:
 *    - `(?<![$\\])` / `(?!\$)` — never straddle a `$$` block delimiter, and
 *      never start on an escaped `\$`.
 *    - `(?!\s)` / `(?<!\s)` — LaTeX doesn't begin or end with a space, but a
 *      sentence like "$5 to $10" does right after the opening delimiter.
 *    - `[^$\n]` — a formula never spans a line break or another delimiter. */
const INLINE_MATH = /(?<![$\\])\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\$)/g;

/** Rejects the money-and-numbers false positives that survive the delimiter
 *  rules above: a run with no letters, no backslash and no math operator is
 *  far likelier to be a price than a formula. */
function looksLikeMath(latex: string): boolean {
  return !/^[\s\d.,%]+$/.test(latex) && /[A-Za-z\\^_{}=+\-*/()[\]|]/.test(latex);
}

/** Turns inline `$…$` runs into `<span data-inline-content-type="inlineMath"
 *  data-latex="…">`, which BlockNote's own parse rule maps onto the
 *  `InlineMathSpec` inline content type (customBlocks.tsx) — so a formula
 *  mid-sentence renders as real KaTeX while the words around it stay one
 *  continuous paragraph.
 *
 *  This is what the earlier "left as plain text, separate scope" note in this
 *  file's header referred to; it's now built. Must run AFTER
 *  `rewriteBlockEquations`, so a `$$…$$` block is already gone by the time the
 *  single-dollar pattern is applied to what's left.
 *
 *  Skips text inside `code`, `pre` and `a`, where a dollar sign is far more
 *  likely to be a shell prompt, a variable or part of a URL than a formula. */
function rewriteInlineEquations(doc: Document): void {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const candidates: Text[] = [];
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (n.data.includes("$") && !n.parentElement?.closest("code, pre, a")) candidates.push(n);
  }

  for (const node of candidates) {
    const text = node.data;
    const frag = doc.createDocumentFragment();
    let cursor = 0;
    let matched = false;
    INLINE_MATH.lastIndex = 0;
    for (let m = INLINE_MATH.exec(text); m; m = INLINE_MATH.exec(text)) {
      const latex = m[1];
      // A digit straight after the closing delimiter means the "closing" $ was
      // really the opening one of another amount ("$5-$10").
      if (!looksLikeMath(latex) || /\d/.test(text[m.index + m[0].length] ?? "")) continue;
      matched = true;
      if (m.index > cursor) frag.appendChild(doc.createTextNode(text.slice(cursor, m.index)));
      const span = doc.createElement("span");
      span.setAttribute("data-inline-content-type", "inlineMath");
      span.setAttribute("data-latex", latex);
      frag.appendChild(span);
      cursor = m.index + m[0].length;
    }
    if (!matched) continue;
    if (cursor < text.length) frag.appendChild(doc.createTextNode(text.slice(cursor)));
    node.replaceWith(frag);
  }
}

// ---- toggles rendered as <blockquote><ul>…</ul></blockquote> ---------------

/** The one toggle shape that IS unambiguous. A `<blockquote>` whose single
 *  child is a list can't be a genuine Notion quote (those hold exactly one
 *  `<p>`) and can't be a plain bulleted list (those aren't wrapped in a
 *  blockquote at all), so reconstructing a real toggle here is safe.
 *
 *  Emits `<details open><summary>…</summary>…</details>`, which BlockNote's
 *  NATIVE `toggleListItem` block parses directly (its `parse` matches the
 *  `DETAILS` tag and its `parseContent` takes the `<summary>` as the toggle's
 *  own line and every other child as its collapsed children). The previous
 *  version of this function just unwrapped the blockquote, which stopped the
 *  "toggle collapses into one dense paragraph" data loss — BlockNote's
 *  inline-only `quote` block flattens a list dropped inside it — but threw
 *  the collapse/expand behavior away, leaving a flat bullet list. This
 *  produces the real thing.
 *
 *  The first `<li>` is the toggle's own line; the rest, plus anything nested
 *  inside that first item, are its children. Note also that a `<summary>`
 *  containing an `h1`–`h6` makes BlockNote parse the result as a TOGGLEABLE
 *  HEADING instead (its `heading` spec declares `runsBefore:
 *  ["toggleListItem"]`), so a heading-style toggle reconstructs correctly
 *  through the same path without any extra branch here. */
function rewriteToggleBlockquotes(doc: Document): void {
  for (const bq of [...doc.querySelectorAll("blockquote")]) {
    const onlyChild = bq.children.length === 1 ? bq.children[0] : null;
    if (!onlyChild || (onlyChild.tagName !== "UL" && onlyChild.tagName !== "OL")) continue;

    const items = [...onlyChild.children].filter((c) => c.tagName === "LI");
    if (items.length === 0) {
      logUnmapped("toggle blockquote (wrapped list has no items)", bq);
      continue;
    }

    const [head, ...rest] = items;
    const details = doc.createElement("details");
    details.setAttribute("open", "");
    const summary = doc.createElement("summary");

    // Split the first item into its own line (the summary) and whatever it
    // already nested (which becomes the toggle's children alongside `rest`).
    const nestedInHead: Element[] = [];
    const summaryNodes: Node[] = [];
    for (const node of [...head.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as Element).tagName;
        if (tag === "UL" || tag === "OL") {
          nestedInHead.push(node as Element);
          continue;
        }
      }
      summaryNodes.push(node);
    }
    // Drop the whitespace-only text nodes Notion leaves between an item's line
    // and its children (indentation and newlines in the serialized markup).
    // BlockNote parses <summary> with `preserveWhitespace`, so carrying them
    // through turns each newline into a hard break — which is exactly what put
    // two blank lines inside a real pasted toggle's own line and left the
    // collapse triangle stranded on a row of its own.
    const meaningful = summaryNodes.filter(
      (n) => n.nodeType !== Node.TEXT_NODE || (n.textContent ?? "").trim() !== ""
    );
    // Notion wraps an item's own line in a <p> whenever any item in that list
    // has children. A <p> inside <summary> would be parsed as a block node
    // where only inline content fits, so unwrap that one paragraph.
    const soleParagraph =
      meaningful.length === 1 &&
      meaningful[0].nodeType === Node.ELEMENT_NODE &&
      (meaningful[0] as Element).tagName === "P"
        ? (meaningful[0] as Element)
        : null;
    (soleParagraph ? [...soleParagraph.childNodes] : meaningful).forEach((n) =>
      summary.appendChild(n)
    );
    // Collapse any run of whitespace that survived inside the line itself, so
    // a newline in the source markup can't become a break in the summary, then
    // trim its outer edges — the indentation around a bare text node would
    // otherwise show as a leading/trailing space in the toggle's own line.
    const summaryNodeList = [...summary.childNodes];
    for (const n of summaryNodeList) {
      if (n.nodeType === Node.TEXT_NODE) n.textContent = (n.textContent ?? "").replace(/\s+/g, " ");
    }
    const firstNode = summaryNodeList[0];
    const lastNode = summaryNodeList[summaryNodeList.length - 1];
    if (firstNode?.nodeType === Node.TEXT_NODE) {
      firstNode.textContent = (firstNode.textContent ?? "").replace(/^\s+/, "");
    }
    if (lastNode?.nodeType === Node.TEXT_NODE) {
      lastNode.textContent = (lastNode.textContent ?? "").replace(/\s+$/, "");
    }

    details.appendChild(summary);
    nestedInHead.forEach((n) => details.appendChild(n));
    if (rest.length > 0) {
      const childList = doc.createElement(onlyChild.tagName.toLowerCase());
      rest.forEach((li) => childList.appendChild(li));
      details.appendChild(childList);
    }
    bq.replaceWith(details);
  }
}

// ---- toggles rendered as a div with a collapse affordance -------------------

/** Fallback for a toggle shape that ISN'T what real Notion clipboard data
 *  turned out to use (see file header) — kept in case some other paste
 *  source (or a future Notion version) represents a toggle as a div wrapper
 *  instead. Always a no-op against real Notion HTML today (Notion's clipboard
 *  has no `<div>` at all). Unrecognized candidates are logged, not silently
 *  dropped. */
function rewriteDivToggles(doc: Document): void {
  const candidates = [
    ...doc.querySelectorAll('div[class*="toggle" i], div[role="button"][aria-expanded]'),
  ].filter((el) => !el.closest("details")).reverse();

  for (const el of candidates) {
    const children = [...el.children];
    if (children.length === 0) {
      logUnmapped("toggle", el);
      continue;
    }
    const [summaryEl, ...bodyEls] = children;
    const details = doc.createElement("details");
    details.setAttribute("open", "");
    const summary = doc.createElement("summary");
    summary.innerHTML = summaryEl.innerHTML;
    details.appendChild(summary);
    const body = doc.createElement("div");
    bodyEls.forEach((b) => body.appendChild(b.cloneNode(true)));
    details.appendChild(body);
    el.replaceWith(details);
  }
}

// ---- list items that mix nested lists with other nested blocks --------------

/** Tags that can carry a list item's OWN line (as opposed to a nested child
 *  block). Notion wraps an item's line in a `<p>` as soon as any item in that
 *  list has children; the heading tags are here for non-Notion paste sources. */
const LINE_ELEMENTS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6"]);

/** Works around a real BlockNote HTML-parsing defect, found by pasting a
 *  captured Notion toggle and watching its hierarchy collapse.
 *
 *  When an `<li>` holds BOTH a nested list and some other nested block,
 *  BlockNote's `getListItemContent` produces a document ProseMirror then lifts
 *  apart, and children escape to the top level:
 *
 *    <li><p>L</p><p>c1</p><ul><li>n</li></ul></li>
 *      -> bulletListItem("L") + children [paragraph("c1")], and "n" lifted out
 *         as a SIBLING list item — one level of nesting silently lost.
 *    <li><p>L</p><ul><li>n</li></ul><p>c1</p></li>
 *      -> the trailing paragraph is lifted out AND retyped as a list item.
 *
 *  Both are exactly what a real Notion toggle (or any nested bullet) with
 *  mixed children arrives as. All-paragraph children and a single nested list
 *  both parse correctly, so only the mixed case is touched here.
 *
 *  The fix is a plain `<div>` around everything after the item's own line:
 *  that gives ProseMirror one element to attach the whole child group to, and
 *  the full tree — order, types and nesting depth — survives. Verified against
 *  bulleted, numbered and check-list items, and recursively for toggles inside
 *  toggles. Deliberately NOT applied to the shapes that already parse
 *  correctly, so nothing that works today changes. */
function groupListItemChildren(doc: Document): void {
  for (const li of [...doc.querySelectorAll("li")]) {
    const nodes = [...li.childNodes];

    // Everything before `childStart` is the item's own line: leading inline
    // content, the checkbox `rewriteNotionChecklists` may have inserted, and
    // the first line-carrying element if there is one.
    let childStart = -1;
    let lineTaken = false;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = (node as Element).tagName;
      if (tag === "INPUT" || tag === "BR") continue;
      if (!lineTaken && LINE_ELEMENTS.has(tag)) {
        lineTaken = true;
        continue;
      }
      childStart = i;
      break;
    }
    if (childStart === -1) continue;

    const childElements = nodes
      .slice(childStart)
      .filter((n): n is Element => n.nodeType === Node.ELEMENT_NODE);
    const hasList = childElements.some((e) => e.tagName === "UL" || e.tagName === "OL");
    const hasOther = childElements.some((e) => e.tagName !== "UL" && e.tagName !== "OL");
    if (!hasList || !hasOther) continue; // these shapes already parse correctly

    const wrapper = doc.createElement("div");
    nodes.slice(childStart).forEach((n) => wrapper.appendChild(n)); // appendChild moves
    li.appendChild(wrapper);
  }
}

// ---- images unrecoverable from clipboard alone -------------------------------

/** Notion's `attachment:` URIs aren't fetchable — see file header. Replaces
 *  the image with a visible, honest placeholder (using its alt text, the
 *  only thing that does survive) instead of letting it fall through to
 *  BlockNote's image parser, which silently drops the unresolvable url and
 *  leaves bare alt text sitting in the surrounding paragraph — indistinguishable
 *  from a typo. */
function rewriteUnfetchableImages(doc: Document): void {
  const imgs = [...doc.querySelectorAll('img[src^="attachment:" i]')];
  for (const img of imgs) {
    const alt = img.getAttribute("alt") || "image";
    const notice = doc.createElement("p");
    notice.textContent = `[Image not available via copy-paste: ${alt} — please re-add it manually]`;
    img.replaceWith(notice);
  }
}

// ---- externally-hosted images (not Notion's own — any other paste source) ---

/** Rewrites every externally-hosted `<img src>` to a permanent, re-hosted
 *  URL via the backend's `/notes/{noteId}/paste-image` endpoint (M1). Not
 *  useful for Notion's own images (see file header — those use `attachment:`
 *  URIs, not fetchable ones) but kept for any other paste source with a
 *  hotlinked or signed/expiring image URL, which has the same problem.
 *  Leaves the original `src` in place on any failure (network error,
 *  non-image response, oversized) rather than dropping the image block — a
 *  broken-but-present link beats silent data loss. */
async function rehostImages(doc: Document, noteId: string): Promise<void> {
  const imgs = [...doc.querySelectorAll("img[src]")].filter((img) => {
    const src = img.getAttribute("src") || "";
    return /^https?:\/\//i.test(src) && !src.includes(window.location.host);
  });
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src")!;
      try {
        // /api/ws/<path> is the generic authenticated proxy to FastAPI
        // (see app/api/ws/[...path]/route.ts) — "notes" is already on its
        // ALLOWED_PREFIXES allowlist.
        const res = await fetch(`/api/ws/notes/${encodeURIComponent(noteId)}/paste-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: src }),
        });
        if (!res.ok) return; // keep the original src
        const { url } = (await res.json()) as { url?: string };
        if (url) img.setAttribute("src", url);
      } catch {
        // keep the original src — see doc comment above
      }
    })
  );
}

// ---- orchestration --------------------------------------------------------

/** Runs every rewrite pass above and returns the transformed HTML. Never
 *  throws — any internal failure logs and returns the original html
 *  unchanged, so a bug in this module degrades to today's paste behavior
 *  instead of breaking the paste entirely. */
export async function transformNotionHtml(html: string, noteId: string): Promise<string> {
  try {
    const doc = new window.DOMParser().parseFromString(html, "text/html");
    // Checklists first: it reads each list item's own leading text, which the
    // toggle pass below would have moved into a <summary> by then.
    rewriteNotionChecklists(doc);
    rewriteAsideCallouts(doc);
    rewriteBlockEquations(doc);
    // Strictly after the block form: `$$x$$` must already be gone before the
    // single-dollar pattern runs, or it would match the inner `$x$`.
    rewriteInlineEquations(doc);
    rewriteToggleBlockquotes(doc);
    rewriteDivToggles(doc);
    // Last of the structural passes: it groups whatever the passes above left
    // inside each list item, so it must see their final shape (a callout div
    // sitting next to a nested list is one of the cases it fixes).
    groupListItemChildren(doc);
    rewriteUnfetchableImages(doc);
    await rehostImages(doc, noteId);
    return doc.body.innerHTML;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[notionPaste] transform failed, pasting unmodified HTML:", e);
    return html;
  }
}
