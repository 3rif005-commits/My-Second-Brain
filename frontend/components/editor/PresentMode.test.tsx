import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PresentMode, slidesFromEditor, splitToFit } from "./PresentMode";

function block(type: string, text: string, level?: number) {
  const lvl = level ? ` data-level="${level}"` : "";
  return `<div class="bn-block-outer"><div class="bn-block"><div class="bn-block-content" data-content-type="${type}"${lvl}><p contenteditable="true">${text}</p></div></div></div>`;
}
function editorHtml(...blocks: string[]) {
  return `<div class="bn-editor" contenteditable="true"><div class="bn-block-group">${blocks.join("")}</div></div>`;
}

describe("slidesFromEditor", () => {
  it("title slide, then one slide per h1/h2, nothing editable", () => {
    document.body.innerHTML = editorHtml(
      block("paragraph", "intro"), block("heading", "Part A", 1), block("paragraph", "a1"),
      block("heading", "Detail", 3), block("heading", "Part B", 2), block("paragraph", "b1"));
    const slides = slidesFromEditor(document, "My note");
    expect(slides.map((s) => s.label)).toEqual(["My note", "Slide 2", "Part A", "Part B"]);
    expect(slides[2].html).toContain("a1");
    expect(slides[2].html).toContain("Detail");
    expect(slides.some((s) => s.html.includes("contenteditable"))).toBe(false);
  });
  it("skips empty slides", () => {
    document.body.innerHTML = editorHtml(block("paragraph", ""), block("heading", "Only", 1));
    expect(slidesFromEditor(document, "T").map((s) => s.label)).toEqual(["T", "Only"]);
  });
});

describe("splitToFit", () => {
  it("continues a slide too tall for the fit floor on a (cont.) slide", () => {
    // jsdom has no layout: every block gets a 400px box.
    const top = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return [...(this.parentElement?.children ?? [])].indexOf(this) * 400;
    });
    const sh = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.children.length * 400;
    });
    try {
      const slides = [{ html: "", label: "T" },
        { html: [1, 2, 3, 4, 5].map((n) => block("paragraph", `p${n}`)).join(""), label: "Long" },
        { html: block("paragraph", "short"), label: "Short" }];
      const out = splitToFit(slides, 800, 500); // holds 1000px at the 0.5 floor = 2 blocks
      expect(out.map((s) => s.label)).toEqual(["T", "Long", "Long (cont.)", "Long (cont.)", "Short"]);
      expect(out[3].html).toContain("p5");
    } finally { top.mockRestore(); sh.mockRestore(); }
  });
  it("without layout every slide stays whole", () => {
    const slides = [{ html: "", label: "T" }, { html: block("paragraph", "x"), label: "A" }];
    expect(splitToFit(slides, 800, 500)).toEqual(slides);
  });
});

describe("PresentMode", () => {
  it("moves with keys and leaves with Esc", () => {
    document.body.innerHTML = editorHtml(block("heading", "One", 1), block("heading", "Two", 1));
    const onClose = vi.fn();
    render(<PresentMode title="Deck" onClose={onClose} />);
    expect(screen.getByText("Deck")).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "3" });
    expect(screen.getByText("Go to slide 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText("3 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    return new Promise((r) => setTimeout(r, 0)).then(() => expect(onClose).toHaveBeenCalled());
  });
});
