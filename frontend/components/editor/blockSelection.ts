// Notion's block selection: a block is something you can select as a whole, not
// only text you can put a caret in.
//
// Notion has two selection modes and moves between them with the keyboard:
//
//   text mode  ── Esc ──────────────▶ block mode (the block(s) the caret/text is in)
//   text mode  ── Ctrl+A ───────────▶ all text of the current block
//              ── Ctrl+A again ─────▶ block mode, every block on the page
//   block mode ── Ctrl+A ───────────▶ every block on the page
//   block mode ── Esc ──────────────▶ nothing selected
//   block mode ── Enter ────────────▶ text mode, caret at the end of the block
//   block mode ── ↑ / ↓ ────────────▶ the previous / next block
//   block mode ── Shift+↑ / Shift+↓ ▶ grow or shrink the selection by a block
//   block mode ── Backspace / Del ──▶ delete the blocks
//   block mode ── Ctrl+C / Ctrl+X ──▶ copy / cut the blocks (whole blocks, children too)
//   block mode ── Ctrl+D ───────────▶ duplicate
//   block mode ── Tab / Shift+Tab ──▶ indent / outdent
//   block mode ── Ctrl+Shift+↑ / ↓ ─▶ move the blocks up / down
//   block mode ── typing ───────────▶ nothing (a block selection is never overwritten)
//   drag from the page margin ──────▶ box-select the blocks the rectangle touches
//   click ⋮⋮ ───────────────────────▶ that block (blockSelectionExtension.ts)
//   Shift+click in block mode ──────▶ extend the selection to the clicked block
//
// This is built as a real ProseMirror Selection subclass (like prosemirror-tables'
// CellSelection), not as a highlight painted on top of a text selection: the
// selection IS the blocks. Undo/redo, copy, cut, drag and the editor's own
// "what is selected" all see whole blocks, and the browser's text highlight and
// caret are hidden while it is active (`visible = false`).
//
// The selected range is always a run of sibling blocks inside one container (a
// block's children, a column, or the page). When the two ends of a selection sit
// at different depths, the run is lifted to the level where they meet, so
// selecting from a child into the next top-level block selects the child's whole
// parent — the same thing Notion does. A selected parent carries its children.
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  NodeSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from "prosemirror-model";
import type { Mappable } from "prosemirror-transform";

// ── document helpers ─────────────────────────────────────────────────────────

/** A node the user can select as a block: BlockNote's blockContainer, or a
 *  multi-column columnList (the columns inside it are not blocks of their own). */
export function isBlockNode(node: PMNode | null | undefined): node is PMNode {
  return !!node && node.type.isInGroup("blockGroupChild");
}

/** A node whose children are blocks: a blockGroup (the page, or a block's
 *  children) or a column. */
function isContainer(node: PMNode): boolean {
  return node.type.name === "blockGroup" || node.type.name === "column";
}

/** Position just before the innermost block that contains `pos`, or null. A
 *  position between two blocks belongs to the block after it. */
export function blockPosAt(doc: PMNode, pos: number): number | null {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    if (isBlockNode($pos.node(d))) return $pos.before(d);
  }
  if (isBlockNode($pos.nodeAfter)) return pos;
  if (isBlockNode($pos.nodeBefore)) return pos - $pos.nodeBefore!.nodeSize;
  return null;
}

/** Every block in document order, as positions just before each one. */
export function allBlockPositions(doc: PMNode): number[] {
  const out: number[] = [];
  doc.descendants((node, pos) => {
    if (isBlockNode(node)) out.push(pos);
    // blockContent nodes hold inline content or table rows, never blocks.
    return !node.type.isInGroup("blockContent");
  });
  return out;
}

export interface BlockRange {
  /** Just before the first selected block. */
  from: number;
  /** Just after the last selected block. */
  to: number;
}

/** [start, end) of the ancestor at depth `depth + 1` of the block at `$block`
 *  (`$block` resolved just before a block). */
function spanAtDepth($block: ResolvedPos, depth: number): [number, number] {
  if ($block.depth === depth) return [$block.pos, $block.pos + $block.nodeAfter!.nodeSize];
  return [$block.before(depth + 1), $block.after(depth + 1)];
}

/** The run of sibling blocks that covers both blocks (positions just before
 *  each), lifted to the container both live in. */
export function rangeBetween(doc: PMNode, a: number, b: number): BlockRange {
  const $a = doc.resolve(a);
  const $b = doc.resolve(b);
  let depth = Math.min($a.sharedDepth(b), $a.depth, $b.depth);
  while (depth > 0 && !isContainer($a.node(depth))) depth--;
  const [aFrom, aTo] = spanAtDepth($a, depth);
  const [bFrom, bTo] = spanAtDepth($b, depth);
  return { from: Math.min(aFrom, bFrom), to: Math.max(aTo, bTo) };
}

/** The blocks directly inside a range (not their children), with positions. */
function topBlocks(doc: PMNode, from: number, to: number): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  let pos = from;
  while (pos < to) {
    const node = doc.resolve(pos).nodeAfter;
    if (!node) break;
    out.push({ node, pos });
    pos += node.nodeSize;
  }
  return out;
}

function isValidRange(doc: PMNode, from: number, to: number): boolean {
  if (from >= to || from < 0 || to > doc.content.size) return false;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if ($from.depth !== $to.depth || $from.parent !== $to.parent) return false;
  if (!isContainer($from.parent)) return false;
  return isBlockNode($from.nodeAfter) && isBlockNode($to.nodeBefore);
}

// ── the selection ────────────────────────────────────────────────────────────

/**
 * A selection of whole blocks. `$anchor`/`$head` sit between blocks (just
 * before the first, just after the last). `anchorBlock`/`headBlock` remember
 * which blocks the user started from and moved to — they can be deeper than
 * the selected run (a child whose parent got lifted in) and drive Shift+↑/↓.
 */
export class BlockSelection extends Selection {
  readonly anchorBlock: number;
  readonly headBlock: number;

  constructor($anchor: ResolvedPos, $head: ResolvedPos, anchorBlock?: number, headBlock?: number) {
    super($anchor, $head);
    const forward = $anchor.pos <= $head.pos;
    this.anchorBlock = anchorBlock ?? (forward ? $anchor.pos : lastTopBlock($anchor.doc, $head.pos, $anchor.pos));
    this.headBlock = headBlock ?? (forward ? lastTopBlock($anchor.doc, $anchor.pos, $head.pos) : $head.pos);
  }

  /** Selects the run covering blocks `anchorBlock` and `headBlock` (positions
   *  just before each; they may be at different depths). */
  static between(doc: PMNode, anchorBlock: number, headBlock: number): BlockSelection {
    const { from, to } = rangeBetween(doc, anchorBlock, headBlock);
    // ProseMirror's anchor/head always run forward: BlockNote reads
    // `selection.anchor` as "the block with the caret", so it must sit just
    // before a block. Which end the user is moving lives in headBlock.
    return new BlockSelection(doc.resolve(from), doc.resolve(to), anchorBlock, headBlock);
  }

  /** One block (position just before it). */
  static single(doc: PMNode, block: number): BlockSelection {
    return BlockSelection.between(doc, block, block);
  }

  /** Every block on the page. */
  static all(doc: PMNode): BlockSelection {
    const group = doc.firstChild!;
    const from = 1;
    const to = 1 + group.content.size;
    return new BlockSelection(doc.resolve(from), doc.resolve(to), from, lastTopBlock(doc, from, to));
  }

  /** The selected blocks (top level of the run; children come with them). */
  blocks(): { node: PMNode; pos: number }[] {
    return topBlocks(this.$from.doc, this.from, this.to);
  }

  content(): Slice {
    return new Slice(Fragment.from(this.blocks().map((b) => b.node)), 0, 0);
  }

  /** ProseMirror's generic "replace the selection" (a plain-text paste, a
   *  command written for text): an empty replacement deletes the blocks; any
   *  content goes in after them, so selected blocks are never overwritten. */
  replace(tr: Transaction, content: Slice = Slice.empty): void {
    if (content.size === 0) {
      deleteBlockRange(tr, this.from, this.to);
      return;
    }
    tr.replaceRange(this.to, this.to, content);
  }

  eq(other: Selection): boolean {
    return other instanceof BlockSelection
      && other.anchor === this.anchor && other.head === this.head
      && other.anchorBlock === this.anchorBlock && other.headBlock === this.headBlock;
  }

  map(doc: PMNode, mapping: Mappable): Selection {
    // Map the first and last selected BLOCKS, not the boundary positions:
    // ProseMirror steps often rewrite the token right after a block (BlockNote's
    // trailing paragraph is inserted by replacing the closing token of the block
    // before it), which would drag a boundary position into the next block.
    const blocks = this.blocks();
    const fallback = () => Selection.near(doc.resolve(Math.min(mapping.map(this.from), doc.content.size)), -1);
    if (!blocks.length) return fallback();
    const first = mapping.mapResult(blocks[0].pos, 1);
    const last = mapping.mapResult(blocks[blocks.length - 1].pos, 1);
    if (first.deletedAfter || last.deletedAfter) return fallback();
    const lastNode = doc.resolve(last.pos).nodeAfter;
    if (!isBlockNode(lastNode)) return fallback();
    const from = first.pos;
    const to = last.pos + lastNode.nodeSize;
    // Still a run of sibling blocks: still a block selection. Anything else
    // (its blocks deleted, its container split) falls back to a caret nearby.
    if (!isValidRange(doc, from, to)) return fallback();
    const aBlock = mapping.map(this.anchorBlock, 1);
    const hBlock = mapping.map(this.headBlock, 1);
    const inside = (p: number) => p >= from && p < to && isBlockNode(doc.resolve(p).nodeAfter);
    return new BlockSelection(
      doc.resolve(from),
      doc.resolve(to),
      inside(aBlock) ? aBlock : undefined,
      inside(hBlock) ? hBlock : undefined,
    );
  }

  toJSON() {
    return {
      type: "notion-block",
      anchor: this.anchor,
      head: this.head,
      anchorBlock: this.anchorBlock,
      headBlock: this.headBlock,
    };
  }

  static fromJSON(doc: PMNode, json: { anchor: number; head: number; anchorBlock?: number; headBlock?: number }) {
    return new BlockSelection(doc.resolve(json.anchor), doc.resolve(json.head), json.anchorBlock, json.headBlock);
  }
}
// The browser's own highlight and the caret are hidden; the blocks are painted
// by the plugin's decorations instead. ProseMirror reads this off the prototype.
(BlockSelection.prototype as { visible: boolean }).visible = false;
Selection.jsonID("notion-block", BlockSelection);

function lastTopBlock(doc: PMNode, from: number, to: number): number {
  const blocks = topBlocks(doc, Math.min(from, to), Math.max(from, to));
  return blocks.length ? blocks[blocks.length - 1].pos : Math.min(from, to);
}

export function isBlockSelection(sel: Selection | null | undefined): sel is BlockSelection {
  return sel instanceof BlockSelection;
}

// ── commands ─────────────────────────────────────────────────────────────────

type Dispatch = (tr: Transaction) => void;

/** Deletes a run of blocks, keeping the document valid: a container that would
 *  be left empty either goes with them (a block's children) or keeps one empty
 *  paragraph (the page, or a column). */
function deleteBlockRange(tr: Transaction, from: number, to: number): void {
  const $from = tr.doc.resolve(from);
  const container = $from.parent;
  const coversAll = from === $from.start() && to === $from.end();
  if (!coversAll) {
    tr.delete(from, to);
    return;
  }
  if (container.type.name === "blockGroup" && $from.depth > 1) {
    // A nested group: drop the group with its last children.
    tr.delete($from.before(), $from.after());
    return;
  }
  const { schema } = tr.doc.type;
  const empty = schema.nodes.blockContainer.create(null, schema.nodes.paragraph.create());
  tr.replaceWith(from, to, empty);
}

/** Puts the caret at the end of a block's own text, or selects the block's
 *  content node when it has no text (an image, a divider). */
function caretAtEndOf(tr: Transaction, blockPos: number): void {
  const block = tr.doc.resolve(blockPos).nodeAfter;
  const content = block?.firstChild;
  if (!block || !content) return;
  const contentPos = blockPos + 1;
  if (content.inlineContent) {
    tr.setSelection(TextSelection.create(tr.doc, contentPos + content.nodeSize - 1));
  } else if (content.type.isInGroup("blockContent") && content.isAtom) {
    tr.setSelection(NodeSelection.create(tr.doc, contentPos));
  } else {
    tr.setSelection(Selection.near(tr.doc.resolve(contentPos + content.nodeSize - 1), -1));
  }
}

/** Blocks a reader can see: not inside a closed toggle. */
function isShown(view: EditorView | undefined, pos: number): boolean {
  if (!view) return true;
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return true;
  let el: HTMLElement | null = dom.parentElement;
  while (el && el !== view.dom) {
    if (el.classList.contains("bn-block")
      && el.querySelector(
        ':scope > .bn-block-content .bn-toggle-wrapper[data-show-children="false"], '
        + ':scope > .react-renderer > .bn-block-content .bn-toggle-wrapper[data-show-children="false"]',
      )) {
      return false;
    }
    el = el.parentElement;
  }
  return true;
}

function shownBlocks(state: EditorState, view?: EditorView): number[] {
  return allBlockPositions(state.doc).filter((p) => isShown(view, p));
}

export function selectBlock(state: EditorState, dispatch: Dispatch, blockPos: number): boolean {
  dispatch(state.tr.setSelection(BlockSelection.single(state.doc, blockPos)).scrollIntoView());
  return true;
}

export function selectAllBlocks(state: EditorState, dispatch: Dispatch): boolean {
  dispatch(state.tr.setSelection(BlockSelection.all(state.doc)));
  return true;
}

/** Esc in text: select the block(s) the selection is in. */
export function selectBlocksOfSelection(state: EditorState, dispatch: Dispatch): boolean {
  const { selection, doc } = state;
  const a = blockPosAt(doc, selection.from);
  const b = blockPosAt(doc, selection.empty ? selection.from : Math.max(selection.from, selection.to - 1));
  if (a == null || b == null) return false;
  const anchorFirst = selection.anchor <= selection.head || selection.empty;
  dispatch(state.tr.setSelection(
    anchorFirst ? BlockSelection.between(doc, a, b) : BlockSelection.between(doc, b, a),
  ));
  return true;
}

/** Ctrl+A: the block's text first; the whole page when that is already selected
 *  (or there is no text to select). */
export function selectAllProgressive(state: EditorState, dispatch: Dispatch): boolean {
  const { selection } = state;
  if (isBlockSelection(selection)) return selectAllBlocks(state, dispatch);
  const { $from, $to } = selection;
  if (selection instanceof TextSelection && $from.parent.inlineContent && $from.sameParent($to)) {
    const start = $from.start();
    const end = $from.end();
    if (end > start && (selection.from !== start || selection.to !== end)) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
      return true;
    }
  }
  return selectAllBlocks(state, dispatch);
}

/** ↑/↓ in block mode: select the previous/next block a reader can see. */
export function moveBlockSelection(
  state: EditorState, dispatch: Dispatch, dir: -1 | 1, extend: boolean, view?: EditorView,
): boolean {
  const sel = state.selection;
  if (!isBlockSelection(sel)) return false;
  const shown = shownBlocks(state, view);
  const { doc } = state;
  let next: number | undefined;
  if (!extend) {
    next = dir > 0
      ? shown.find((p) => p > sel.headBlock)
      : [...shown].reverse().find((p) => p < sel.headBlock);
    if (next == null) return true; // at the edge: stay put
    dispatch(state.tr.setSelection(BlockSelection.single(doc, next)).scrollIntoView());
    return true;
  }
  const growing = dir > 0 ? sel.headBlock >= sel.anchorBlock : sel.headBlock <= sel.anchorBlock;
  if (dir > 0) {
    // Growing: the first block after the selected run. Shrinking: the block
    // after the head block and everything inside it.
    const headEnd = sel.headBlock + doc.resolve(sel.headBlock).nodeAfter!.nodeSize;
    next = shown.find((p) => p >= (growing ? sel.to : headEnd));
  } else {
    next = [...shown].reverse().find((p) => p < (growing ? sel.from : sel.headBlock));
  }
  if (next == null) return true;
  dispatch(state.tr.setSelection(BlockSelection.between(doc, sel.anchorBlock, next)).scrollIntoView());
  return true;
}

/** Backspace/Delete in block mode. The caret lands at the end of the block
 *  before the deleted ones (or the start of the one after). */
export function deleteSelectedBlocks(state: EditorState, dispatch: Dispatch): boolean {
  const sel = state.selection;
  if (!isBlockSelection(sel)) return false;
  const tr = state.tr;
  const before = shownBlocks(state).filter((p) => p < sel.from).pop();
  deleteBlockRange(tr, sel.from, sel.to);
  if (before != null) {
    caretAtEndOf(tr, tr.mapping.map(before, -1));
  } else {
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.mapping.map(sel.from), tr.doc.content.size)), 1));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

/** Enter in block mode: back to text, caret at the end of the head block. */
export function editSelectedBlock(state: EditorState, dispatch: Dispatch): boolean {
  const sel = state.selection;
  if (!isBlockSelection(sel)) return false;
  const tr = state.tr;
  caretAtEndOf(tr, sel.headBlock);
  dispatch(tr.scrollIntoView());
  return true;
}

/** Moves the selected run to `insertAt(trAfterDelete)` and reselects it. */
function relocate(
  state: EditorState,
  dispatch: Dispatch,
  build: (tr: Transaction, sel: BlockSelection, slice: Fragment) => number | null,
): boolean {
  const sel = state.selection;
  if (!isBlockSelection(sel)) return false;
  const tr = state.tr;
  const content = Fragment.from(sel.blocks().map((b) => b.node));
  const newFrom = build(tr, sel, content);
  if (newFrom == null) return true; // nowhere to go: keep the selection
  const shift = (p: number) => newFrom + (p - sel.from);
  const size = sel.to - sel.from;
  tr.setSelection(new BlockSelection(
    tr.doc.resolve(newFrom),
    tr.doc.resolve(newFrom + size),
    shift(sel.anchorBlock),
    shift(sel.headBlock),
  ));
  dispatch(tr.scrollIntoView());
  return true;
}

/** Ctrl+Shift+↑/↓: swap the run with the sibling before/after it. */
export function moveSelectedBlocks(state: EditorState, dispatch: Dispatch, dir: -1 | 1): boolean {
  return relocate(state, dispatch, (tr, sel, content) => {
    if (dir < 0) {
      const prev = sel.$from.nodeBefore;
      if (!isBlockNode(prev)) return null;
      tr.delete(sel.from, sel.to);
      const at = sel.from - prev.nodeSize;
      tr.insert(at, content);
      return at;
    }
    const next = sel.$to.nodeAfter;
    if (!isBlockNode(next)) return null;
    tr.delete(sel.from, sel.to);
    const at = sel.from + next.nodeSize;
    tr.insert(at, content);
    return at;
  });
}

/** Tab: the run becomes the last children of the block before it. */
export function indentSelectedBlocks(state: EditorState, dispatch: Dispatch): boolean {
  return relocate(state, dispatch, (tr, sel, content) => {
    const prev = sel.$from.nodeBefore;
    if (!prev || prev.type.name !== "blockContainer") return null;
    tr.delete(sel.from, sel.to);
    const prevContentEnd = sel.from - 1; // inside prev, after its last child node
    if (prev.lastChild?.type.name === "blockGroup") {
      const at = prevContentEnd - 1; // inside that group, after its last block
      tr.insert(at, content);
      return at;
    }
    const { schema } = tr.doc.type;
    tr.insert(prevContentEnd, schema.nodes.blockGroup.create(null, content));
    return prevContentEnd + 1;
  });
}

/** Shift+Tab: the run moves out of its parent, right after it. Blocks after
 *  the run stay with the parent. */
export function outdentSelectedBlocks(state: EditorState, dispatch: Dispatch): boolean {
  return relocate(state, dispatch, (tr, sel, content) => {
    const $from = sel.$from;
    const groupDepth = $from.depth;
    if ($from.parent.type.name !== "blockGroup" || groupDepth < 2) return null;
    const parentDepth = groupDepth - 1;
    if ($from.node(parentDepth).type.name !== "blockContainer") return null;
    const parentAfter = $from.after(parentDepth);
    deleteBlockRange(tr, sel.from, sel.to);
    const at = tr.mapping.map(parentAfter, -1);
    tr.insert(at, content);
    return at;
  });
}

// ── the plugin ───────────────────────────────────────────────────────────────

export const blockSelectionKey = new PluginKey("notionBlockSelection");

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export interface BlockSelectionOptions {
  /** True while a menu that owns Esc is open (slash menu, emoji picker…). */
  menuOpen?: () => boolean;
  /** Ctrl+C / Ctrl+X: writes the selection to the clipboard. Defaults to
   *  ProseMirror's own serializer. */
  writeClipboard?: (view: EditorView, event: ClipboardEvent) => void;
  /** Ctrl+D: duplicates the selection; returns true when it did. */
  duplicate?: (view: EditorView) => boolean;
  /** Esc with a block selection: clears it and leaves the editor. */
  blur?: (view: EditorView) => void;
}

/** Elements a box-select drag must not start from. */
const NO_BOX_START =
  ".bn-block-content, input, textarea, select, button, a, [role='button'], [role='menu'], "
  + "[contenteditable='false'], .bn-side-menu, .bn-formatting-toolbar, .bn-suggestion-menu, "
  + ".mantine-Menu-dropdown, .bn-table-handle";

export function blockSelectionPlugin(opts: BlockSelectionOptions = {}): Plugin {
  const modKey = (e: KeyboardEvent) => (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
  // While blocks are selected, the browser's own selection is a hidden
  // placeholder. Browsers move it by themselves (focus changes, window
  // switches, screenshots collapse it to the first block), and ProseMirror
  // would read that back as a text selection — silently leaving block mode, so
  // the next key typed would replace text. Keys never move it (handleKeyDown
  // owns them in block mode), so only a press with the pointer is the user
  // choosing a new selection; everything else keeps the blocks selected
  // (prosemirror-tables guards its CellSelection the same way).
  let pointerDown = false;
  const release = () => { window.setTimeout(() => { pointerDown = false; }, 0); };

  return new Plugin({
    key: blockSelectionKey,

    props: {
      createSelectionBetween(view) {
        const sel = view.state.selection;
        return isBlockSelection(sel) && !pointerDown ? sel : null;
      },

      decorations(state) {
        const sel = state.selection;
        if (!isBlockSelection(sel)) return null;
        return DecorationSet.create(
          state.doc,
          sel.blocks().map(({ node, pos }) =>
            Decoration.node(pos, pos + node.nodeSize, { class: "sb-block-selected" })),
        );
      },

      handleKeyDown(view, event) {
        if (event.isComposing || event.defaultPrevented) return false;
        const { state } = view;
        const sel = state.selection;
        const mod = modKey(event);
        const key = event.key;

        // ── text mode ──
        if (!isBlockSelection(sel)) {
          if (key === "Escape" && !mod && !event.shiftKey && !event.altKey) {
            if (opts.menuOpen?.()) return false;
            return selectBlocksOfSelection(state, view.dispatch);
          }
          if (mod && !event.shiftKey && !event.altKey && key.toLowerCase() === "a") {
            if (opts.menuOpen?.()) return false;
            return selectAllProgressive(state, view.dispatch);
          }
          return false;
        }

        // ── block mode ──
        if (mod && !event.altKey) {
          const k = key.toLowerCase();
          if (k === "a" && !event.shiftKey) return selectAllBlocks(state, view.dispatch);
          if (k === "d" && !event.shiftKey) {
            event.preventDefault(); // the browser's bookmark shortcut
            return opts.duplicate ? opts.duplicate(view) : true;
          }
          if (event.shiftKey && key === "ArrowUp") return moveSelectedBlocks(state, view.dispatch, -1);
          if (event.shiftKey && key === "ArrowDown") return moveSelectedBlocks(state, view.dispatch, 1);
          // Undo, redo, copy, cut, paste and app shortcuts go through.
          return false;
        }
        switch (key) {
          case "Escape":
            clearBlockSelection(view);
            opts.blur ? opts.blur(view) : (view.dom as HTMLElement).blur();
            return true;
          case "Enter":
            if (event.shiftKey || event.altKey) return true;
            return editSelectedBlock(state, view.dispatch);
          case "ArrowUp":
            return moveBlockSelection(state, view.dispatch, -1, event.shiftKey, view);
          case "ArrowDown":
            return moveBlockSelection(state, view.dispatch, 1, event.shiftKey, view);
          case "ArrowLeft":
          case "ArrowRight":
            return true;
          case "Backspace":
          case "Delete":
            return deleteSelectedBlocks(state, view.dispatch);
          case "Tab":
            return event.shiftKey
              ? outdentSelectedBlocks(state, view.dispatch)
              : indentSelectedBlocks(state, view.dispatch);
          default:
            // A block selection is never overwritten by typing.
            return key.length === 1 && !event.altKey;
        }
      },

      handleTextInput(view) {
        return isBlockSelection(view.state.selection);
      },

      handleDOMEvents: {
        copy(view, event) {
          if (!isBlockSelection(view.state.selection)) return false;
          writeClipboard(view, event, opts);
          return true;
        },
        cut(view, event) {
          if (!isBlockSelection(view.state.selection)) return false;
          writeClipboard(view, event, opts);
          if (view.editable) deleteSelectedBlocks(view.state, view.dispatch);
          return true;
        },
        mousedown(view, event) {
          const sel = view.state.selection;
          if (!isBlockSelection(sel)) return false;
          if (!event.shiftKey) {
            pointerDown = true;
            document.addEventListener("mouseup", release, { once: true, capture: true });
            return false;
          }
          // Shift+click extends a block selection to the clicked block.
          if (event.button !== 0) return false;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!at) return false;
          const block = blockPosAt(view.state.doc, at.inside >= 0 ? at.inside : at.pos);
          if (block == null) return false;
          event.preventDefault();
          view.dispatch(view.state.tr.setSelection(BlockSelection.between(view.state.doc, sel.anchorBlock, block)));
          return true;
        },
        dragstart(view, event) {
          // Dragging one handle of a multi-block selection drags them all.
          // BlockNote's side menu does that for its own MultipleNodeSelection,
          // which it creates from the registered JSON id.
          const sel = view.state.selection;
          if (!isBlockSelection(sel)) return false;
          const target = event.target as HTMLElement | null;
          if (!target?.closest?.(".bn-side-menu")) return false;
          try {
            view.dispatch(view.state.tr.setSelection(
              Selection.fromJSON(view.state.doc, { type: "multiple-node", anchor: sel.from, head: sel.to }),
            ));
          } catch { /* no multiple-node selection registered: drag one block */ }
          return false;
        },
      },
    },

    view(view) {
      return new BoxSelect(view);
    },
  });
}

/** Ends block mode without selecting anything else visible. */
export function clearBlockSelection(view: EditorView): void {
  const sel = view.state.selection;
  if (!isBlockSelection(sel)) return;
  const pos = Math.min(sel.from, view.state.doc.content.size);
  view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos), 1)));
}

function writeClipboard(view: EditorView, event: ClipboardEvent, opts: BlockSelectionOptions): void {
  event.preventDefault();
  if (opts.writeClipboard) {
    opts.writeClipboard(view, event);
    return;
  }
  const slice = view.state.selection.content();
  const { dom, text } = view.serializeForClipboard(slice);
  event.clipboardData?.clearData();
  event.clipboardData?.setData("text/html", dom.innerHTML);
  event.clipboardData?.setData("text/plain", text);
}

// ── box select (drag from the page margin) ───────────────────────────────────

const DRAG_THRESHOLD = 5;

/** Notion's rubber band: press in the empty space around the blocks and drag;
 *  every block the rectangle touches is selected. Lives on the document so it
 *  starts from the page's side margins too, not only inside the editor. */
class BoxSelect {
  private start: {
    x: number; y: number; scrollY: number; scroller: HTMLElement | null;
  } | null = null;
  private box: HTMLDivElement | null = null;
  private active = false;
  private lastY = 0;
  private lastX = 0;
  private scrollTimer: number | null = null;

  constructor(private view: EditorView) {
    document.addEventListener("mousedown", this.onDown, true);
  }

  destroy() {
    document.removeEventListener("mousedown", this.onDown, true);
    this.stop();
  }

  private page(): HTMLElement | null {
    return (this.view.dom as HTMLElement).closest(".notion-page") as HTMLElement | null
      ?? (this.view.dom as HTMLElement).parentElement;
  }

  private onDown = (e: MouseEvent) => {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    const page = this.page();
    if (!target || !page || !page.contains(target)) return;
    if (target.closest(NO_BOX_START)) return;
    // Notion starts the box only from the page around the text column: a press
    // inside the column (even in the gap between two blocks) is ProseMirror's,
    // and a drag from there selects text.
    if ((this.view.dom as HTMLElement).contains(target)) return;
    if (!this.view.editable) return;
    // Below the top of the editor only: the title, icon and properties above
    // it are not blocks.
    const editorRect = (this.view.dom as HTMLElement).getBoundingClientRect();
    if (e.clientY < editorRect.top) return;
    const scroller = scrollParent(this.view.dom as HTMLElement);
    this.start = { x: e.clientX, y: e.clientY, scrollY: scroller?.scrollTop ?? 0, scroller };
    this.active = false;
    // No native text selection from the margin.
    e.preventDefault();
    document.addEventListener("mousemove", this.onMove, true);
    document.addEventListener("mouseup", this.onUp, true);
  };

  private onMove = (e: MouseEvent) => {
    if (!this.start) return;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (!this.active) {
      if (Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) < DRAG_THRESHOLD) return;
      this.active = true;
      window.getSelection()?.removeAllRanges();
      this.box = document.createElement("div");
      this.box.className = "sb-block-box";
      document.body.appendChild(this.box);
      this.scrollTimer = window.setInterval(this.autoScroll, 30);
    }
    e.preventDefault();
    this.refresh();
  };

  private onUp = (e: MouseEvent) => {
    const wasActive = this.active;
    this.stop();
    if (wasActive) {
      e.preventDefault();
      return;
    }
    // A click on the empty page clears a block selection.
    if (isBlockSelection(this.view.state.selection)) {
      clearBlockSelection(this.view);
      (this.view.dom as HTMLElement).blur();
    }
  };

  private stop() {
    document.removeEventListener("mousemove", this.onMove, true);
    document.removeEventListener("mouseup", this.onUp, true);
    if (this.scrollTimer != null) window.clearInterval(this.scrollTimer);
    this.scrollTimer = null;
    this.box?.remove();
    this.box = null;
    this.start = null;
    this.active = false;
  }

  private autoScroll = () => {
    const s = this.start?.scroller;
    if (!s) return;
    const r = s.getBoundingClientRect();
    const edge = 40;
    let dy = 0;
    if (this.lastY < r.top + edge) dy = -Math.ceil((r.top + edge - this.lastY) / 3);
    else if (this.lastY > r.bottom - edge) dy = Math.ceil((this.lastY - (r.bottom - edge)) / 3);
    if (dy) {
      s.scrollTop += dy;
      this.refresh();
    }
  };

  private refresh() {
    if (!this.start || !this.box) return;
    const scrolled = (this.start.scroller?.scrollTop ?? 0) - this.start.scrollY;
    const x1 = Math.min(this.start.x, this.lastX);
    const x2 = Math.max(this.start.x, this.lastX);
    const y1 = Math.min(this.start.y - scrolled, this.lastY);
    const y2 = Math.max(this.start.y - scrolled, this.lastY);
    Object.assign(this.box.style, {
      left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px`,
    });

    const { state } = this.view;
    const hits: number[] = [];
    for (const pos of shownBlocks(state, this.view)) {
      const rect = ownRect(this.view, pos);
      if (!rect) continue;
      if (rect.bottom >= y1 && rect.top <= y2 && rect.right >= x1 && rect.left <= x2) hits.push(pos);
    }
    const current = state.selection;
    if (!hits.length) {
      if (isBlockSelection(current)) {
        this.view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(current.from))));
      }
      return;
    }
    const downward = this.lastY >= this.start.y - scrolled;
    const first = hits[0];
    const last = hits[hits.length - 1];
    const next = downward ? BlockSelection.between(state.doc, first, last) : BlockSelection.between(state.doc, last, first);
    if (!current.eq(next)) {
      this.view.dispatch(state.tr.setSelection(next));
      if (!this.view.hasFocus()) this.view.focus();
    }
  }
}

/** The box of a block's own line(s), without its children. */
function ownRect(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const own = dom.querySelector(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer")
    ?? dom.querySelector(":scope > .bn-block-column-list, :scope > .bn-block")
    ?? dom;
  const r = (own as HTMLElement).getBoundingClientRect();
  return r.width || r.height ? r : null;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}
