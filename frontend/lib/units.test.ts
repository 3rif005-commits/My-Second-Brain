// @vitest-environment jsdom
// A worksheet solved unit by unit (lib/units.ts). The skeleton and one written
// exercise are the backend's own output (fixtures written from
// backend/tests/test_units.py's plan), parsed the way BlockEditor's
// parseDraftHtml does — so a key pinned here is pinned the same way live.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug)
import { BlockNoteEditor } from "@blocknote/core";
import { multiColSchema } from "@/components/editor/noteSchema";
import {
  attachCalloutChildren, extractCalloutChildren, inlineMathInTableCells, mergeRedundantToggleHeadings,
} from "@/components/editor/calloutChildren";
import { extractEmbeddedBlocks, restoreEmbeddedBlocks } from "@/lib/embeddedBlocks";
import {
  bindUnits, headingBlocks, isUntouchedSkeleton, markOf, progress, readDraftUnits, unitPassages,
  type Unit,
} from "./units";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

const fixture = (name: string) =>
  readFileSync(join(__dirname, "..", "components", "editor", "fixtures", name), "utf8");

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

const text = (b: AnyBlock) => (Array.isArray(b.content) ? b.content.map((c: AnyBlock) => c.text ?? "").join("") : "");

let skeleton: AnyBlock[];
let skeletonHtml: string;

beforeAll(async () => {
  skeletonHtml = fixture("worksheet-skeleton.html");
  skeleton = await parseDraft(skeletonHtml);
});

describe("the skeleton, put into a note", () => {
  it("pins every key to the heading it was written on", () => {
    const pairs = bindUnits(skeleton, readDraftUnits(skeletonHtml));
    const byKey = new Map(pairs.map((p) => [p.key, p.block_id]));
    expect([...byKey.keys()]).toEqual(["", "1", "1.1", "1.2", "2", "revision"]);
    const heads = new Map(headingBlocks(skeleton).map((h) => [h.id, h]));
    expect(text(heads.get(byKey.get("1")!))).toBe("Exercise 01 · Laser beam");
    expect(text(heads.get(byKey.get("1.2")!))).toBe("(b) Intensity");
    expect(text(heads.get(byKey.get("revision")!))).toBe("Revision sheet");
  });

  it("nests questions inside their exercise's toggle heading", () => {
    const ex = headingBlocks(skeleton).find((h) => text(h) === "Exercise 01 · Laser beam");
    expect(ex.props.isToggleable).toBe(true);
    expect(headingBlocks(ex.children).map(text)).toEqual(["(a) Frequency", "(b) Intensity"]);
  });

  it("is untouched until the user types in it", () => {
    const ex = headingBlocks(skeleton).find((h) => text(h) === "Exercise 01 · Laser beam");
    expect(isUntouchedSkeleton(ex)).toBe(true);
    const edited = structuredClone(ex);
    edited.children[1].children.push({ type: "paragraph", content: [{ type: "text", text: "my own working", styles: {} }], children: [] });
    expect(isUntouchedSkeleton(edited)).toBe(false);
  });
});

describe("a written exercise, filled into its heading", () => {
  it("brings its keys with it, so the marks follow the new blocks", async () => {
    const html = fixture("worksheet-unit.html");
    const blocks = await parseDraft(html);
    const pairs = bindUnits(blocks, readDraftUnits(html));
    expect(pairs.map((p) => p.key)).toEqual(["1", "1.1", "1.2"]);
    expect(isUntouchedSkeleton(blocks[0])).toBe(false);    // it holds answers now
  });
});

const unit = (key: string, over: Partial<Unit> = {}): Unit => ({
  key, parent_key: key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "", depth: key.split(".").length + 1,
  label: "", title: `Q${key}`, question: "", quote: "", page: null, kind: "", rules: [], importance: "",
  state: "written", problems: [], block_id: `b${key}`, pending: false, resource_id: null,
  position: Number(key.replace(/\./g, "")) || 0, ...over,
});

describe("progress and marks", () => {
  const units = [unit("", { parent_key: null }), unit("1"), unit("1.1", { state: "checked" }),
    unit("1.2", { state: "flagged", problems: ["no answer band"] }), unit("2", { state: "planned" })];

  it("counts answers, not exercises", () => {
    const p = progress(units);
    expect(p).toMatchObject({ total: 3, checked: 1, toLook: 1, written: 2 });
    expect(p.next?.key).toBe("1.2");                     // what to look at comes first
  });

  it("gives an exercise the worst mark of its answers", () => {
    expect(markOf(units[1], units)).toEqual({ kind: "flagged", problems: ["no answer band"] });
    expect(markOf(units[2], units).kind).toBe("checked");
    expect(markOf({ ...units[2], pending: true }, units).kind).toBe("pending");
  });

  it("tints each question's own words in its page of the sheet", () => {
    const withQuote = [unit("1.1", { quote: "Find  the frequency", resource_id: "r1", page: 2 }), unit("1.2")];
    expect(unitPassages(withQuote)).toEqual([{ resourceId: "r1", page: 2, text: "Find the frequency" }]);
  });
});
