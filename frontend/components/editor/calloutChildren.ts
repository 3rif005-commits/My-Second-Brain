type AnyBlockLike = { type: string; children?: AnyBlockLike[]; [key: string]: unknown };

export async function extractCalloutChildren<T extends AnyBlockLike>(
  html: string,
  parseHTML: (html: string) => Promise<T[]>
): Promise<{ strippedHtml: string; calloutChildren: T[][] }> {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const allCalloutDivs = [...doc.querySelectorAll('div[data-type="callout"]')];
  // attachCalloutChildren re-associates extracted children with their callout
  // block using a positional counter (document order). A callout div nested
  // inside another callout div, or inside a table cell, would still match
  // querySelectorAll but isn't a top-level callout in the block tree BlockNote
  // produces — extracting/counting it desyncs the counter and silently
  // mis-attributes every callout that follows. Skip those instead: leave
  // their markup untouched rather than risk wrong content on a sibling.
  //
  // Note: this deliberately checks `el.parentElement.closest(...)` (strict
  // ancestors only), not `el.closest(...)`. `closest()` matches the element
  // itself before walking up, and every callout div always self-matches the
  // `div[data-type="callout"]` branch of this selector — so calling it on
  // the element itself would always return the element, making the check a
  // no-op that never detects nesting (verified with a jsdom probe).
  const calloutDivs = allCalloutDivs.filter(
    (el) => el.parentElement?.closest('div[data-type="callout"], td, th') == null
  );
  if (calloutDivs.length !== allCalloutDivs.length) {
    console.warn(
      `extractCalloutChildren: skipped ${allCalloutDivs.length - calloutDivs.length} ` +
        `callout div(s) nested inside another callout or a table cell (left in place, not extracted).`
    );
  }
  const calloutChildren: T[][] = [];
  for (const el of calloutDivs) {
    const children = await parseHTML(el.innerHTML);
    calloutChildren.push(children);
    el.innerHTML = "";
  }
  return { strippedHtml: doc.body.innerHTML, calloutChildren };
}

export function attachCalloutChildren<T extends AnyBlockLike>(
  blocks: T[],
  calloutChildren: T[][]
): T[] {
  let i = 0;
  function walk(list: T[]): T[] {
    return list.map((b) => {
      const children = Array.isArray(b.children) ? walk(b.children as T[]) : [];
      if (b.type === "callout") {
        return { ...b, children: calloutChildren[i++] ?? [] };
      }
      return { ...b, children };
    });
  }
  return walk(blocks);
}

/** Flatten block-level math inside a table cell to its LaTeX text.
 *
 *  A BlockNote table cell holds INLINE content only, so a
 *  `<div data-type="math">` inside a `<td>` is dropped outright — silently,
 *  and the table still parses as a well-formed table with an empty column.
 *  Observed live: a Step / Computation / Result table came back with all three
 *  of its formulas gone and only the step names and the results left.
 *
 *  The note prompt asks for both of these things and they collide on every
 *  worked example: steps go in a Step/Action/Result table, and formulas are
 *  math blocks. Rather than forbid one of them, keep the content — an equation
 *  written as LaTeX source in the cell is worse-looking than a rendered one and
 *  infinitely better than a blank cell.
 */
export function inlineMathInTableCells(html: string): string {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const stranded = [...doc.querySelectorAll('td [data-type="math"], th [data-type="math"]')];
  for (const el of stranded) {
    el.replaceWith(doc.createTextNode(el.textContent ?? ""));
  }
  if (stranded.length) {
    console.warn(
      `inlineMathInTableCells: flattened ${stranded.length} math block(s) ` +
        `inside table cells — BlockNote cells cannot hold a block, and they ` +
        `would otherwise have been dropped.`
    );
  }
  return doc.body.innerHTML;
}

/** Collapse a standalone heading that its own toggle immediately repeats.
 *
 *  When a source section maps 1:1 onto a single concept, the model writes the
 *  section heading and then a concept toggle with the *same* title:
 *
 *      <h3 data-anchor="1:s:0">The Update Rule</h3>
 *      <details><summary><h5><span ...>The Update Rule</span></h5></summary>…
 *
 *  which renders as the title twice in a row — once plain, once as a
 *  highlighted toggle. Measured on a real note: 5 of 5 sections did this.
 *
 *  The fix is a merge, not a deletion, because the two halves each carry
 *  something the other needs. The standalone heading owns `data-anchor` and the
 *  level the source-sync counts (`findLevelHeadings(blocks, 3)` zips level-3
 *  headings against the draft's `<h3>`s positionally, so removing one would
 *  shift every anchor after it). The summary owns the highlight span. So the
 *  toggle's inner heading is rewritten to the standalone heading's tag and
 *  attributes while keeping the summary's own inline markup, and the standalone
 *  heading is dropped — leaving ONE collapsible, highlighted, anchored heading.
 */
export function mergeRedundantToggleHeadings(html: string): string {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  let merged = 0;
  for (const heading of [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6")]) {
    const details = heading.nextElementSibling;
    if (!details || details.tagName !== "DETAILS") continue;
    const inner = details.querySelector(":scope > summary")
      ?.querySelector("h1,h2,h3,h4,h5,h6");
    if (!inner || !norm(heading.textContent)) continue;
    if (norm(heading.textContent) !== norm(inner.textContent)) continue;
    const replacement = doc.createElement(heading.tagName);
    for (const attr of [...heading.attributes]) {
      replacement.setAttribute(attr.name, attr.value);
    }
    replacement.innerHTML = inner.innerHTML;   // keeps the highlight span
    inner.replaceWith(replacement);
    heading.remove();
    merged++;
  }
  if (merged) {
    console.warn(
      `mergeRedundantToggleHeadings: folded ${merged} heading(s) into the ` +
        `toggle that repeated them verbatim.`
    );
  }
  return doc.body.innerHTML;
}
