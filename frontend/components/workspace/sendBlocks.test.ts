import { describe, expect, it } from "vitest";
import { hasContent, pageOfNode, textBlocks } from "./sendBlocks";

const ctx = { noteId: "n1", resourceId: "r1" };

describe("textBlocks", () => {
  it("text with a page becomes quotes plus a page pill that jumps back", () => {
    const b = textBlocks("First idea.\n\nSecond idea.", 12, ctx);
    expect(b.map((x) => x.type)).toEqual(["quote", "quote", "checkpoint"]);
    expect(b[2].props).toEqual({ noteId: "n1", resourceId: "r1", anchorType: "page", value: "12", label: "p. 12" });
  });
  it("text without a page stays plain paragraphs, as before", () => {
    expect(textBlocks("Just text.", undefined, ctx)).toEqual([{ type: "paragraph", content: "Just text." }]);
  });
  it("ignores empty text and bad pages", () => {
    expect(textBlocks("  \n\n ", 3, ctx)).toEqual([]);
    expect(textBlocks("x", 0, ctx)[0].type).toBe("paragraph");
    expect(textBlocks("x", NaN, ctx)[0].type).toBe("paragraph");
  });
});

describe("pageOfNode", () => {
  it("finds the page box around a text node", () => {
    document.body.innerHTML = '<div data-page="7"><span><b id="t">hello</b></span></div>';
    expect(pageOfNode(document.getElementById("t")!.firstChild)).toBe(7);
    expect(pageOfNode(document.body)).toBeUndefined();
    expect(pageOfNode(null)).toBeUndefined();
  });
});

describe("hasContent", () => {
  const empty = { type: "paragraph", content: [], children: [] };
  it("treats blank paragraphs as empty", () => {
    expect(hasContent([])).toBe(false);
    expect(hasContent([empty, { ...empty, content: [{ type: "text", text: "  " }] }])).toBe(false);
  });
  it("counts captured media with no text as content", () => {
    expect(hasContent([empty, { type: "image", props: { url: "u", caption: "" }, children: [] }])).toBe(true);
    expect(hasContent([{ type: "video", props: {}, children: [] }])).toBe(true);
    expect(hasContent([{ type: "audio", props: {}, children: [] }])).toBe(true);
  });
  it("counts text, inline links and nested children", () => {
    expect(hasContent([{ ...empty, content: [{ type: "text", text: "hi" }] }])).toBe(true);
    expect(hasContent([{ ...empty, content: [{ type: "link", content: [] }] }])).toBe(true);
    expect(hasContent([{ ...empty, children: [{ type: "image", props: {} }] }])).toBe(true);
  });
});
