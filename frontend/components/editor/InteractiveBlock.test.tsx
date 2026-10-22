// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { insertInteractiveBlock, legacyInteractive, planLegacyMigration, migrationSaved } from "./InteractiveBlock";

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

describe("InteractiveBlockSpec in a real editor", () => {
  it("is registered, holds title/html/snapshot props and round-trips through the document", async () => {
    const { BlockNoteSchema, defaultBlockSpecs, BlockNoteEditor } = await import("@blocknote/core");
    const { InteractiveBlockSpec } = await import("./InteractiveBlock");
    const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, interactive: InteractiveBlockSpec() } });
    const editor = BlockNoteEditor.create({ schema });
    editor.mount(document.createElement("div"));
    editor.replaceBlocks(editor.document, [{ type: "interactive", props: { title: "Q", html: "<b>x</b>" } }] as never);
    const b = editor.document.find((x) => x.type === "interactive") as { props: { title: string; html: string } } | undefined;
    expect(b?.props).toEqual({ title: "Q", html: "<b>x</b>", snapshot: "" });
    insertInteractiveBlock(editor, undefined);
    expect(editor.document.filter((x) => x.type === "interactive")).toHaveLength(2);
    expect((editor.document.find((x) => x.type === "interactive") as { props: { html: string } }).props.html).toBe("<b>x</b>");
  });
});

describe("planLegacyMigration / migrationSaved", () => {
  it("covers every branch", () => {
    const doc = [{ type: "interactive", props: { html: "<p>q</p>" } }];
    expect(planLegacyMigration(null, [])).toEqual({ action: "clear", fresh: [] });
    expect(planLegacyMigration("[]", [])).toEqual({ action: "clear", fresh: [] });
    expect(planLegacyMigration("oops", [])).toEqual({ action: "keep", fresh: [] });
    expect(planLegacyMigration("{}", [])).toEqual({ action: "keep", fresh: [] });
    expect(planLegacyMigration('[5,"x"]', [])).toEqual({ action: "keep", fresh: [] });
    expect(planLegacyMigration('[{"html":"<p>q</p>"}]', doc).action).toBe("clear");
    expect(planLegacyMigration('[{"html":"<i/>"}]', doc)).toEqual({ action: "insert", fresh: [{ title: "Knowledge Check", html: "<i/>" }] });
    expect(migrationSaved(["<p>q</p>"], doc)).toBe(true);
    expect(migrationSaved(["<p>q</p>", "<i/>"], doc)).toBe(false);
  });
});

describe("InteractiveBlockSpec export (Export as Markdown)", () => {
  it("writes the block's content, not its toolbar", async () => {
    const { BlockNoteSchema, defaultBlockSpecs, BlockNoteEditor } = await import("@blocknote/core");
    const { InteractiveBlockSpec } = await import("./InteractiveBlock");
    const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, interactive: InteractiveBlockSpec() } });
    const editor = BlockNoteEditor.create({ schema });
    editor.mount(document.createElement("div"));
    editor.replaceBlocks(editor.document, [
      { type: "interactive", props: { title: "Flow", html: "flowchart LR\n  A --> B" } },
      { type: "interactive", props: { title: "Heart", html: "https://x.supabase.co/heart.glb" } },
      { type: "interactive", props: { title: "Quiz", html: "<button>Go</button>" } },
    ] as never);
    const md = await editor.blocksToMarkdownLossy(editor.document);
    expect(md).toContain("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(md).toContain("[Heart](https://x.supabase.co/heart.glb)");
    expect(md).toContain("*[Interactive block: Quiz]*");
    expect(md).not.toMatch(/Preview|Code|AI|⤓/);
  });
});
