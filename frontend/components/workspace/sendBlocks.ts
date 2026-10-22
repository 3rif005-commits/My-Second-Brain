// Blocks for text sent from a source into the note. Text that knows its page (a PDF selection
// or text element) arrives as a quote followed by a page pill — the existing checkpoint block,
// so one click jumps back to where it came from (ArtCraft study item 5: "Send to note" and
// "Checkpoint" used to be two separate buttons).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export function textBlocks(
  text: string,
  page: number | undefined,
  ctx: { noteId: string; resourceId: string },
): AnyBlock[] {
  const paras = text.split("\n\n").map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return [];
  if (page === undefined || !Number.isFinite(page) || page < 1) {
    return paras.map((p) => ({ type: "paragraph", content: p }));
  }
  const pno = Math.round(page);
  return [
    ...paras.map((p) => ({ type: "quote", content: p })),
    {
      type: "checkpoint",
      props: {
        noteId: ctx.noteId, resourceId: ctx.resourceId,
        anchorType: "page", value: String(pno), label: `p. ${pno}`,
      },
    },
  ];
}

/** The 1-based PDF page a DOM node sits on (pages are `[data-page]` boxes), if any. */
export function pageOfNode(node: Node | null | undefined): number | undefined {
  const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
  const box = el?.closest?.("[data-page]") as HTMLElement | null | undefined;
  const n = Number(box?.dataset.page);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}
