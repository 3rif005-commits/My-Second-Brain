// The app's own clipboard format: copy → paste inside the app is lossless,
// the way it is inside Notion.
//
// Notion does not rebuild a paste from the HTML it puts on the clipboard. Next
// to `text/html` it writes its block records as JSON
// (`text/_notion-blocks-v3-production` for whole blocks,
// `text/_notion-multi-text-production` for a text selection), and a paste into
// Notion reads that first — which is why a database, an image or a callout
// comes back as itself, with every property. HTML is only for other apps.
//
// This is the same mechanism for this app. On copy/cut we write the selected
// blocks, in the exact stored form a note saves (every type, prop and child:
// databases, images, callouts, interactive blocks, math, unknown blocks…) as
// JSON under APP_BLOCKS_MIME. On paste, when that type is there, the blocks are
// inserted as they are (with fresh ids) instead of being re-parsed from HTML.
// No per-block-type code: a new block type copies correctly the day it exists.
//
//   kind "blocks"  whole blocks (block selection, a selected image/embed)
//                  → pasted as blocks: after the selected blocks in block mode,
//                    in place of an empty line, or after the caret's block.
//   kind "text"    a text selection, cut at its ends like Notion's multi-text
//                  → the first piece joins the line at the caret, the rest
//                    follow as blocks under it.
//
// A database block copies as a reference to the same database (a second view
// of it on the page), as pasting a database block does in Notion; Duplicate is
// what makes copies.
import { NodeSelection, TextSelection, type Selection } from "prosemirror-state";
import type { Fragment, Node as PMNode, Schema } from "prosemirror-model";
// @ts-ignore — @blocknote/core@0.48.0's index.d.ts is incomplete (upstream); runtime export is fine
import { nodeToBlock } from "@blocknote/core";
import { blockPosAt, isBlockSelection } from "./blockSelection";
import { restoreUnknown } from "./unknownBlocks";
import { sanitizeBlocks } from "./noteSchema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any;

export const APP_BLOCKS_MIME = "text/x-second-brain-blocks";

export interface AppClipboard {
  v: 1;
  kind: "blocks" | "text";
  blocks: AnyBlock[];
}

/** The blocks a text slice covers, cut at its ends. A slice that starts
 *  inside a child brings its parent along without the parent's own line; only
 *  the children that were selected are kept. */
function collectBlocks(fragment: Fragment, out: PMNode[]): void {
  fragment.forEach((node) => {
    if (node.type.isInGroup("blockGroupChild")) {
      const own = node.firstChild;
      if (node.type.name === "blockContainer" && !own?.type.isInGroup("blockContent")) {
        if (node.lastChild) collectBlocks(node.lastChild.content, out);
      } else {
        out.push(node);
      }
    } else if (!node.isInline && !node.type.isInGroup("blockContent")) {
      collectBlocks(node.content, out); // blockGroup, column, doc
    }
  });
}

function toBlocks(nodes: PMNode[], schema: Schema): AnyBlock[] {
  const out: AnyBlock[] = [];
  for (const node of nodes) {
    try {
      out.push(nodeToBlock(node, schema));
    } catch { /* a fragment BlockNote can't read as a block: skipped */ }
  }
  // The stored form: placeholders for unknown types become their originals.
  return restoreUnknown(out);
}

/** What a copy of this selection puts on the app's clipboard, or null for a
 *  selection the app leaves to the browser (empty, or a table cell range). */
export function clipboardFromSelection(selection: Selection): AppClipboard | null {
  const doc = selection.$from.doc;
  const schema = doc.type.schema;
  if (isBlockSelection(selection)) {
    return { v: 1, kind: "blocks", blocks: toBlocks(selection.blocks().map((b) => b.node), schema) };
  }
  if (selection instanceof NodeSelection) {
    const pos = blockPosAt(doc, selection.from);
    const node = pos == null ? null : doc.nodeAt(pos);
    return node ? { v: 1, kind: "blocks", blocks: toBlocks([node], schema) } : null;
  }
  if (selection instanceof TextSelection && !selection.empty) {
    const nodes: PMNode[] = [];
    collectBlocks(selection.content().content, nodes);
    const blocks = toBlocks(nodes, schema);
    return blocks.length ? { v: 1, kind: "text", blocks } : null;
  }
  return null;
}

export function writeAppClipboard(data: DataTransfer | null | undefined, clip: AppClipboard): void {
  data?.setData(APP_BLOCKS_MIME, JSON.stringify(clip));
}

/** The app's clipboard, when this paste was copied from the app. Must be
 *  called while the paste event is being dispatched. */
export function readAppClipboard(data: DataTransfer | null | undefined): AppClipboard | null {
  const raw = data?.getData(APP_BLOCKS_MIME);
  if (!raw) return null;
  try {
    const clip = JSON.parse(raw);
    if (clip?.v === 1 && Array.isArray(clip.blocks) && clip.blocks.length) return clip as AppClipboard;
  } catch { /* not ours after all */ }
  return null;
}

/** A copy BlockNote will give fresh ids, all the way down. */
function fresh(block: AnyBlock): AnyBlock {
  const { id: _id, children, ...rest } = block; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, children: Array.isArray(children) ? children.map(fresh) : [] };
}

const isEmptyLine = (b: AnyBlock) =>
  b?.type === "paragraph" && Array.isArray(b.content) && b.content.length === 0 && !b.children?.length;

/** Pastes the app's clipboard into the editor. `afterIds`: the selected
 *  blocks in block mode (the paste goes after them), else empty. */
export function pasteAppClipboard(editor: AnyEditor, clip: AppClipboard, afterIds: string[] = []): boolean {
  const blocks = sanitizeBlocks(clip.blocks.map(fresh));
  if (!blocks.length) return false;
  let inserted: AnyBlock[] = [];

  editor.transact(() => {
    if (afterIds.length) {
      inserted = editor.insertBlocks(blocks, afterIds[afterIds.length - 1], "after");
      return;
    }
    const at = editor.getTextCursorPosition()?.block;
    if (!at) {
      inserted = editor.insertBlocks(blocks, editor.document[editor.document.length - 1], "after");
      return;
    }
    const [first, ...rest] = blocks;
    const inline = clip.kind === "text" && Array.isArray(first.content) && Array.isArray(at.content);
    if (inline) {
      // The first piece joins the line at the caret (replacing a selection).
      try {
        editor.insertInlineContent(first.content);
        if (rest.length) inserted = editor.insertBlocks(rest, at, "after");
        return;
      } catch { /* this line can't take that text (e.g. a code line and a mention): paste as blocks */ }
    }
    if (isEmptyLine(at)) {
      inserted = editor.replaceBlocks([at], blocks).insertedBlocks ?? [];
    } else {
      inserted = editor.insertBlocks(blocks, at, "after");
    }
  });

  // The caret lands at the end of what was pasted.
  const last = inserted[inserted.length - 1];
  if (last) {
    try { editor.setTextCursorPosition(last, "end"); } catch { /* a block without text */ }
  }
  return true;
}
