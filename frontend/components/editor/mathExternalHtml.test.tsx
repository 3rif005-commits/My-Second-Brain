// @vitest-environment jsdom
// The editor AI (xl-ai) sends the note as blocksToHTMLLossy. Formulas used to
// go as full KaTeX markup: a note full of maths came to 262k+ tokens and
// Nemotron refused it ("Oops! Something went wrong", live 2026-11-23).
import { describe, it, expect } from "vitest";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug)
import { BlockNoteEditor } from "@blocknote/core";
import { multiColSchema } from "./noteSchema";

describe("formulas outside the editor", () => {
  it("are their LaTeX, compact, and parse back into formulas", async () => {
    const editor = BlockNoteEditor.create({ schema: multiColSchema });
    editor.mount(document.createElement("div"));
    const latex = "\\hat R_{yu}(\\tau) = \\frac{1}{N}\\sum_{t=\\tau}^{N-1} y(t)u(t-\\tau)";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { type: "paragraph", content: [{ type: "text", text: "Rule ", styles: {} },
        { type: "inlineMath", props: { latex } }] },
      { type: "math", props: { latex } },
    ];
    const html: string = await editor.blocksToHTMLLossy(blocks);
    expect(html).not.toContain("katex");
    expect(html.length).toBeLessThan(400);
    const back = (await editor.tryParseHTMLToBlocks(html)) as any[];
    expect(back[0].content[1]).toMatchObject({ type: "inlineMath", props: { latex } });
    expect(back[1]).toMatchObject({ type: "math", props: { latex } });
  });
});
