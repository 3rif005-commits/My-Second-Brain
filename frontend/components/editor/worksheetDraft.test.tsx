// @vitest-environment jsdom
// The worksheet solver (backend/skills/solve-worksheet) writes the editor's HTML
// dialect. Its own example, finished by backend/services/workspace/skill_html.py,
// is fixtures/worksheet-solution.html (backend/tests/test_skill_html.py keeps the
// two in step). This parses it the way BlockEditor's parseDraftHtml does when a
// result is inserted, and checks every shape the skill promises becomes the
// block it is meant to be.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { BlockNoteEditor } from "@blocknote/core";
import { multiColSchema } from "./noteSchema";
import {
  attachCalloutChildren, extractCalloutChildren, inlineMathInTableCells, mergeRedundantToggleHeadings,
} from "./calloutChildren";
import { extractEmbeddedBlocks, restoreEmbeddedBlocks } from "@/lib/embeddedBlocks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

/** BlockEditor.tsx parseDraftHtml, step for step. */
async function parseDraft(draftHtml: string): Promise<AnyBlock[]> {
  const editor = BlockNoteEditor.create({ schema: multiColSchema });
  editor.mount(document.createElement("div"));
  const { html, embedded } = extractEmbeddedBlocks(draftHtml);
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const { strippedHtml, calloutChildren } = await extractCalloutChildren(
    mergeRedundantToggleHeadings(inlineMathInTableCells(doc.body.innerHTML)),
    async (h: string) => (await editor.tryParseHTMLToBlocks(h)) as AnyBlock[],
  );
  const raw = await editor.tryParseHTMLToBlocks(strippedHtml);
  return restoreEmbeddedBlocks(attachCalloutChildren(raw as AnyBlock[], calloutChildren), embedded);
}

const walk = (blocks: AnyBlock[]): AnyBlock[] =>
  blocks.flatMap((b) => [b, ...walk(b.children ?? [])]);
const inline = (b: AnyBlock): AnyBlock[] =>
  b.type === "table"
    ? b.content.rows.flatMap((r: AnyBlock) => r.cells.flatMap((c: AnyBlock) => c.content ?? []))
    : Array.isArray(b.content) ? b.content : [];
const text = (b: AnyBlock) => inline(b).map((c: AnyBlock) => c.text ?? "").join("");

let blocks: AnyBlock[];
let all: AnyBlock[];

beforeAll(async () => {
  blocks = await parseDraft(readFileSync(join(__dirname, "fixtures", "worksheet-solution.html"), "utf8"));
  all = walk(blocks);
});

describe("a worksheet solution, inserted into a note", () => {
  it("opens with the title and the module line, no overview box", () => {
    expect(blocks[0]).toMatchObject({ type: "heading", props: { level: 1 } });
    expect(blocks[1].type).toBe("paragraph");
    expect(text(blocks[1])).toMatch(/^Module:/);
  });

  it("gives every exercise an h3, coloured only by importance", () => {
    const h3 = blocks.filter((b) => b.type === "heading" && b.props.level === 3);
    expect(h3.map(text)).toEqual([
      "Exercise 1 · Car: acceleration, force and work", "Exercise 2 · Unit of momentum",
      "Exercise 3 · Terminal speed with a parachute",
    ]);
    const highlight = (b: AnyBlock) => inline(b)[0]?.styles?.backgroundColor;
    expect(h3.map(highlight)).toEqual(["orange", undefined, undefined]);
    // the colour is on the words, never on the block (which would tint what follows)
    expect(h3.every((b) => b.props.backgroundColor === "default")).toBe(true);
  });

  it("shows the course formula as a purple box with the equation inside", () => {
    const formulas = all.filter((b) => b.type === "callout" && b.props.calloutType === "FORMULA");
    expect(formulas).toHaveLength(4);
    for (const f of formulas) {
      expect(f.children.map((b: AnyBlock) => b.type)).toEqual(["paragraph", "math"]);
      expect(inline(f.children[0])[0]).toMatchObject({ text: "Formula:", styles: { bold: true } });
    }
  });

  it("puts each result in a green line, and nothing else is green", () => {
    const green = all.filter((b) => b.props?.backgroundColor === "green");
    expect(green).toHaveLength(4);
    for (const b of green) {
      expect(b.type).toBe("paragraph");
      expect(inline(b)[0]).toMatchObject({ text: "Result:", styles: { bold: true } });
    }
  });

  it("keeps two-step working visible and folds longer working into Steps", () => {
    expect(all.some((b) => b.type === "paragraph" && text(b).startsWith("Steps:"))).toBe(true);
    const folded = all.filter((b) => b.type === "toggleListItem" && text(b) === "Steps");
    expect(folded).toHaveLength(2);
    const steps = folded[0].children.filter((b: AnyBlock) => b.type === "numberedListItem");
    expect(steps).toHaveLength(3);
    expect(steps[2].children[0]?.type).toBe("math");
    expect(text(folded[0].children.at(-1))).toMatch(/^Check:/);
  });

  it("writes mid-sentence maths as real formulas: in Given, the result, steps and tables", () => {
    const withMath = all.filter((b) => inline(b).some((c: AnyBlock) => c.type === "inlineMath"));
    const kinds = new Set(withMath.map((b) => b.type));
    for (const k of ["paragraph", "numberedListItem", "table"]) expect(kinds).toContain(k);
    expect(all.filter((b) => text(b).includes("$")).map(text)).toEqual([]);
  });

  it("colours nothing inline except headings and results", () => {
    const coloured = all.flatMap((b) => inline(b)).filter((c: AnyBlock) => c.styles?.textColor);
    expect(coloured).toEqual([]);
  });

  it("uses only real callout kinds, the takeaway as the yellow box", () => {
    const callouts = all.filter((b) => b.type === "callout");
    expect(callouts.map((c) => c.props.calloutType)).toEqual(
      ["FORMULA", "FORMULA", "IMPORTANT", "FORMULA", "CAUTION", "FORMULA"]);
    expect(text(callouts[2].children[0])).toMatch(/^Takeaway:/);
  });

  it("ends with the answer key and nothing after it", () => {
    const tables = blocks.filter((b) => b.type === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0].content.rows).toHaveLength(5);         // header + 1a, 1b, 2, 3
    expect(blocks.at(-1)).toBe(tables[0]);
    expect(blocks.filter((b) => b.type === "heading" && b.props.level === 2).map(text)).toEqual(["Answer key"]);
  });
});

describe("a diagram in a worksheet solution", () => {
  it("arrives as a live diagram block, inside the toggle it was written in", async () => {
    // What skill_html.diagrams() makes of <pre><code class="language-mermaid">.
    const block = [{ type: "interactive", props: { title: "State diagram", html: "stateDiagram-v2\n  [*] --> Idle" } }];
    const attr = JSON.stringify(block).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const parsed = await parseDraft(
      `<details><summary>Solution</summary><p>Draw:</p><div data-sb-blocks="${attr}"></div></details>`);
    expect(parsed[0].type).toBe("toggleListItem");
    expect(parsed[0].children[1]).toMatchObject(block[0]);
  });
});
