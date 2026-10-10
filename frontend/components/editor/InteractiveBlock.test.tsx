import { describe, expect, it, vi } from "vitest";
import { insertInteractiveBlock, legacyInteractive } from "./InteractiveBlock";

describe("legacyInteractive (the old localStorage list)", () => {
  it("reads title/html pairs and ignores garbage", () => {
    expect(legacyInteractive(JSON.stringify([{ title: "Quiz", html: "<p>x</p>" }, { html: "<b>y</b>" }, { title: 5 }, null, "str"])))
      .toEqual([{ title: "Quiz", html: "<p>x</p>" }, { title: "Knowledge Check", html: "<b>y</b>" }]);
    expect(legacyInteractive(null)).toEqual([]);
    expect(legacyInteractive("not json")).toEqual([]);
    expect(legacyInteractive("{}")).toEqual([]);
  });
});

describe("insertInteractiveBlock", () => {
  it("goes after the given block, else the end, else into an empty document", () => {
    const ed = { document: [{ id: "a" }, { id: "b" }], insertBlocks: vi.fn(), replaceBlocks: vi.fn() };
    insertInteractiveBlock(ed, "a", { title: "T", html: "<p/>" });
    expect(ed.insertBlocks).toHaveBeenCalledWith([{ type: "interactive", props: { title: "T", html: "<p/>" } }], "a", "after");
    insertInteractiveBlock(ed, undefined);
    expect(ed.insertBlocks.mock.calls[1][1]).toBe("b");
    const empty = { document: [], insertBlocks: vi.fn(), replaceBlocks: vi.fn() };
    insertInteractiveBlock(empty, undefined);
    expect(empty.replaceBlocks).toHaveBeenCalled();
  });
});
