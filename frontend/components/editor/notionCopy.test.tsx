// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { BlockNoteEditor, createExternalHTMLExporter } from "@blocknote/core";
import { multiColSchema } from "./noteSchema";
import { toNotionClipboardHtml } from "./notionCopy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

/** What a copy of these blocks puts in text/html, after the Notion rewrite. */
function copied(blocks: AnyBlock[]): Document {
  const editor: AnyBlock = BlockNoteEditor.create({ schema: multiColSchema, initialContent: blocks });
  const html = createExternalHTMLExporter(editor.pmSchema, editor).exportBlocks(editor.document, {});
  return new DOMParser().parseFromString(toNotionClipboardHtml(html), "text/html");
}

describe("copy for Notion (text/html)", () => {
  it("a to-do is one list item: checkbox and text, no paragraph inside", () => {
    const doc = copied([
      { type: "checkListItem", props: { checked: true }, content: "Todo one" },
      { type: "checkListItem", content: "Todo three" },
    ]);
    const items = [...doc.querySelectorAll("ul > li")];
    expect(items).toHaveLength(2);
    expect(items[0].querySelector("p")).toBeNull();
    expect((items[0].querySelector("input") as HTMLInputElement).hasAttribute("checked")).toBe(true);
    expect(items[0].textContent).toBe("Todo one");
    expect(items[1].querySelector("input")!.hasAttribute("checked")).toBe(false);
  });

  it("a toggle is a <details> outside any list, its title straight in <summary>", () => {
    const doc = copied([
      { type: "bulletListItem", content: "Before" },
      { type: "toggleListItem", content: "Open toggle", children: [{ type: "paragraph", content: "Child" }] },
      { type: "bulletListItem", content: "After" },
    ]);
    const details = doc.querySelector("body > details")!;
    expect(details).toBeTruthy();
    expect(details.querySelector("summary")!.innerHTML).toBe("Open toggle");
    expect(details.querySelector(":scope > p")!.textContent).toBe("Child");
    // The bullets around it stay bullets, in order.
    expect([...doc.body.children].map((e) => e.tagName)).toEqual(["UL", "DETAILS", "UL"]);
    expect(doc.querySelector("li details")).toBeNull();
  });

  it("a toggle heading keeps its heading inside the summary", () => {
    const doc = copied([
      { type: "heading", props: { level: 2, isToggleable: true }, content: "Section", children: [{ type: "paragraph", content: "Under" }] },
    ]);
    expect(doc.querySelector("details > summary > h2")!.textContent).toBe("Section");
  });

  it("a callout is one <aside>: emoji, then its text", () => {
    const doc = copied([
      { type: "callout", props: { calloutType: "NOTE", calloutIcon: "🧭" }, children: [{ type: "paragraph", content: "This is a callout." }] },
      { type: "paragraph", content: "After" },
    ]);
    const aside = doc.querySelector("body > aside")!;
    expect(aside.textContent).toBe("🧭 This is a callout.");
    expect(doc.querySelector(".callout-icon")).toBeNull();
    expect([...doc.body.children].map((e) => e.tagName)).toEqual(["ASIDE", "P"]);
  });

  it("leaves the blocks Notion already reads alone", () => {
    const blocks = [
      { type: "heading", props: { level: 1 }, content: "Title" },
      { type: "quote", content: "A quote block" },
      { type: "divider" },
      { type: "codeBlock", props: { language: "javascript" }, content: "let a = 1;" },
      { type: "bulletListItem", content: "Bullet", children: [{ type: "bulletListItem", content: "Nested" }] },
      { type: "numberedListItem", content: "First" },
    ];
    const editor: AnyBlock = BlockNoteEditor.create({ schema: multiColSchema, initialContent: blocks });
    const html = createExternalHTMLExporter(editor.pmSchema, editor).exportBlocks(editor.document, {});
    expect(toNotionClipboardHtml(html)).toBe(new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body.innerHTML);
  });
});
