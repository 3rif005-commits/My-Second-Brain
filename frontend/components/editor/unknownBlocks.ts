// Blocks whose type this editor's schema doesn't know — written by an older or
// newer version of the app, an import, or an agent tool — must survive a load
// and a save untouched. BlockNote can't hold a block of an unregistered type,
// so on load each one is swapped for an `unknownBlock` placeholder carrying the
// original as JSON, and every path that hands the document back to be stored
// swaps the original back in.
//
// Before this, sanitizeBlocks dropped them, and the next autosave persisted the
// loss (docs/notion-sync/DIVERGENCE_LEDGER.md, B3).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export const UNKNOWN_BLOCK_TYPE = "unknownBlock";

/** Replace every block whose type isn't in `known` with a placeholder holding
 *  it, children included. Null entries are dropped (they are not data). */
export function wrapUnknown(blocks: AnyBlock[], known: Set<string>): AnyBlock[] {
  return blocks
    .filter((b) => b != null)
    .map((b) => {
      if (!known.has(b?.type)) {
        return {
          ...(b?.id ? { id: b.id } : {}),
          type: UNKNOWN_BLOCK_TYPE,
          props: { original: JSON.stringify(b) },
          children: [],
        };
      }
      return { ...b, children: Array.isArray(b.children) ? wrapUnknown(b.children, known) : [] };
    });
}

/** The stored form: every placeholder replaced by the block it holds. A
 *  placeholder whose JSON can't be read is kept as it is, so nothing is lost. */
export function restoreUnknown(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((b) => {
    if (b?.type === UNKNOWN_BLOCK_TYPE) {
      try {
        const original = JSON.parse(b.props?.original ?? "");
        if (original && typeof original === "object") return original;
      } catch { /* keep the placeholder */ }
      return b;
    }
    return Array.isArray(b?.children) && b.children.length
      ? { ...b, children: restoreUnknown(b.children) }
      : b;
  });
}

/** The original block's type, for the placeholder's label. */
export function unknownTypeOf(original: string): string {
  try {
    const t = JSON.parse(original)?.type;
    return typeof t === "string" && t ? t : "unknown";
  } catch {
    return "unknown";
  }
}
