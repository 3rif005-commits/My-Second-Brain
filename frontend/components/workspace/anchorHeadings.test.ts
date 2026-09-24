import { describe, it, expect } from "vitest";
import { findLevelHeadings } from "./anchorHeadings";

describe("findLevelHeadings", () => {
  it("returns top-level heading blocks at the given level, in order", () => {
    const blocks = [
      { id: "a", type: "heading", props: { level: 2 } },
      { id: "b", type: "heading", props: { level: 3 } },
      { id: "c", type: "paragraph", props: {} },
      { id: "d", type: "heading", props: { level: 3 } },
    ] as any;
    expect(findLevelHeadings(blocks, 3).map((b: any) => b.id)).toEqual(["b", "d"]);
  });

  it("defaults missing level to 1 and excludes it from a level-3 search", () => {
    const blocks = [{ id: "a", type: "heading", props: {} }] as any;
    expect(findLevelHeadings(blocks, 3)).toEqual([]);
  });
});

describe("draft anchors → note anchors", () => {
  it("pins each anchored h3 to its heading block, by source position", async () => {
    const { readDraftAnchors, anchorRows } = await import("./anchorHeadings");
    const html = '<h1>T</h1><h3 data-anchor="2:p:14">A</h3><h3>B</h3><h3 data-anchor="9:p:1">C</h3>';
    const anchors = readDraftAnchors(html);
    expect(anchors).toHaveLength(3);
    const blocks = [
      { id: "t", type: "heading", props: { level: 1 } },
      { id: "a", type: "heading", props: { level: 3 } },
      { id: "b", type: "heading", props: { level: 3 } },
      { id: "c", type: "heading", props: { level: 3 } },
    ];
    // source 9 does not exist: the model invented it, so it pins nothing
    expect(anchorRows(blocks, anchors, ["s1", "s2"])).toEqual([
      { block_id: "a", resource_id: "s2", anchor_type: "page", anchor_start: 14, anchor_end: 14 },
    ]);
  });
});
