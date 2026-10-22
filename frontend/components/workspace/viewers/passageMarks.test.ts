import { describe, expect, it } from "vitest";
import { markTextRun, passagesByPage, quotedPassages } from "./passageMarks";
import { textBlocks } from "../sendBlocks";

const ctx = { noteId: "n1", resourceId: "r1" };

describe("quotedPassages", () => {
  it("reads back what Send to note wrote: quotes before a page pill", () => {
    const blocks = [{ type: "paragraph", content: "mine" }, ...textBlocks("First part\n\nSecond   part", 4, ctx)];
    expect(quotedPassages(blocks)).toEqual([
      { resourceId: "r1", page: 4, text: "Second part" },
      { resourceId: "r1", page: 4, text: "First part" },
    ]);
  });
  it("a quote the user deleted is no longer a passage; plain quotes are not passages", () => {
    const blocks = [{ type: "quote", content: [{ type: "text", text: "my own quote" }] }, { type: "paragraph", content: "x" },
      ...textBlocks("kept", 2, ctx).slice(1)]; // the quote removed, the pill left
    expect(quotedPassages(blocks)).toEqual([]);
  });
  it("finds passages inside nested blocks and tolerates junk", () => {
    expect(quotedPassages([{ type: "toggleListItem", children: textBlocks("deep", 1, ctx) }])).toHaveLength(1);
    expect(quotedPassages(null)).toEqual([]);
    expect(quotedPassages([null, { type: "checkpoint" }])).toEqual([]);
  });
});

describe("markTextRun", () => {
  const P = ["The gradient points uphill, so we step against it to reduce the loss."];
  it("marks a run that lies inside a passage", () => {
    expect(markTextRun("so we step against it", P)).toBe('<mark class="sb-passage">so we step against it</mark>');
  });
  it("marks only the passage's start at a run's end, and its end at a run's start", () => {
    expect(markTextRun("Recall that The gradient points uphill,", P))
      .toBe('Recall that <mark class="sb-passage">The gradient points uphill,</mark>');
    expect(markTextRun("reduce the loss. Next we", P))
      .toBe('<mark class="sb-passage">reduce the loss.</mark> Next we');
  });
  it("marks a short passage inside a run", () => {
    expect(markTextRun("we call it the learning rate here", ["learning rate"]))
      .toBe('we call it the <mark class="sb-passage">learning rate</mark> here');
  });
  it("leaves unrelated and tiny runs alone, escaped", () => {
    expect(markTextRun("a < b & c", P)).toBe("a &#60; b &#38; c");
    expect(markTextRun("so", P)).toBe("so");
    expect(markTextRun("we step against", [])).toBe("we step against");
  });
});

describe("passagesByPage", () => {
  it("keeps one source's passages, grouped by page", () => {
    const m = passagesByPage([{ resourceId: "r1", page: 2, text: "a" }, { resourceId: "r2", page: 2, text: "b" },
      { resourceId: "r1", page: 2, text: "c" }], "r1");
    expect([...m.entries()]).toEqual([[2, ["a", "c"]]]);
  });
});
