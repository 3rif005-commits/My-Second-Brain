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
  it("opens with the title and a collapsible Overview box", () => {
    expect(blocks[0]).toMatchObject({ type: "heading", props: { level: 1 } });
    expect(blocks[1]).toMatchObject({ type: "callout", props: { calloutType: "OVERVIEW" } });
    expect(blocks[1].children[0]).toMatchObject({ type: "toggleListItem" });
  });

  it("gives every question an h3, highlighted only when it is one to redo first", () => {
    const h3 = blocks.filter((b) => b.type === "heading" && b.props.level === 3);
    expect(h3.map(text)).toEqual([
      "Q1 · Ball dropped from a roof", "Q2 · Unit of momentum", "Q3 · Terminal speed with a parachute",
      "Rules & formulas", "Answer key",
    ]);
    const highlight = (b: AnyBlock) => inline(b)[0]?.styles?.backgroundColor;
    expect(h3.map(highlight)).toEqual(["red", undefined, "orange", undefined, undefined]);
    expect(h3.every((b) => b.props.backgroundColor === "default")).toBe(true);
  });

  it("puts only the goal in each quote, and the question below it in grey", () => {
    const quotes = all.filter((b) => b.type === "quote");
    expect(quotes).toHaveLength(3);
    for (const q of quotes) {
      expect(inline(q)[0]).toMatchObject({ text: "Goal:", styles: { bold: true } });
      expect(inline(q).some((c: AnyBlock) => c.type === "inlineMath")).toBe(false);   // no formula in a goal
    }
    const grey = all.filter((b) => b.type === "paragraph" && inline(b)[0]?.styles?.textColor === "gray");
    expect(grey).toHaveLength(5);                            // Q1 stem, 1(a), 1(b), Q2, Q3
  });

  it("names the rule used by every answer, with its formula alone on the next line", () => {
    const i = blocks.map((b, n) => (b.type === "paragraph" && /^Rules?:/.test(text(b)) ? n : -1)).filter((n) => n >= 0);
    expect(i).toHaveLength(4);                               // 1(a), 1(b), 2, 3
    for (const n of i) expect(blocks[n + 1].type).toBe("math");
  });

  it("separates questions with a divider", () => {
    expect(blocks.filter((b) => b.type === "divider")).toHaveLength(2);
  });

  it("puts each answer in a green band, and nothing else is green", () => {
    const green = all.filter((b) => b.props?.backgroundColor === "green");
    expect(green).toHaveLength(4);
    for (const b of green) {
      expect(b.type).toBe("paragraph");
      expect(inline(b)[0]).toMatchObject({ text: "Answer:", styles: { bold: true } });
    }
  });

  it("folds the working into a Solution toggle of one-line steps", () => {
    const solutions = all.filter((b) => b.type === "toggleListItem" && text(b) === "Solution");
    expect(solutions).toHaveLength(2);
    const steps = solutions[0].children.filter((b: AnyBlock) => b.type === "numberedListItem");
    expect(steps).toHaveLength(2);
    // one line per step: words, an arrow, the result as a formula
    for (const st of steps) {
      expect(text(st)).toContain("→");
      expect(inline(st).at(-1).type).toBe("inlineMath");
    }
    expect(text(solutions[0].children.at(-1))).toMatch(/^Check:/);
  });

  it("writes mid-sentence maths as real formulas, and leaves no dollar sign behind", () => {
    const withMath = all.filter((b) => inline(b).some((c: AnyBlock) => c.type === "inlineMath"));
    const kinds = new Set(withMath.map((b) => b.type));
    for (const k of ["paragraph", "numberedListItem", "table"]) expect(kinds).toContain(k);
    expect(all.filter((b) => text(b).includes("$")).map(text)).toEqual([]);
  });

  it("colours each rule box by importance and marks it with the formula icon", () => {
    const sheet = blocks.slice(blocks.findIndex((b) => text(b) === "Rules & formulas"));
    expect(text(sheet[1])).toBe("🟥 must know · 🟧 core · 🟨 needed · 🟦 supporting · ⬜ background");
    const boxes = sheet.filter((b) => b.type === "callout");
    expect(boxes.map((b) => [b.props.calloutType, b.props.calloutIcon])).toEqual(
      [["CAUTION", "📐"], ["WARNING", "📐"], ["OVERVIEW", "📐"]]);
    for (const b of boxes) expect(b.children.map((c: AnyBlock) => c.type)).toEqual(["paragraph", "math", "paragraph"]);
  });

  it("uses only real callout kinds inside the questions, with their bodies kept", () => {
    const callouts = all.filter((b) => b.type === "callout" && !b.props.calloutIcon);
    expect(callouts.map((c) => c.props.calloutType)).toEqual(["OVERVIEW", "TIP", "CAUTION", "EXAM"]);
    expect(callouts.every((c) => c.children.length > 0)).toBe(true);
  });

  it("ends with the answer key", () => {
    const tables = blocks.filter((b) => b.type === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0].content.rows).toHaveLength(5);         // header + 1(a), 1(b), 2, 3
    expect(blocks.at(-1)).toBe(tables[0]);
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
