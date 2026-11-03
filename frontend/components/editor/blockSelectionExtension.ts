// Registers Notion's block selection (blockSelection.ts) with the BlockNote editor.
//
// Its keys run BEFORE BlockNote's own (priority 1000 vs BlockNote's ~100): Esc
// in text must select the block rather than blur the editor (BlockNote's
// "OverrideEscape"), and Ctrl+A must select the block's text before the page
// (tiptap's select-all). Copy/cut also run before BlockNote's clipboard plugin,
// whose "is anything selected?" check reads the browser selection, which a block
// selection hides.
import { createExtension, selectedFragmentToHTML } from "@blocknote/core";
import { SideMenuExtension, SuggestionMenu } from "@blocknote/core/extensions";
import { Extension as TiptapExtension } from "@tiptap/core";
import type { EditorView } from "prosemirror-view";
import { BlockSelection, blockSelectionPlugin, isBlockSelection } from "./blockSelection";
import { APP_HTML_MIME, toNotionClipboardHtml } from "./notionCopy";

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

    // Click ⋮⋮: its block is selected (Notion paints it while the menu is
    // open, and the menu then acts on it) — unless it is already part of a
    // larger block selection, which the menu then acts on as a whole.
    const onHandleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.(".bn-side-menu") || !target.closest("[draggable='true']")) return;
      const block = editor.getExtension(SideMenuExtension)?.store?.state?.block;
      if (!block?.id || selectedBlockIds(editor).includes(block.id)) return;
      selectBlocksById(editor, [block.id]);
    };
    // When the menu closes, its library hands focus back to ⋮⋮; with blocks
    // still selected the keyboard belongs to them (↑/↓, Delete, Ctrl+Z…).
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.(".bn-side-menu") || !selectedBlockIds(editor).length) return;
      window.setTimeout(() => {
        const menuOpen = [...document.querySelectorAll<HTMLElement>("[role='menu']")]
          .some((m) => m.offsetParent !== null);
        if (!menuOpen && selectedBlockIds(editor).length) editor.prosemirrorView?.focus();
      }, 0);
    };
    document.addEventListener("click", onHandleClick, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      editor.getSelection = original;
      document.removeEventListener("click", onHandleClick, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  },
  tiptapExtensions: [
    TiptapExtension.create({
      name: "notionBlockSelection",
      priority: 1000,
      addProseMirrorPlugins: () => [
        blockSelectionPlugin({
          menuOpen: () => !!editor.getExtension(SuggestionMenu)?.shown(),
          writeClipboard: (view: EditorView, event: ClipboardEvent) => {
            const { clipboardHTML, externalHTML, markdown } = selectedFragmentToHTML(view as never, editor);
            event.clipboardData?.clearData();
            // text/html is what Notion (and every other app) reads, rewritten
            // into the shapes Notion pastes as to-dos, toggles and callouts
            // (notionCopy.ts). This app's own paste reads the unrewritten
            // export from APP_HTML_MIME instead, so copy → paste inside the
            // app is exactly what it was.
            event.clipboardData?.setData("blocknote/html", clipboardHTML);
            event.clipboardData?.setData(APP_HTML_MIME, externalHTML);
            event.clipboardData?.setData("text/html", toNotionClipboardHtml(externalHTML));
            event.clipboardData?.setData("text/plain", markdown);
          },
          duplicate: () => duplicateSelectedBlocks(editor),
          blur: () => editor.blur(),
        }),
      ],
    }),
  ],
}));
