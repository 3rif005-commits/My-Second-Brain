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
  const toggleHeadings = (level: number) =>
    all.filter((b) => b.type === "heading" && b.props.level === level && b.props.isToggleable);

  it("opens with the title and a collapsible Overview box", () => {
    expect(blocks[0]).toMatchObject({ type: "heading", props: { level: 1 } });
    expect(blocks[1]).toMatchObject({ type: "callout", props: { calloutType: "OVERVIEW" } });
  });

  it("nests exercise → question → part as smaller and smaller toggle headings", () => {
    const top = blocks.filter((b) => b.type === "heading" && b.props.isToggleable);
    expect(top.map((b) => [b.props.level, text(b)])).toEqual(
      [[2, "Exercise 01 · Laser beam"], [2, "Exercise 02 · Unit of momentum"]]);
    const ex1 = top[0];
    const questions = ex1.children.filter((b: AnyBlock) => b.type === "heading");
    expect(questions.map((b: AnyBlock) => [b.props.level, b.props.isToggleable, text(b)])).toEqual(
      [[3, true, "Frequency and intensity"], [3, true, "Field amplitudes"]]);
    const parts = questions[0].children.filter((b: AnyBlock) => b.type === "heading");
    expect(parts.map((b: AnyBlock) => [b.props.level, b.props.isToggleable, text(b)])).toEqual(
      [[4, true, "(a) Frequency"], [4, true, "(b) Intensity"]]);
    // the deepest level is a plain toggle with no heading
    const solution = parts[1].children.find((b: AnyBlock) => b.type === "toggleListItem");
    expect(text(solution)).toBe("Solution");
  });

  it("encodes importance on question headings only", () => {
    const hl = (b: AnyBlock) => inline(b)[0]?.styles?.backgroundColor;
    expect(toggleHeadings(2).map(hl)).toEqual([undefined, undefined]);
    expect(toggleHeadings(3).map(hl)).toEqual(["orange", "red"]);
    expect(all.filter((b) => b.type === "heading").every((b) => b.props.backgroundColor === "default")).toBe(true);
  });

  it("opens each question with an Insight quote, no formula, and the question in grey", () => {
    const quotes = all.filter((b) => b.type === "quote");
    expect(quotes).toHaveLength(3);                          // two questions of Ex. 01, Ex. 02
    for (const q of quotes) expect(inline(q)[0]).toMatchObject({ text: "Insight:", styles: { bold: true } });
    expect(all.some((b) => /Goal:/.test(text(b)))).toBe(false);
    const grey = all.filter((b) => b.type === "paragraph" && inline(b)[0]?.styles?.textColor === "gray");
    expect(grey.length).toBeGreaterThanOrEqual(4);
  });

  it("names the rule used by every answer, with its formula alone on the next line", () => {
    const rules = all.filter((b) => b.type === "paragraph" && /^Rules?:/.test(text(b)));
    expect(rules).toHaveLength(4);                           // 01a, 01b, fields, 02
    for (const r of rules) {
      const siblings = all.find((p) => (p.children ?? []).includes(r))?.children ?? blocks;
      expect(siblings[siblings.indexOf(r) + 1].type).toBe("math");
    }
  });

  it("puts each answer in a green band, and nothing else is green", () => {
    const green = all.filter((b) => b.props?.backgroundColor === "green");
    expect(green).toHaveLength(4);
    for (const b of green) expect(inline(b)[0]).toMatchObject({ text: "Answer:", styles: { bold: true } });
  });

  it("keeps steps to one line each, and leaves no dollar sign behind", () => {
    const steps = all.filter((b) => b.type === "numberedListItem");
    expect(steps.length).toBeGreaterThan(0);
    for (const st of steps) expect(text(st)).toContain("→");
    expect(all.filter((b) => text(b).includes("$")).map(text)).toEqual([]);
  });

  it("colours each rule box by importance and marks it with the formula icon", () => {
    const boxes = all.filter((b) => b.type === "callout" && b.props.calloutIcon === "📐");
    expect(boxes.map((b) => b.props.calloutType)).toEqual(["CAUTION", "WARNING", "IMPORTANT", "OVERVIEW"]);
  });

  it("ends with the answer key", () => {
    const tables = blocks.filter((b) => b.type === "table");
    expect(tables).toHaveLength(1);
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
