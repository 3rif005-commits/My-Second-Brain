// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { BlockNoteEditor } from "@blocknote/core";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { BlockSelection, isBlockSelection } from "./blockSelection";
import { NotionBlockSelection, selectedBlockIds, duplicateSelectedBlocks } from "./blockSelectionExtension";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

function makeEditor(blocks: AnyBlock[]) {
  const editor: AnyBlock = BlockNoteEditor.create({ initialContent: blocks, extensions: [NotionBlockSelection()] });
  const root = document.createElement("div");
  root.className = "notion-page";
  document.body.appendChild(root);
  editor.mount(root);
  const view = editor.prosemirrorView as EditorView;
  return { editor, view };
}

const p = (id: string, text: string, children: AnyBlock[] = []) =>
  ({ id, type: "paragraph", content: text, children });

/** Fires a key at the editor the way a keyboard would. Returns whether the
 *  editor handled it. */
function press(view: EditorView, key: string, mods: { mod?: boolean; shift?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey: !!mods.shift,
    ctrlKey: !!mods.mod && !IS_MAC,
    metaKey: !!mods.mod && IS_MAC,
    bubbles: true,
    cancelable: true,
  });
  let handled = false;
  view.someProp("handleKeyDown", (f) => {
    if (f(view, event)) handled = true;
    return handled;
  });
  return handled;
}

/** Caret inside block `id` at `offset` characters into its text. */
function caretIn(editor: AnyBlock, id: string, offset = 0, to?: number) {
  const view = editor.prosemirrorView as EditorView;
  let start = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.attrs?.id === id) {
      start = pos + 2; // blockContainer → blockContent → text
      return false;
    }
    return true;
  });
  view.dispatch(view.state.tr.setSelection(
    TextSelection.create(view.state.doc, start + offset, start + (to ?? offset)),
  ));
}

const ids = (editor: AnyBlock) => selectedBlockIds(editor);
const docIds = (blocks: AnyBlock[]): string[] => blocks.flatMap((b) => [b.id, ...docIds(b.children ?? [])]);

describe("Notion block selection", () => {
  it("Esc in text selects the block the caret is in; Esc again clears it", () => {
    const { editor, view } = makeEditor([p("a", "One"), p("b", "Two"), p("c", "Three")]);
    caretIn(editor, "b", 1);
    expect(press(view, "Escape")).toBe(true);
    expect(isBlockSelection(view.state.selection)).toBe(true);
    expect(ids(editor)).toEqual(["b"]);
    // No text toolbar, no browser highlight: the selection is invisible to the DOM.
    expect(view.state.selection.visible).toBe(false);
    expect(press(view, "Escape")).toBe(true);
    expect(isBlockSelection(view.state.selection)).toBe(false);
  });

  it("Ctrl+A: block text first, then every block; Esc then Ctrl+A selects all blocks", () => {
    const { editor, view } = makeEditor([p("a", "One"), p("b", "Two words"), p("c", "Three")]);
    caretIn(editor, "b", 2);
    press(view, "a", { mod: true });
    const sel = view.state.selection;
    expect(sel instanceof TextSelection).toBe(true);
    expect(view.state.doc.textBetween(sel.from, sel.to)).toBe("Two words");
    press(view, "a", { mod: true });
    expect(isBlockSelection(view.state.selection)).toBe(true);
    expect(ids(editor)).toEqual(docIds(editor.document));

    // The sequence from the report: text → Ctrl+A (text) → Esc (block) → Ctrl+A (page).
    caretIn(editor, "b", 2);
    press(view, "a", { mod: true });
    press(view, "Escape");
    expect(ids(editor)).toEqual(["b"]);
    press(view, "a", { mod: true });
    expect(ids(editor)).toEqual(docIds(editor.document));
  });

  it("an empty block goes straight to selecting every block", () => {
    const { editor, view } = makeEditor([p("a", "One"), p("b", "")]);
    caretIn(editor, "b", 0);
    press(view, "a", { mod: true });
    expect(isBlockSelection(view.state.selection)).toBe(true);
  });

  it("↑/↓ move the selection, Shift+↑/↓ grow and shrink it", () => {
    const { editor, view } = makeEditor([p("a", "A"), p("b", "B"), p("c", "C"), p("d", "D")]);
    caretIn(editor, "b");
    press(view, "Escape");
    press(view, "ArrowDown");
    expect(ids(editor)).toEqual(["c"]);
    press(view, "ArrowUp");
    press(view, "ArrowUp");
    expect(ids(editor)).toEqual(["a"]);
    press(view, "ArrowUp"); // at the top: stays
    expect(ids(editor)).toEqual(["a"]);
    press(view, "ArrowDown", { shift: true });
    press(view, "ArrowDown", { shift: true });
    expect(ids(editor)).toEqual(["a", "b", "c"]);
    press(view, "ArrowUp", { shift: true });
    expect(ids(editor)).toEqual(["a", "b"]);
  });

  it("selecting from a child into the next block lifts to the parent (children travel with it)", () => {
    const { editor, view } = makeEditor([p("a", "Parent", [p("a1", "Child")]), p("b", "Next")]);
    caretIn(editor, "a1");
    press(view, "Escape");
    expect(ids(editor)).toEqual(["a1"]);
    press(view, "ArrowDown", { shift: true });
    expect(ids(editor)).toEqual(["a", "b"]);
  });

  it("Enter returns to text with the caret at the end of the block", () => {
    const { editor, view } = makeEditor([p("a", "Hello"), p("b", "World")]);
    caretIn(editor, "a", 0);
    press(view, "Escape");
    press(view, "Enter");
    const sel = view.state.selection;
    expect(sel instanceof TextSelection && sel.empty).toBe(true);
    expect(sel.$from.parent.textContent).toBe("Hello");
    expect(sel.$from.parentOffset).toBe(5);
  });

  it("typing never overwrites selected blocks; Backspace deletes them", () => {
    const { editor, view } = makeEditor([p("a", "A"), p("b", "B"), p("c", "C")]);
    caretIn(editor, "b");
    press(view, "Escape");
    expect(press(view, "x")).toBe(true);
    expect(editor.document.map((b: AnyBlock) => b.id)).toContain("b");
    press(view, "Backspace");
    expect(editor.document.map((b: AnyBlock) => b.id).filter((id: string) => id !== editor.document.at(-1).id))
      .toEqual(["a", "c"]);
    // The caret lands at the end of the block before.
    expect(view.state.selection.$from.parent.textContent).toBe("A");
  });

  it("deleting every block leaves one empty paragraph", () => {
    const { editor, view } = makeEditor([p("a", "A"), p("b", "B")]);
    caretIn(editor, "a");
    press(view, "a", { mod: true });
    press(view, "a", { mod: true });
    press(view, "Delete");
    expect(editor.document).toHaveLength(1);
    expect(editor.document[0].type).toBe("paragraph");
    expect(editor.document[0].content).toEqual([]);
  });

  it("Tab indents under the block above, Shift+Tab brings it back out", () => {
    const { editor, view } = makeEditor([p("a", "A"), p("b", "B"), p("c", "C")]);
    caretIn(editor, "b");
    press(view, "Escape");
    press(view, "Tab");
    expect(editor.getBlock("a").children.map((b: AnyBlock) => b.id)).toEqual(["b"]);
    expect(ids(editor)).toEqual(["b"]);
    press(view, "Tab", { shift: true });
    expect(editor.getBlock("a").children).toEqual([]);
    expect(editor.document.slice(0, 3).map((b: AnyBlock) => b.id)).toEqual(["a", "b", "c"]);
    expect(ids(editor)).toEqual(["b"]);
  });

  it("Ctrl+Shift+↑/↓ move the selected blocks", () => {
    const { editor, view } = makeEditor([p("a", "A"), p("b", "B"), p("c", "C")]);
    caretIn(editor, "b");
    press(view, "Escape");
    press(view, "ArrowDown", { shift: true });
    expect(ids(editor)).toEqual(["b", "c"]);
    press(view, "ArrowUp", { mod: true, shift: true });
    expect(editor.document.slice(0, 3).map((b: AnyBlock) => b.id)).toEqual(["b", "c", "a"]);
    expect(ids(editor)).toEqual(["b", "c"]);
  });

  it("Ctrl+D duplicates the blocks and selects the copies", () => {
    const { editor, view } = makeEditor([p("a", "A", [p("a1", "Kid")]), p("b", "B")]);
    caretIn(editor, "a");
    press(view, "Escape");
    expect(duplicateSelectedBlocks(editor)).toBe(true);
    const doc = editor.document;
    expect(doc[1].id).not.toBe("a");
    expect(doc[1].content[0].text).toBe("A");
    expect(doc[1].children[0].content[0].text).toBe("Kid");
    expect(ids(editor)).toEqual([doc[1].id]);
  });

  it("copy writes whole blocks, children included", () => {
    const { editor, view } = makeEditor([p("a", "Parent", [p("a1", "Child")]), p("b", "B")]);
    caretIn(editor, "a");
    press(view, "Escape");
    const data = new Map<string, string>();
    const event = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { setData: (t: string, v: string) => data.set(t, v), clearData: () => data.clear(), getData: () => "" },
    });
    view.dom.dispatchEvent(event);
    expect(data.get("text/plain")).toContain("Parent");
    expect(data.get("text/plain")).toContain("Child");
    expect(data.get("blocknote/html")).toContain('data-id="a"');
  });

  it("survives edits elsewhere (the selection maps with the document)", () => {
    const { editor, view } = makeEditor([p("a", "A"), p("b", "B")]);
    caretIn(editor, "b");
    press(view, "Escape");
    // (tr.insert, not tr.insertText: insertText moves any non-empty selection.)
    view.dispatch(view.state.tr.insert(3, view.state.schema.text("more ")));
    expect(ids(editor)).toEqual(["b"]);
    expect(view.state.selection).toBeInstanceOf(BlockSelection);
  });

  it("deleting the selected blocks some other way drops the block selection", () => {
    const { editor, view } = makeEditor([p("a", "A"), p("b", "B"), p("c", "C")]);
    caretIn(editor, "b");
    press(view, "Escape");
    editor.removeBlocks(["b"]);
    expect(isBlockSelection(view.state.selection)).toBe(false);
  });
});
