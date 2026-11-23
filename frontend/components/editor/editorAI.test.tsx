// @vitest-environment jsdom
// The editor AI's prompt, context and answer reading (editorAI.ts).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug)
import { BlockNoteEditor } from "@blocknote/core";
// @ts-ignore — xl-ai@0.48.0 exports these at runtime but its index.d.ts is empty
import { aiDocumentFormats } from "@blocknote/xl-ai";
import { multiColSchema } from "./noteSchema";
import {
  EDITOR_AI_PROMPT, compactBlockHtml, editorDocumentState, editorStreamTools,
  normalizeAIHtml, windowAround, withNormalizedParse, SELECTION_BUDGET,
} from "./editorAI";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

function makeEditor(blocks?: AnyBlock[]) {
  const editor = BlockNoteEditor.create({ schema: multiColSchema });
  editor.mount(document.createElement("div"));
  if (blocks) editor.replaceBlocks(editor.document, blocks);
  return editor;
}

const strip = (b: AnyBlock): AnyBlock => {
  const { id: _id, children, ...rest } = b;
  return { ...rest, children: (children ?? []).map(strip) };
};

describe("the editor AI is told how this editor writes", () => {
  it("BlockNote's block rules, then this app's formulas and colours", () => {
    expect(EDITOR_AI_PROMPT.startsWith(aiDocumentFormats.html.systemPrompt)).toBe(true);
    expect(EDITOR_AI_PROMPT).toContain('data-inline-content-type="inlineMath"');
    expect(EDITOR_AI_PROMPT).toContain('<div data-type="math">');
    expect(EDITOR_AI_PROMPT).toContain("NEVER write maths as text");
  });
});

describe("what the editor AI is shown", () => {
  const sample: AnyBlock[] = [
    { type: "paragraph", props: { textAlignment: "center", backgroundColor: "green", textColor: "red" },
      content: [{ type: "text", text: "Answer: ", styles: { bold: true } },
        { type: "text", text: "grey", styles: { textColor: "gray", backgroundColor: "yellow" } },
        { type: "inlineMath", props: { latex: "x^2" } }] },
    { type: "heading", props: { level: 3, isToggleable: true }, content: "Field amplitudes" },
    { type: "table", content: { type: "tableContent", rows: [
      { cells: [[{ type: "inlineMath", props: { latex: "f \\approx 4.74 \\times 10^{14}\\,\\text{Hz}" } }], "x"] }] } },
    { type: "math", props: { latex: "\\nabla \\times \\vec{E} = -\\frac{\\partial \\vec{B}}{\\partial t}" } },
  ];

  it("is compact HTML that BlockNote reads back into the same blocks", async () => {
    const editor = makeEditor(sample);
    for (const block of editor.document.slice(0, sample.length)) {
      const full: string = await editor.blocksToHTMLLossy([block]);
      const compact = compactBlockHtml(full);
      expect(compact).not.toMatch(/style=|class=|katex|title=|contenteditable/);
      const back = (await editor.tryParseHTMLToBlocks(compact)) as AnyBlock[];
      expect(strip(back[0])).toEqual(strip(block));
    }
  });

  it("drops a table formula's KaTeX rendering (65k characters for one live answer key)", async () => {
    const editor = makeEditor(sample);
    const full: string = await editor.blocksToHTMLLossy([editor.document[2]]);
    const compact = compactBlockHtml(full);
    expect(full.length).toBeGreaterThan(1500);
    expect(compact.length).toBeLessThan(300);
  });

  it("keeps a long note's selection whole, with the rest folded to its outline", () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: `b${i}`, block: i % 20 === 0 ? `<h2>Exercise ${i / 20}</h2>` : `<p>${"word ".repeat(40)}</p>`,
    }));
    const out = windowAround(items, ["b120", "b121"], 4000);
    const ids = out.map((x) => x.id);
    expect(ids).toContain("b120");
    expect(ids).toContain("b121");
    expect(out.reduce((n, x) => n + (x.block?.length ?? 0), 0)).toBeLessThan(4600);
    expect(out[0].id).toBeUndefined();
    expect(out[0].block).toMatch(/blocks not shown; headings there: Exercise 0; Exercise 1/);
    expect(out.at(-1)!.block).toMatch(/not shown/);
    expect(windowAround(items.slice(0, 3), ["b1"], 4000)).toEqual(items.slice(0, 3));
  });

  it("sends the selection with its ids, and a bounded context without ids", async () => {
    const worksheet = readFileSync(join(__dirname, "fixtures", "worksheet-solution.html"), "utf8");
    const editor = makeEditor();
    const parsed = (await editor.tryParseHTMLToBlocks(worksheet)) as AnyBlock[];
    // a long note: the worksheet eight times
    editor.replaceBlocks(editor.document, Array.from({ length: 8 }, () => parsed).flat());
    const target = editor.document[20];
    const state = await editorDocumentState({ editor, selectedBlocks: [target] });
    expect(state.selection).toBe(true);
    expect(state.selectedBlocks[0].id).toBe(`${target.id}$`);
    expect(state.blocks.every((b: AnyBlock) => !("id" in b) || b.id === undefined)).toBe(true);
    const sent = JSON.stringify(state).length;
    const before = JSON.stringify(await aiDocumentFormats.html.defaultDocumentStateBuilder(
      { editor, selectedBlocks: [target] } as AnyBlock)).length;
    expect(sent).toBeLessThan(SELECTION_BUDGET * 1.3);
    expect(sent * 5).toBeLessThan(before);
  }, 30_000);

  it("marks the cursor when nothing is selected", async () => {
    const editor = makeEditor([{ type: "paragraph", content: "one" }, { type: "paragraph", content: "two" }]);
    editor.setTextCursorPosition(editor.document[0]);
    const state = await editorDocumentState({ editor });
    expect(state.selection).toBe(false);
    expect(state.blocks.map((b: AnyBlock) => (b.cursor ? "|" : b.block))).toEqual(["<p>one</p>", "|", "<p>two</p>"]);
    expect(state.blocks[0].id).toBe(`${editor.document[0].id}$`);
  });
});

describe("how the editor AI's answer is read", () => {
  const latexOf = (html: string) =>
    [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("[data-latex], [data-type=math]")]
      .map((e) => e.getAttribute("data-latex") ?? e.textContent);

  it("turns a formula written as text into a formula block", () => {
    const curl = "\\nabla \\times \\vec{E} = -\\frac{\\partial \\vec{B}}{\\partial t}";
    for (const p of [`<p>\\[ ${curl} \\]</p>`, `<p>$$${curl}$$</p>`, `<p>${curl}</p>`, `<p>$${curl}$</p>`]) {
      expect(normalizeAIHtml(p)).toBe(`<div data-type="math">${curl}</div>`);
    }
  });

  it("turns a formula inside a sentence into an inline formula", () => {
    expect(latexOf(normalizeAIHtml("<p>so \\(E_0 = cB_0\\) and $B_0$ grow</p>"))).toEqual(["E_0 = cB_0", "B_0"]);
    expect(latexOf(normalizeAIHtml("<ol><li><p>\\vec{k} \\times \\vec{E} = 0</p></li></ol>"))).toEqual(["\\vec{k} \\times \\vec{E} = 0"]);
  });

  it("leaves prices, prose about LaTeX, code and existing formulas alone", () => {
    for (const html of [
      "<p>costs $5 to $10</p>",
      "<p>Use \\frac for fractions</p>",
      "<p>run <code>echo $HOME$</code></p>",
      '<p>x <span data-inline-content-type="inlineMath" data-latex="\\frac{a}{b}"></span></p>',
      "<p>C:\\Users\\Documents</p>",
    ]) expect(normalizeAIHtml(html)).toBe(html);
  });

  it("applies to what the AI tools parse, and nothing else of the editor", async () => {
    const editor = makeEditor();
    const proxied = withNormalizedParse(editor);
    const [block] = (await proxied.tryParseHTMLToBlocks("<p>the field \\(E_0\\) grows</p>")) as AnyBlock[];
    expect(block.content[1]).toMatchObject({ type: "inlineMath", props: { latex: "E_0" } });
    expect(proxied.document).toEqual(editor.document);
    const [plain] = (await editor.tryParseHTMLToBlocks("<p>the field \\(E_0\\) grows</p>")) as AnyBlock[];
    expect(plain.content).toHaveLength(1);
    const tools = editorStreamTools().getStreamTools(editor, false);
    expect(tools.map((t: AnyBlock) => t.name)).toEqual(["update", "add", "delete"]);
  });
});
