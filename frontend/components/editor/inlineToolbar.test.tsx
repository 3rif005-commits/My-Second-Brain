// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, BlockNoteEditor } from "@blocknote/core";
import { insertInlineMath } from "./inlineToolbar";
import { InlineMathSpec } from "./customBlocks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

// Mirrors customBlocks.test.tsx's makeEditor(), plus the inlineMath spec the
// toolbar's ∑ button inserts.
function makeEditor(initialContent?: AnyBlock[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs },
    inlineContentSpecs: { ...defaultInlineContentSpecs, inlineMath: InlineMathSpec },
  });
  const editor = BlockNoteEditor.create({ schema, initialContent });
  editor.mount(document.createElement("div"));
  return editor;
}

describe("the inline toolbar's schema assumptions", () => {
  it("has `code` in the style schema, so BlockNote's own button can render it", () => {
    // The inline `code` button is BlockNote's stock BasicTextStyleButton — it
    // renders nothing at all unless the style is in the schema (its own
    // in-schema check), which is exactly why it's worth asserting here rather
    // than assuming. Nothing in this app registers it: it comes with
    // BlockNote's defaults, and was only ever missing from the toolbar's
    // default ITEM LIST.
    const editor = makeEditor();
    expect("code" in editor.schema.styleSchema).toBe(true);
  });

  it("has inlineMath in the inline content schema", () => {
    const editor = makeEditor();
    expect("inlineMath" in editor.schema.inlineContentSchema).toBe(true);
  });
});

describe("insertInlineMath", () => {
  it("turns the selected text into a formula whose latex is that text", () => {
    const editor = makeEditor();
    const inserted: AnyBlock[] = [];
    const fake = {
      getSelectedText: () => "x^2 + y^2",
      insertInlineContent: (content: AnyBlock[]) => inserted.push(...content),
    };

    expect(insertInlineMath(fake)).toBe(true);
    expect(inserted).toEqual([{ type: "inlineMath", props: { latex: "x^2 + y^2" } }]);
    void editor;
  });

  it("trims the selection, so a stray trailing space doesn't land in the LaTeX", () => {
    const inserted: AnyBlock[] = [];
    insertInlineMath({
      getSelectedText: () => "  E = mc^2 \n",
      insertInlineContent: (content: AnyBlock[]) => inserted.push(...content),
    });
    expect(inserted[0].props.latex).toBe("E = mc^2");
  });

  it("strips `$…$` delimiters rather than folding them into the LaTeX", () => {
    // Selecting `$x^2$` is how LaTeX is normally written in prose, and it's
    // exactly what an unresolved Notion paste leaves behind. Keeping the
    // dollars would render a formula with stray `$` glyphs inside it.
    const inserted: AnyBlock[] = [];
    const collect = (content: AnyBlock[]) => inserted.push(...content);
    insertInlineMath({ getSelectedText: () => "$x^2$", insertInlineContent: collect });
    insertInlineMath({ getSelectedText: () => "$$E = mc^2$$", insertInlineContent: collect });
    // A lone `$` inside the formula (a currency example, say) is not a wrapper.
    insertInlineMath({ getSelectedText: () => "a $ b", insertInlineContent: collect });

    expect(inserted.map((c) => c.props.latex)).toEqual(["x^2", "E = mc^2", "a $ b"]);
  });

  it("changes nothing when the selection is empty", () => {
    // An empty formula would render as nothing and so could never be clicked
    // to edit or remove — a dead spot in the text. Better to do nothing.
    const insertInlineContent = vi.fn();
    expect(insertInlineMath({ getSelectedText: () => "   ", insertInlineContent })).toBe(false);
    expect(insertInlineContent).not.toHaveBeenCalled();
  });

  it("survives an editor with no getSelectedText rather than throwing", () => {
    const insertInlineContent = vi.fn();
    expect(insertInlineMath({ insertInlineContent })).toBe(false);
    expect(insertInlineContent).not.toHaveBeenCalled();
  });
});

describe("inline math editing", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderMath = (latex: string, update?: (c: AnyBlock) => void) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (InlineMathSpec as any).implementation.render({ type: "inlineMath", props: { latex } }, update).dom;

  const clickToEdit = (dom: HTMLElement) => {
    dom.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return dom.querySelector("input") as HTMLInputElement;
  };

  it("opens an input holding the LaTeX source when clicked, still a formula", () => {
    // The whole point: clicking must not destroy the rendering. An earlier
    // version replaced the node with plain `$x^2$` text, which meant one
    // stray click silently turned a formula into raw text.
    const dom = renderMath("x^2", () => {});
    expect(dom.getAttribute("title")).toBe("Click to edit LaTeX");
    expect(dom.innerHTML).toContain("katex"); // KaTeX rendered, not raw source

    const input = clickToEdit(dom);
    expect(input).not.toBeNull();
    expect(input.value).toBe("x^2");
  });

  it("commits an edit on Enter, writing back an inlineMath node (never text)", () => {
    const written: AnyBlock[] = [];
    const input = clickToEdit(renderMath("x^2", (c) => written.push(c)));
    input.value = "x^3";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(written).toEqual([{ type: "inlineMath", props: { latex: "x^3" } }]);
  });

  it("commits on blur too, so clicking away keeps the edit", () => {
    const written: AnyBlock[] = [];
    const input = clickToEdit(renderMath("a", (c) => written.push(c)));
    input.value = "b";
    input.dispatchEvent(new FocusEvent("blur"));

    expect(written).toEqual([{ type: "inlineMath", props: { latex: "b" } }]);
  });

  it("abandons the edit on Escape, re-rendering the original formula", () => {
    const written: AnyBlock[] = [];
    const dom = renderMath("x^2", (c) => written.push(c));
    const input = clickToEdit(dom);
    input.value = "ruined";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(written).toEqual([]);
    expect(dom.querySelector("input")).toBeNull();
    expect(dom.innerHTML).toContain("katex");
  });

  it("treats clearing the box as leaving the formula alone", () => {
    // An empty formula renders as nothing and so could never be clicked
    // again — a dead spot in the text.
    const written: AnyBlock[] = [];
    const dom = renderMath("x^2", (c) => written.push(c));
    const input = clickToEdit(dom);
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(written).toEqual([]);
    expect(dom.innerHTML).toContain("katex");
  });

  it("does not write back when the LaTeX is unchanged", () => {
    const written: AnyBlock[] = [];
    const input = clickToEdit(renderMath("x^2", (c) => written.push(c)));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(written).toEqual([]);
  });

  it("commits once, even though blur follows the Enter that replaced the input", () => {
    const written: AnyBlock[] = [];
    const input = clickToEdit(renderMath("a", (c) => written.push(c)));
    input.value = "b";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new FocusEvent("blur"));
    expect(written).toHaveLength(1);
  });

  it("still renders without an update callback (no click affordance, latex as the tooltip)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec = InlineMathSpec as any;
    const { dom } = spec.implementation.render({ type: "inlineMath", props: { latex: "a+b" } });
    expect(dom.getAttribute("title")).toBe("a+b");
    expect(dom.style.cursor).toBe("");
  });

  it("shows the LaTeX source rather than vanishing when KaTeX cannot parse it", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec = InlineMathSpec as any;
    const { dom } = spec.implementation.render({ type: "inlineMath", props: { latex: "\\frac{" } }, () => {});
    expect(dom.textContent.length).toBeGreaterThan(0);
  });
});
