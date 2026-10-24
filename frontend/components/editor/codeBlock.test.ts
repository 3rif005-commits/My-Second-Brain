// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { BlockNoteSchema, defaultBlockSpecs, BlockNoteEditor } from "@blocknote/core";
import { createNotionCodeBlockSpec } from "./codeBlock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

function makeEditor(blocks: AnyBlock[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs, codeBlock: createNotionCodeBlockSpec() },
  });
  const editor = BlockNoteEditor.create({ schema, initialContent: blocks });
  const root = document.createElement("div");
  editor.mount(root);
  return { editor, root };
}

const html = (language = "html", extra: AnyBlock = {}) => ({
  type: "codeBlock",
  props: { language, ...extra },
  content: '<div class="card">Hi</div>',
});

describe("Notion code block", () => {
  it("renders the hover pill with the language name, Copy and Wrap", () => {
    const { root } = makeEditor([html()]);
    const toolbar = root.querySelector(".sb-code-toolbar")!;
    expect(toolbar).toBeTruthy();
    expect(toolbar.getAttribute("contenteditable")).toBe("false");
    expect(toolbar.querySelector(".sb-code-lang span")!.textContent).toBe("HTML");
    expect(toolbar.querySelector('[aria-label="Copy"]')).toBeTruthy();
    expect(toolbar.querySelector('[aria-label="Wrap code"]')).toBeTruthy();
    expect(root.querySelector("pre code")!.textContent).toBe('<div class="card">Hi</div>');
  });

  it("shows an alias by its proper name and selects its menu entry", () => {
    const { root } = makeEditor([html("js")]);
    expect(root.querySelector(".sb-code-lang span")!.textContent).toBe("JavaScript");
    expect((root.querySelector(".sb-code-lang select") as HTMLSelectElement).value).toBe("javascript");
  });

  it("keeps a language it doesn't list instead of dropping it", () => {
    const { root, editor } = makeEditor([html("brainfuck")]);
    const select = root.querySelector(".sb-code-lang select") as HTMLSelectElement;
    expect(select.value).toBe("brainfuck");
    expect((editor.document[0].props as AnyBlock).language).toBe("brainfuck");
  });

  it("changing the menu changes the block's language", () => {
    const { root, editor } = makeEditor([html()]);
    const select = root.querySelector(".sb-code-lang select") as HTMLSelectElement;
    select.value = "python";
    select.dispatchEvent(new Event("change"));
    expect((editor.document[0].props as AnyBlock).language).toBe("python");
    expect(root.querySelector(".sb-code-lang span")!.textContent).toBe("Python");
  });

  it("Wrap toggles a per-block prop and the wrap class", () => {
    const { root, editor } = makeEditor([html()]);
    expect((editor.document[0].props as AnyBlock).wrap).toBe(false);
    (root.querySelector('[aria-label="Wrap code"]') as HTMLButtonElement).click();
    expect((editor.document[0].props as AnyBlock).wrap).toBe(true);
    expect(root.querySelector("pre")!.classList.contains("sb-code-wrap")).toBe(true);
    expect(root.querySelector('[aria-label="Unwrap code"]')!.getAttribute("aria-pressed")).toBe("true");
    (root.querySelector('[aria-label="Unwrap code"]') as HTMLButtonElement).click();
    expect((editor.document[0].props as AnyBlock).wrap).toBe(false);
  });

  it("loads a note saved before the wrap prop existed", () => {
    const { editor } = makeEditor([{ type: "codeBlock", props: { language: "python" }, content: "print(1)" }]);
    expect((editor.document[0].props as AnyBlock)).toMatchObject({ language: "python", wrap: false });
  });

  it("still exports as a fenced code block with its language", async () => {
    const { editor } = makeEditor([html()]);
    const md = await editor.blocksToMarkdownLossy(editor.document);
    expect(md).toContain("```html");
    expect(md).toContain('<div class="card">Hi</div>');
  });

  it("read-only: language label and Copy, no menu and no Wrap", () => {
    const schema = BlockNoteSchema.create({
      blockSpecs: { ...defaultBlockSpecs, codeBlock: createNotionCodeBlockSpec() },
    });
    const editor = BlockNoteEditor.create({ schema, initialContent: [html()] });
    editor.isEditable = false;
    const root = document.createElement("div");
    editor.mount(root);
    expect(root.querySelector(".sb-code-lang span")!.textContent).toBe("HTML");
    expect(root.querySelector(".sb-code-lang select")).toBeNull();
    expect(root.querySelector('[aria-label="Copy"]')).toBeTruthy();
    expect(root.querySelector('[aria-label="Wrap code"]')).toBeNull();
  });
});
