// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { BlockNoteSchema, defaultBlockSpecs, BlockNoteEditor } from "@blocknote/core";
import { createNotionCodeBlockSpec, filterLanguages } from "./codeBlock";
import { CODE_LANGUAGES } from "@/lib/codeHighlight";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

function makeEditor(blocks: AnyBlock[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs, codeBlock: createNotionCodeBlockSpec() },
  });
  const editor = BlockNoteEditor.create({ schema, initialContent: blocks });
  const root = document.createElement("div");
  // In the page, like the real editor: the language menu finds its block by data-id.
  document.body.appendChild(root);
  editor.mount(root);
  return { editor, root };
}

const html = (language = "html", extra: AnyBlock = {}) => ({
  type: "codeBlock",
  props: { language, ...extra },
  content: '<div class="card">Hi</div>',
});

describe("Notion code block", () => {
  it("renders the hover pill: language button and Copy; no spell-check in code", () => {
    const { root } = makeEditor([html()]);
    const toolbar = root.querySelector(".sb-code-toolbar")!;
    expect(toolbar.getAttribute("contenteditable")).toBe("false");
    const lang = toolbar.querySelector("button.sb-code-lang")!;
    expect(lang.textContent).toBe("HTML");
    expect(lang.getAttribute("aria-haspopup")).toBe("listbox");
    expect(toolbar.querySelector("select")).toBeNull();
    expect(toolbar.querySelector('[aria-label="Copy code"]')).toBeTruthy();
    expect(root.querySelector("pre code")!.textContent).toBe('<div class="card">Hi</div>');
    expect(root.querySelector("pre code")!.getAttribute("spellcheck")).toBe("false");
  });

  it("shows an alias by its proper name, and an unlisted language as typed", () => {
    expect(makeEditor([html("js")]).root.querySelector(".sb-code-lang")!.textContent).toBe("JavaScript");
    const { root, editor } = makeEditor([html("brainfuck")]);
    expect(root.querySelector(".sb-code-lang")!.textContent).toBe("brainfuck");
    expect((editor.document[0].props as AnyBlock).language).toBe("brainfuck");
  });

  it("the language menu: search, check on the current one, click to change", () => {
    const { root, editor } = makeEditor([html()]);
    (root.querySelector("button.sb-code-lang") as HTMLButtonElement).click();
    const menu = document.querySelector(".sb-lang-menu")!;
    expect(menu).toBeTruthy();
    const search = menu.querySelector("input")!;
    expect(document.activeElement).toBe(search);
    expect(menu.querySelector('[aria-selected="true"]')!.textContent).toBe("HTML");
    search.value = "pyth";
    search.dispatchEvent(new Event("input"));
    const rows = [...menu.querySelectorAll(".sb-lang-row")].map((r) => r.textContent);
    expect(rows).toEqual(["Python"]);
    (menu.querySelector(".sb-lang-row") as HTMLElement).click();
    expect(document.querySelector(".sb-lang-menu")).toBeNull();
    expect((editor.document[0].props as AnyBlock).language).toBe("python");
    expect(root.querySelector(".sb-code-lang")!.textContent).toBe("Python");
  });

  it("the language menu: arrows + Enter pick, Escape closes, no results says so", () => {
    const { root, editor } = makeEditor([html()]);
    (root.querySelector("button.sb-code-lang") as HTMLButtonElement).click();
    let search = document.querySelector(".sb-lang-menu input") as HTMLInputElement;
    search.value = "zzz";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector(".sb-lang-empty")!.textContent).toBe("No results");
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".sb-lang-menu")).toBeNull();
    expect((editor.document[0].props as AnyBlock).language).toBe("html");

    (root.querySelector("button.sb-code-lang") as HTMLButtonElement).click();
    search = document.querySelector(".sb-lang-menu input") as HTMLInputElement;
    search.value = "java";  // Java, JavaScript
    search.dispatchEvent(new Event("input"));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect((editor.document[0].props as AnyBlock).language).toBe("javascript");
  });

  it("the language menu survives the block being redrawn while it is open", () => {
    const { root, editor } = makeEditor([html()]);
    (root.querySelector("button.sb-code-lang") as HTMLButtonElement).click();
    // Any prop change re-runs render (as a decoration change does in the browser).
    editor.updateBlock(editor.document[0].id, { props: { wrap: true } });
    const menu = document.querySelector(".sb-lang-menu")!;
    expect(menu).toBeTruthy();
    // The list scrolling itself, or a scroll that doesn't move the block, keeps it open.
    menu.querySelector(".sb-lang-list")!.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scroll"));
    expect(document.querySelector(".sb-lang-menu")).toBe(menu);
    const search = menu.querySelector("input")!;
    search.value = "rust";
    search.dispatchEvent(new Event("input"));
    (menu.querySelector(".sb-lang-row") as HTMLElement).click();
    expect((editor.document[0].props as AnyBlock).language).toBe("rust");
  });

  it("changes inside the pill (Wrap shown, Copied, menu open) don't redraw the block", async () => {
    const { root } = makeEditor([html()]);
    const toolbar = root.querySelector(".sb-code-toolbar")!;
    const pre = root.querySelector("pre")!;
    // A line too long → Wrap appears; the pill's own DOM changes.
    Object.defineProperty(pre, "scrollWidth", { configurable: true, value: 900 });
    Object.defineProperty(pre, "clientWidth", { configurable: true, value: 400 });
    pre.dispatchEvent(new Event("pointerenter"));
    (root.querySelector("button.sb-code-lang") as HTMLButtonElement).click();
    toolbar.querySelector(".sb-code-btn")!.innerHTML = "<span>Copied</span>";
    // Let ProseMirror's DOM observer see those mutations.
    await new Promise((r) => setTimeout(r, 50));
    expect(root.querySelector(".sb-code-toolbar")).toBe(toolbar);
    expect(root.querySelector("pre")).toBe(pre);
  });

  it("filterLanguages matches names, ids and aliases, best first", () => {
    expect(filterLanguages("ts")).toContain("typescript");
    expect(filterLanguages("c")[0]).toBe("c");
    expect(filterLanguages("")).toHaveLength(Object.keys(CODE_LANGUAGES).length);
  });

  it("Copy writes the code and says Copied", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => { copied = t; } },
    });
    const { root } = makeEditor([html()]);
    const copy = root.querySelector('[aria-label="Copy code"]') as HTMLButtonElement;
    copy.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(copied).toBe('<div class="card">Hi</div>');
    expect(copy.textContent).toBe("Copied");
  });

  it("Wrap shows only for lines too long for the box, and toggles the prop", () => {
    const { root, editor } = makeEditor([html()]);
    const wrapBtn = () => root.querySelector(".sb-code-btn[aria-pressed]") as HTMLButtonElement;
    expect(wrapBtn().hidden).toBe(true);
    const pre = root.querySelector("pre")!;
    Object.defineProperty(pre, "scrollWidth", { configurable: true, value: 900 });
    Object.defineProperty(pre, "clientWidth", { configurable: true, value: 400 });
    pre.dispatchEvent(new Event("pointerenter"));
    expect(wrapBtn().hidden).toBe(false);
    wrapBtn().click();
    expect((editor.document[0].props as AnyBlock).wrap).toBe(true);
    expect(root.querySelector("pre")!.classList.contains("sb-code-wrap")).toBe(true);
    // Once on, it stays offered so it can be turned off.
    expect(wrapBtn().hidden).toBe(false);
    expect(wrapBtn().getAttribute("aria-label")).toBe("Unwrap code");
    wrapBtn().click();
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

  it("read-only: language as plain text and Copy, no menu and no Wrap", () => {
    const schema = BlockNoteSchema.create({
      blockSpecs: { ...defaultBlockSpecs, codeBlock: createNotionCodeBlockSpec() },
    });
    const editor = BlockNoteEditor.create({ schema, initialContent: [html()] });
    editor.isEditable = false;
    const root = document.createElement("div");
    editor.mount(root);
    expect(root.querySelector(".sb-code-lang")!.textContent).toBe("HTML");
    expect(root.querySelector("button.sb-code-lang")).toBeNull();
    expect(root.querySelector('[aria-label="Copy code"]')).toBeTruthy();
    expect(root.querySelector(".sb-code-btn[aria-pressed]")).toBeNull();
  });

  it("```lang + space makes a code block with the caret inside, even with a block after it", () => {
    const { editor } = makeEditor([
      { type: "paragraph", content: "```py" },
      { type: "paragraph", content: "after" },
      // The trailing empty block BlockNote would otherwise add (with a late id) on first edit.
      { type: "paragraph" },
    ]);
    editor.setTextCursorPosition(editor.document[0], "end");
    const view = editor.prosemirrorView!;
    const { from, to } = view.state.selection;
    // What a typed space does: every plugin's handleTextInput gets a turn.
    view.someProp("handleTextInput", (f: AnyBlock) => f(view, from, to, " ", () => view.state.tr.insertText(" ", from, to)));
    expect(editor.document[0]).toMatchObject({ type: "codeBlock", props: { language: "python" } });
    expect(editor.getTextCursorPosition().block.id).toBe(editor.document[0].id);
    view.dispatch(view.state.tr.insertText("x = 1"));
    expect(editor.document[0].content).toMatchObject([{ text: "x = 1" }]);
    expect(editor.document[1].content).toMatchObject([{ text: "after" }]);
  });
});
