import { describe, expect, it } from "vitest";
import { restoreUnknown, unknownTypeOf, UNKNOWN_BLOCK_TYPE, wrapUnknown } from "./unknownBlocks";

const KNOWN = new Set(["paragraph", "toggleListItem", UNKNOWN_BLOCK_TYPE]);

const flashcard = {
  id: "f1",
  type: "flashcard",
  props: { front: "Q", back: "A" },
  content: [],
  children: [{ id: "c1", type: "paragraph", content: [{ type: "text", text: "inside", styles: {} }], children: [] }],
};

describe("wrapUnknown / restoreUnknown", () => {
  it("round-trips an unknown block, children included, byte for byte", () => {
    const doc = [{ id: "p1", type: "paragraph", content: [], children: [] }, flashcard];
    const wrapped = wrapUnknown(doc, KNOWN);
    expect(wrapped[1].type).toBe(UNKNOWN_BLOCK_TYPE);
    expect(wrapped[1].id).toBe("f1");
    expect(wrapped[1].children).toEqual([]);
    expect(restoreUnknown(wrapped)).toEqual(doc);
  });

  it("wraps unknown blocks nested inside known ones and restores them in place", () => {
    const doc = [{ id: "t1", type: "toggleListItem", content: [], children: [flashcard] }];
    const wrapped = wrapUnknown(doc, KNOWN);
    expect(wrapped[0].children[0].type).toBe(UNKNOWN_BLOCK_TYPE);
    expect(restoreUnknown(wrapped)).toEqual(doc);
  });

  it("drops null entries, which are not data", () => {
    expect(wrapUnknown([null, { type: "paragraph", children: [] }], KNOWN)).toHaveLength(1);
  });

  it("keeps a placeholder whose JSON is unreadable rather than losing it", () => {
    const broken = { type: UNKNOWN_BLOCK_TYPE, props: { original: "{not json" }, children: [] };
    expect(restoreUnknown([broken])).toEqual([broken]);
  });

  it("leaves a document with no unknown blocks unchanged", () => {
    const doc = [{ id: "p1", type: "paragraph", content: [], children: [] }];
    expect(restoreUnknown(wrapUnknown(doc, KNOWN))).toEqual(doc);
  });

  it("names the original type for the label", () => {
    expect(unknownTypeOf(JSON.stringify(flashcard))).toBe("flashcard");
    expect(unknownTypeOf("nope")).toBe("unknown");
  });
});
