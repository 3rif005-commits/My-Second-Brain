// Registers Notion's block selection (blockSelection.ts) with the BlockNote editor.
//
// Its keys run BEFORE BlockNote's own (priority 1000 vs BlockNote's ~100): Esc
// in text must select the block rather than blur the editor (BlockNote's
// "OverrideEscape"), and Ctrl+A must select the block's text before the page
// (tiptap's select-all). Copy/cut also run before BlockNote's clipboard plugin,
// whose "is anything selected?" check reads the browser selection, which a block
// selection hides.
import { createExtension, selectedFragmentToHTML } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { Extension as TiptapExtension } from "@tiptap/core";
import type { EditorView } from "prosemirror-view";
import { BlockSelection, blockSelectionPlugin, isBlockSelection } from "./blockSelection";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

/** A copy of a block that BlockNote will give fresh ids. */
export function withoutIds(block: AnyBlock): AnyBlock {
  const { id: _id, children, ...rest } = block; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, children: (children ?? []).map(withoutIds) };
}

/** The ids of the blocks a block selection covers (top level of the run), or
 *  [] when the editor is not in block mode. */
export function selectedBlockIds(editor: AnyEditor): string[] {
  const sel = editor.prosemirrorState?.selection;
  if (!isBlockSelection(sel)) return [];
  return sel.blocks().map((b) => b.node.attrs.id as string).filter(Boolean);
}

/** Position just before the block with this id. */
function posOfBlock(editor: AnyEditor, id: string): number | null {
  let found: number | null = null;
  editor.prosemirrorState.doc.descendants((node: AnyBlock, pos: number) => {
    if (found != null) return false;
    if (node.attrs?.id === id && node.type.isInGroup("blockGroupChild")) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/** Selects these blocks (they must be siblings, in order) as a block selection. */
export function selectBlocksById(editor: AnyEditor, ids: string[]): void {
  if (!ids.length) return;
  const first = posOfBlock(editor, ids[0]);
  const last = posOfBlock(editor, ids[ids.length - 1]);
  if (first == null || last == null) return;
  editor.transact((tr: AnyBlock) => tr.setSelection(BlockSelection.between(tr.doc, first, last)));
}

/** Ctrl+D / "Duplicate": copies of the selected blocks right after them, and
 *  the copies become the selection (Notion). */
export function duplicateSelectedBlocks(editor: AnyEditor): boolean {
  const ids = selectedBlockIds(editor);
  if (!ids.length) return false;
  const blocks = ids.map((id) => editor.getBlock(id)).filter(Boolean);
  const inserted = editor.insertBlocks(blocks.map(withoutIds), ids[ids.length - 1], "after") as AnyBlock[];
  selectBlocksById(editor, inserted.map((b) => b.id));
  return true;
}

export const NotionBlockSelection = createExtension(({ editor }: { editor: AnyEditor }) => ({
  key: "notionBlockSelection",
  mount() {
    // BlockNote's editor.getSelection() reads a selection's two ends as the
    // blocks AT those positions; a block selection's end sits after its last
    // block, so it would report one block too many (and warn "Position N is not
    // within a blockContainer node" at the end of the page). In block mode
    // the answer is simply the selected blocks — which is also what the AI
    // menu and anything else asking "what is selected?" should act on.
    const original = editor.getSelection.bind(editor);
    editor.getSelection = () => {
      const ids = selectedBlockIds(editor);
      if (!ids.length) return original();
      return { blocks: ids.map((id) => editor.getBlock(id)).filter(Boolean) };
    };
    return () => { editor.getSelection = original; };
  },
  tiptapExtensions: [
    TiptapExtension.create({
      name: "notionBlockSelection",
      priority: 1000,
      addProseMirrorPlugins: () => [
        blockSelectionPlugin({
          menuOpen: () => !!editor.getExtension(SuggestionMenu)?.shown(),
          writeClipboard: (view: EditorView, event: ClipboardEvent) => {
            const { clipboardHTML, externalHTML, markdown } = selectedFragmentToHTML(view, editor);
            event.clipboardData?.clearData();
            event.clipboardData?.setData("blocknote/html", clipboardHTML);
            event.clipboardData?.setData("text/html", externalHTML);
            event.clipboardData?.setData("text/plain", markdown);
          },
          duplicate: () => duplicateSelectedBlocks(editor),
          blur: () => editor.blur(),
        }),
      ],
    }),
  ],
}));
