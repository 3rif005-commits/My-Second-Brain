// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { BlockNoteEditor } from "@blocknote/core";
import { TextSelection } from "prosemirror-state";
import { multiColSchema } from "./noteSchema";
import { BlockSelection } from "./blockSelection";
import {
  APP_BLOCKS_MIME, clipboardFromSelection, pasteAppClipboard, readAppClipboard, writeAppClipboard,
} from "./appClipboard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

const editorWith = (blocks: AnyBlock[]): AnyBlock =>
  BlockNoteEditor.create({ schema: multiColSchema, initialContent: blocks });

/** A block tree without ids: what must survive copy → paste. */
const shape = (blocks: AnyBlock[]): AnyBlock[] =>
  blocks.map(({ id: _id, children, ...rest }: AnyBlock) => ({ ...rest, children: shape(children ?? []) })); // eslint-disable-line @typescript-eslint/no-unused-vars

/** Every block type the note schema has, with non-default props. */
const EVERY_KIND: AnyBlock[] = [
  { type: "heading", props: { level: 2, isToggleable: true, textColor: "red" }, content: "Section", children: [{ type: "paragraph", content: "Under" }] },
  { type: "paragraph", props: { backgroundColor: "yellow" }, content: [{ type: "text", text: "bold", styles: { bold: true } }, { type: "text", text: " plain", styles: {} }] },
  { type: "checkListItem", props: { checked: true }, content: "Done" },
  { type: "toggleListItem", content: "Toggle", children: [{ type: "bulletListItem", content: "Inside" }] },
  { type: "numberedListItem", content: "One" },
  { type: "quote", content: "Quote" },
  { type: "codeBlock", props: { language: "python" }, content: "print(1)" },
  { type: "divider" },
  { type: "image", props: { url: "https://example.com/a.png", caption: "Cap", previewWidth: 320 } },
  { type: "callout", props: { calloutType: "WARNING", calloutIcon: "🧭" }, children: [{ type: "paragraph", content: "Careful" }] },
  { type: "database", props: { databaseId: "db-123", viewId: "view-9" } },
  { type: "button", props: { label: "Go", icon: "🚀", actionsJson: '[{"type":"x"}]' } },
  { type: "math", props: { latex: "e^{i\\pi}+1=0" } },
  { type: "interactive", props: { title: "Quiz", html: "<b>hi</b>", view: "split" } },
  { type: "table", content: { type: "tableContent", rows: [{ cells: ["a", "b"] }, { cells: ["c", "d"] }] } },
];

describe("the app's clipboard (Notion's mechanism: the blocks themselves, as JSON)", () => {
  it("copy → paste of every block type is exact, props and children included", () => {
    const from = editorWith(EVERY_KIND);
    from.transact((tr: AnyBlock) => tr.setSelection(BlockSelection.all(tr.doc)));
    const clip = clipboardFromSelection(from.prosemirrorState.selection)!;
    expect(clip.kind).toBe("blocks");

    // Through a real DataTransfer-like round trip, as a browser would carry it.
    const store = new Map<string, string>();
    const dt = { setData: (t: string, v: string) => store.set(t, v), getData: (t: string) => store.get(t) ?? "" } as unknown as DataTransfer;
    writeAppClipboard(dt, clip);
    expect(store.has(APP_BLOCKS_MIME)).toBe(true);
    const read = readAppClipboard(dt)!;

    const to = editorWith([{ type: "paragraph", content: "" }]);
    to.setTextCursorPosition(to.document[0], "start");
    expect(pasteAppClipboard(to, read)).toBe(true);
    // The empty line is replaced by the pasted blocks: the two documents match.
    expect(shape(to.document)).toEqual(shape(from.document));
  });

  it("pasted blocks get fresh ids (pasting twice never duplicates an id)", () => {
    const from = editorWith([{ id: "x", type: "paragraph", content: "A", children: [{ id: "y", type: "paragraph", content: "B" }] }]);
    from.transact((tr: AnyBlock) => tr.setSelection(BlockSelection.single(tr.doc, 1)));
    const clip = clipboardFromSelection(from.prosemirrorState.selection)!;
    pasteAppClipboard(from, clip, ["x"]);
    pasteAppClipboard(from, clip, ["x"]);
    const ids: string[] = [];
    const walk = (bs: AnyBlock[]) => bs.forEach((b) => { ids.push(b.id); walk(b.children); });
    walk(from.document);
    expect(new Set(ids).size).toBe(ids.length);
    expect(from.document.slice(0, 3).map((b: AnyBlock) => b.content[0].text)).toEqual(["A", "A", "A"]);
  });

  it("in block mode the paste goes after the selected blocks", () => {
    const ed = editorWith([{ id: "a", type: "paragraph", content: "A" }, { id: "b", type: "paragraph", content: "B" }]);
    const clip = { v: 1 as const, kind: "blocks" as const, blocks: [{ type: "database", props: { databaseId: "d1", viewId: "" } }] };
    pasteAppClipboard(ed, clip, ["a"]);
    expect(ed.document.map((b: AnyBlock) => b.type).slice(0, 3)).toEqual(["paragraph", "database", "paragraph"]);
    expect(ed.document[1].props.databaseId).toBe("d1");
  });

  it("a text selection across blocks: cut at its ends; the first piece joins the caret's line", () => {
    const from = editorWith([
      { type: "paragraph", content: "Hello world" },
      { type: "checkListItem", props: { checked: true }, content: "Todo item" },
      { type: "paragraph", content: "Tail end" },
    ]);
    // From "world" to "Tail".
    from.transact((tr: AnyBlock) => {
      let start = 0; let end = 0;
      tr.doc.descendants((n: AnyBlock, pos: number) => {
        if (n.isText && n.text === "Hello world") start = pos + 6;
        if (n.isText && n.text === "Tail end") end = pos + 4;
      });
      tr.setSelection(TextSelection.create(tr.doc, start, end));
    });
    const clip = clipboardFromSelection(from.prosemirrorState.selection)!;
    expect(clip.kind).toBe("text");
    expect(clip.blocks.map((b: AnyBlock) => b.content.map((c: AnyBlock) => c.text).join(""))).toEqual(["world", "Todo item", "Tail"]);
    expect(clip.blocks[1].type).toBe("checkListItem");
    expect(clip.blocks[1].props.checked).toBe(true);

    const to = editorWith([{ type: "paragraph", content: "Say " }]);
    to.setTextCursorPosition(to.document[0], "end");
    pasteAppClipboard(to, clip);
    expect(to.document[0].content.map((c: AnyBlock) => c.text).join("")).toBe("Say world");
    expect(to.document[1].type).toBe("checkListItem");
    expect(to.document[2].content[0].text).toBe("Tail");
  });

  it("ignores a clipboard that isn't the app's", () => {
    const dt = { getData: () => "not json" } as unknown as DataTransfer;
    expect(readAppClipboard(dt)).toBeNull();
    expect(readAppClipboard({ getData: () => "" } as unknown as DataTransfer)).toBeNull();
  });
});
