// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readNotionJson, notionJsonToBlocks } from "./notionBlocks";

// Fixtures below are INVENTED content in the exact envelope and record shape
// captured from a real Notion clipboard write (observed by patching
// DataTransfer.prototype.setData on a live Notion page and copying):
//
//   blocks-v3:  { blocks: [ { blockId, blockSubtree: { block: { id: { value } } } } ] }
//   multi-text: { blockSelection: { blocks: [ … ] } } with the record one
//               `value` deeper.
//
// No real note content is used.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = any;

function v3(rootId: string, values: Rec[]) {
  const block: Rec = {};
  for (const value of values) block[value.id] = { value };
  return JSON.stringify({
    blocks: [{ blockId: rootId, blockSubtree: { __version__: "1", block } }],
    action: "copy",
    wasContiguousSelection: true,
  });
}

function multiText(rootId: string, values: Rec[]) {
  const block: Rec = {};
  for (const value of values) block[value.id] = { value: { value } };
  return JSON.stringify({
    blockSelection: { blocks: [{ blockId: rootId, blockSubtree: { __version__: "1", block } }] },
    tree: {},
  });
}

const page = (id: string, kids: string[]) => ({ id, type: "page", properties: {}, content: kids });
const text = (id: string, t: string) => ({ id, type: "text", properties: { title: [[t]] }, content: [] });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textOf(block: any): string {
  return (block?.content ?? [])
    .map((c: { type: string; text?: string }) => (c.type === "text" ? c.text ?? "" : ""))
    .join("");
}

describe("readNotionJson", () => {
  function clipboard(data: Record<string, string>): DataTransfer {
    return { getData: (t: string) => data[t] ?? "" } as unknown as DataTransfer;
  }

  it("prefers the blocks-v3 payload a block selection writes", () => {
    const got = readNotionJson(
      clipboard({
        "text/html": "<p>x</p>",
        "text/_notion-blocks-v3-production": "V3",
        "text/_notion-multi-text-production": "MULTI",
      })
    );
    expect(got).toBe("V3");
  });

  it("falls back to the multi-text payload a text selection writes", () => {
    expect(readNotionJson(clipboard({ "text/_notion-multi-text-production": "MULTI" }))).toBe("MULTI");
  });

  it("returns null when the clipboard carries no Notion JSON", () => {
    expect(readNotionJson(clipboard({ "text/html": "<p>x</p>" }))).toBeNull();
    expect(readNotionJson(null)).toBeNull();
  });

  it("survives a clipboard that throws on an unknown type", () => {
    const throwing = {
      getData: (t: string) => {
        if (t.includes("notion")) throw new Error("nope");
        return "<p>x</p>";
      },
    } as unknown as DataTransfer;
    expect(readNotionJson(throwing)).toBeNull();
  });
});

describe("notionJsonToBlocks — the facts the HTML cannot carry", () => {
  it("keeps a toggle a toggle and a bulleted list a bullet", () => {
    // In text/html BOTH of these are <li> with nothing to tell them apart.
    const json = v3("p1", [
      page("p1", ["t1", "b1"]),
      { id: "t1", type: "toggle", properties: { title: [["A toggle"]] }, content: ["c1"] },
      text("c1", "hidden child"),
      { id: "b1", type: "bulleted_list", properties: { title: [["A bullet"]] }, content: [] },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks.map((b) => b.type)).toEqual(["toggleListItem", "bulletListItem"]);
    expect(textOf(blocks[0])).toBe("A toggle");
    expect(blocks[0].children.map((c: Rec) => c.type)).toEqual(["paragraph"]);
    expect(textOf(blocks[0].children[0])).toBe("hidden child");
  });

  it("reconstructs a toggle heading, children nested under it", () => {
    // The whole reason this path exists: in text/html a toggle heading is a
    // bare <h3> and its children are flat siblings after it.
    const json = v3("p1", [
      page("p1", ["h1"]),
      {
        id: "h1",
        type: "sub_sub_header",
        properties: { title: [["Foundations"]] },
        format: { toggleable: true, block_color: "default" },
        content: ["c1", "c2"],
      },
      text("c1", "first child"),
      { id: "c2", type: "bulleted_list", properties: { title: [["second child"]] }, content: [] },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].props.level).toBe(3);
    expect(blocks[0].props.isToggleable).toBe(true);
    expect(blocks[0].children.map((c: Rec) => c.type)).toEqual(["paragraph", "bulletListItem"]);
  });

  it("leaves a non-toggleable heading alone", () => {
    const json = v3("p1", [
      page("p1", ["h1"]),
      {
        id: "h1",
        type: "sub_header",
        properties: { title: [["Plain"]] },
        format: { toggleable: false },
        content: [],
      },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks[0].props.level).toBe(2);
    expect(blocks[0].props.isToggleable).toBe(false);
  });

  it("carries a callout's own emoji and colour", () => {
    const json = v3("p1", [
      page("p1", ["c1"]),
      {
        id: "c1",
        type: "callout",
        properties: { title: [["Watch out for this."]] },
        format: { page_icon: "🛑", block_color: "red_background" },
        content: [],
      },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks[0].type).toBe("callout");
    expect(blocks[0].props.calloutIcon).toBe("🛑");
    expect(blocks[0].props.calloutType).toBe("CAUTION"); // red
    // The callout block holds no inline content, so its text is its first child.
    expect(textOf(blocks[0].children[0])).toBe("Watch out for this.");
  });

  it("keeps an emoji that has no counterpart in this app's palette", () => {
    const json = v3("p1", [
      page("p1", ["c1"]),
      {
        id: "c1",
        type: "callout",
        properties: { title: [["Ship it."]] },
        format: { page_icon: "🚀", block_color: "teal_background" },
        content: [],
      },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks[0].props.calloutIcon).toBe("🚀");
    expect(blocks[0].props.calloutType).toBe("TIP"); // teal reads as green
  });

  it("turns an inline equation annotation into real inline math", () => {
    const json = v3("p1", [
      page("p1", ["t1"]),
      {
        id: "t1",
        type: "text",
        properties: { title: [["The rule "], ["⁍", [["e", "Q(s,a)"]]], [" applies."]] },
        content: [],
      },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks[0].content.map((c: Rec) => c.type)).toEqual(["text", "inlineMath", "text"]);
    expect(blocks[0].content[1].props.latex).toBe("Q(s,a)");
    // The placeholder glyph Notion uses for the equation span is not kept.
    expect(textOf(blocks[0])).toBe("The rule  applies.");
  });
});

describe("notionJsonToBlocks — everyday blocks", () => {
  it("maps the ordinary types", () => {
    const json = v3("p1", [
      page("p1", ["h", "t", "n", "d", "q", "e"]),
      { id: "h", type: "header", properties: { title: [["Top"]] }, content: [] },
      text("t", "para"),
      { id: "n", type: "numbered_list", properties: { title: [["one"]] }, content: [] },
      { id: "d", type: "divider", properties: {}, content: [] },
      { id: "q", type: "quote", properties: { title: [["quoted"]] }, content: [] },
      { id: "e", type: "equation", properties: { title: [["a^2 + b^2 = c^2"]] }, content: [] },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks.map((b) => b.type)).toEqual([
      "heading", "paragraph", "numberedListItem", "divider", "quote", "math",
    ]);
    expect(blocks[0].props.level).toBe(1);
    expect(blocks[5].props.latex).toBe("a^2 + b^2 = c^2");
  });

  it("carries a to-do's checked state", () => {
    const json = v3("p1", [
      page("p1", ["a", "b"]),
      { id: "a", type: "to_do", properties: { title: [["done"]], checked: [["Yes"]] }, content: [] },
      { id: "b", type: "to_do", properties: { title: [["not done"]] }, content: [] },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks.map((b) => b.props.checked)).toEqual([true, false]);
    expect(blocks.every((b) => b.type === "checkListItem")).toBe(true);
  });

  it("keeps a code block's language", () => {
    const json = v3("p1", [
      page("p1", ["c"]),
      {
        id: "c",
        type: "code",
        properties: { title: [["return a + b"]], language: [["Python"]] },
        content: [],
      },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks[0].type).toBe("codeBlock");
    expect(blocks[0].props.language).toBe("python");
  });

  it("applies text styles and links", () => {
    const json = v3("p1", [
      page("p1", ["t"]),
      {
        id: "t",
        type: "text",
        properties: {
          title: [
            ["bold", [["b"]]],
            ["plain"],
            ["marked", [["h", "yellow_background"]]],
            ["site", [["a", "https://example.com"]]],
          ],
        },
        content: [],
      },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    const [b, p, m, l] = blocks[0].content;
    expect(b.styles.bold).toBe(true);
    expect(p.styles).toEqual({});
    expect(m.styles.backgroundColor).toBe("yellow");
    expect(l.type).toBe("link");
    expect(l.href).toBe("https://example.com");
  });

  it("rebuilds a table in its declared column order", () => {
    const json = v3("p1", [
      page("p1", ["tb"]),
      {
        id: "tb",
        type: "table",
        properties: {},
        format: { table_block_column_order: ["colB", "colA"] },
        content: ["r1", "r2"],
      },
      { id: "r1", type: "table_row", properties: { colA: [["a1"]], colB: [["b1"]] }, content: [] },
      { id: "r2", type: "table_row", properties: { colA: [["a2"]], colB: [["b2"]] }, content: [] },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("table");
    const rows = blocks[0].content.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].cells[0][0].text).toBe("b1"); // declared order puts colB first
    expect(rows[0].cells[1][0].text).toBe("a1");
  });

  it("replaces unfetchable media with a labelled placeholder", () => {
    const json = v3("p1", [
      page("p1", ["i"]),
      { id: "i", type: "image", properties: { title: [["diagram.png"]] }, content: [] },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks[0].type).toBe("paragraph");
    expect(textOf(blocks[0])).toContain("not available via copy-paste");
    expect(textOf(blocks[0])).toContain("diagram.png");
  });

  it("keeps a coloured quote a real quote, toggle nested inside, colour as a prop", () => {
    // Notion has no "tinted box with arbitrary children" block of its own —
    // colouring a quote and nesting a toggle under it is how one is built.
    // Colour must NOT reinterpret the quote as a callout (that was the actual
    // bug: a coloured quote silently became a different block type). It stays
    // a quote — same as a genuine Notion `quote` always does — with the
    // colour carried as an ordinary prop and the toggle as a real child.
    const json = v3("p1", [
      page("p1", ["q"]),
      { id: "q", type: "quote", properties: {}, format: { block_color: "blue" }, content: ["t"] },
      { id: "t", type: "toggle", properties: { title: [["Overview"]] }, content: ["c"] },
      text("c", "inside"),
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks.map((b) => b.type)).toEqual(["quote"]);
    expect(blocks[0].props.textColor).toBe("blue");
    expect(blocks[0].children.map((c: Rec) => c.type)).toEqual(["toggleListItem"]);
    expect(textOf(blocks[0].children[0])).toBe("Overview");
    expect(textOf(blocks[0].children[0].children[0])).toBe("inside");
  });

  it("nests a plain, uncoloured quote's block children instead of spilling them as siblings", () => {
    const json = v3("p1", [
      page("p1", ["q"]),
      { id: "q", type: "quote", properties: { title: [["quoted"]] }, content: ["t"] },
      { id: "t", type: "toggle", properties: { title: [["nested"]] }, content: [] },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks.map((b) => b.type)).toEqual(["quote"]);
    expect(textOf(blocks[0])).toBe("quoted");
    expect(blocks[0].children.map((c: Rec) => c.type)).toEqual(["toggleListItem"]);
    expect(textOf(blocks[0].children[0])).toBe("nested");
  });

  it("carries block colour as a prop on any ordinary text-bearing type, not just quote", () => {
    // Colour is generic, not a special case wired up per block type: every
    // type this switch can produce for a coloured Notion block picks it up
    // the same way, via the same helper.
    const json = v3("p1", [
      page("p1", ["h", "t", "b"]),
      { id: "h", type: "header", properties: { title: [["Title"]] }, format: { block_color: "red" }, content: [] },
      { id: "t", type: "text", properties: { title: [["para"]] }, format: { block_color: "green_background" }, content: [] },
      { id: "b", type: "bulleted_list", properties: { title: [["item"]] }, format: { block_color: "purple" }, content: [] },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks[0].props.textColor).toBe("red");
    expect(blocks[1].props.backgroundColor).toBe("green");
    expect(blocks[2].props.textColor).toBe("purple");
  });
});

describe("notionJsonToBlocks — envelopes and bad input", () => {
  it("reads the multi-text envelope's extra value nesting", () => {
    const json = multiText("t1", [
      { id: "t1", type: "toggle", properties: { title: [["Deeper envelope"]] }, content: [] },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks[0].type).toBe("toggleListItem");
    expect(textOf(blocks[0])).toBe("Deeper envelope");
  });

  it("returns null for input it does not understand, so the caller can fall back", () => {
    expect(notionJsonToBlocks("not json at all")).toBeNull();
    expect(notionJsonToBlocks("{}")).toBeNull();
    expect(notionJsonToBlocks(JSON.stringify({ blocks: [] }))).toBeNull();
  });

  it("keeps an unknown block type's text rather than dropping it", () => {
    const json = v3("p1", [
      page("p1", ["x"]),
      { id: "x", type: "some_future_type", properties: { title: [["still here"]] }, content: [] },
    ]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks[0].type).toBe("paragraph");
    expect(textOf(blocks[0])).toBe("still here");
  });

  it("does not emit the page wrapper itself as a block", () => {
    const json = v3("p1", [page("p1", ["t"]), text("t", "only me")]);
    const blocks = notionJsonToBlocks(json)!;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });
});
