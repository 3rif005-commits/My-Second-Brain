/** While an answer streams, its end is often a construct the model hasn't
 *  finished: a link whose URL is still arriving, or a formula without its
 *  closing delimiter. Rendered as is, those show as raw text —
 *  `[Weekly review](/brain/b15e…` or `[ \begin{aligned} \frac{…` — until the
 *  rest arrives (seen live on Nemotron, 2026-10-29). This cuts the unfinished
 *  construct off; it appears whole a moment later. Code fences are left alone:
 *  an open fence already renders as a code block. */
export function holdBackOpenTail(md: string): string {
  // inside an open code fence, nothing to do
  if ((md.match(/^```/gm) ?? []).length % 2 === 1) return md;

  let cut = md.length;
  // display math: an odd number of $$, or a \[ with no \] after it
  const dollars = [...md.matchAll(/\$\$/g)];
  if (dollars.length % 2 === 1) cut = Math.min(cut, dollars[dollars.length - 1].index!);
  const openDisplay = md.lastIndexOf("\\[");
  if (openDisplay >= 0 && md.indexOf("\\]", openDisplay) < 0) cut = Math.min(cut, openDisplay);
  const openInline = md.lastIndexOf("\\(");
  if (openInline >= 0 && md.indexOf("\\)", openInline) < 0) cut = Math.min(cut, openInline);

  // a link still arriving: `[text`, `[text]` at the very end, or `[text](url`
  const lastLine = md.slice(md.lastIndexOf("\n") + 1);
  const m = /\[[^\]\n]*(\](\([^)\s]*)?)?$/.exec(lastLine);
  if (m) {
    const done = /^\[\d{1,2}\]$/.test(m[0]); // a citation marker, already whole
    if (!done) cut = Math.min(cut, md.length - lastLine.length + m.index);
  }
  return md.slice(0, cut);
}
