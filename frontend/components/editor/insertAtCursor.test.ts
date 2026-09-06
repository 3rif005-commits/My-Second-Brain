// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { blockExists, insertionTarget } from "./insertAtCursor";

const doc = [
  { id: "a" },
  { id: "b", children: [{ id: "b1" }, { id: "b2", children: [{ id: "b2a" }] }] },
  { id: "c" },
];

describe("blockExists", () => {
  it("finds a top-level block", () => expect(blockExists(doc, "a")).toBe(true));
  it("finds a block nested inside a toggle", () => expect(blockExists(doc, "b1")).toBe(true));
  it("finds a block nested two levels down", () => expect(blockExists(doc, "b2a")).toBe(true));
  it("does not find a deleted block", () => expect(blockExists(doc, "gone")).toBe(false));
});

describe("insertionTarget", () => {
  it("targets the block the user last had their cursor in", () => {
    expect(insertionTarget(doc, "a")).toBe("a");
  });

  it("targets a nested block, so a send lands inside the open toggle", () => {
    expect(insertionTarget(doc, "b2a")).toBe("b2a");
  });

  it("appends at the end when the editor was never focused — the old behaviour", () => {
    // getTextCursorPosition() would report the FIRST block here; appending is
    // the strictly better default, so a never-focused editor keeps it.
    expect(insertionTarget(doc, null)).toBe("c");
  });

  it("appends at the end when the remembered block has since been deleted", () => {
    expect(insertionTarget(doc, "gone")).toBe("c");
  });

  it("returns null on an empty document so the caller replaces instead", () => {
    expect(insertionTarget([], null)).toBeNull();
    expect(insertionTarget([], "gone")).toBeNull();
  });
});
