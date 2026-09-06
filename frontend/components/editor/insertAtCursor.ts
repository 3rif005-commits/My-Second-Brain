type AnyBlockLike = { id: string; children?: AnyBlockLike[] };

/** Is `id` anywhere in the document — including inside a toggle or a callout? */
export function blockExists<T extends AnyBlockLike>(blocks: T[], id: string): boolean {
  return blocks.some(
    (b) => b.id === id
      || (Array.isArray(b.children) && blockExists(b.children as T[], id))
  );
}

/** Where a "send to note" insertion should land.
 *
 *  `remembered` is the block the user last put their cursor in, or null if they
 *  never focused the editor. Reading `getTextCursorPosition()` at send time is
 *  not an option: on an untouched editor it reports the FIRST block, so content
 *  would land at the top of the note — worse than appending.
 *
 *  Returns the block to insert after, or null to mean "append at the end"
 *  (which is also the empty-document case the caller handles separately).
 */
export function insertionTarget<T extends AnyBlockLike>(
  blocks: T[],
  remembered: string | null
): string | null {
  if (remembered && blockExists(blocks, remembered)) return remembered;
  return blocks.length ? blocks[blocks.length - 1].id : null;
}
