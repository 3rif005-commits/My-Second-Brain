/** The text of BlockNote blocks, children included — the same reading
 *  BlockEditor saves as content_text. Here so a page can tell an empty note
 *  without importing the (lazily loaded) editor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPlainText(blocks: any[]): string {
  return blocks
    .map((block) => {
      const inline = Array.isArray(block.content)
        ? block.content
            .map((c: { type: string; text?: string }) => (c.type === "text" ? c.text ?? "" : ""))
            .join("")
        : "";
      const childText = block.children?.length ? getPlainText(block.children) : "";
      return [inline, childText].filter(Boolean).join("\n");
    })
    .join("\n");
}
