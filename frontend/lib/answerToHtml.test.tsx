// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { answerToHtml, resolveCitations } from "./answerToHtml";
import type { Citation } from "./workspace";

const C: Citation[] = [
  { n: 1, resource_id: "r1", title: "Lecture 10", anchor_type: "page", anchor_start: 3, anchor_end: 3 },
  { n: 2, resource_id: "r2", title: "Lecture 11", anchor_type: "page", anchor_start: 7, anchor_end: 7 },
];

describe("an answer, ready for the note", () => {
  it("turns [n] markers into the source they point at", () => {
    const out = resolveCitations("Q-values update each step [1][2].", C);
    expect(out).toContain("Lecture 10");
    expect(out).toContain("Lecture 11");
    expect(out).not.toMatch(/\[\d\]/);
  });

  it("drops a marker that points nowhere, and leaves links alone", () => {
    expect(resolveCitations("claim [9].", C)).toBe("claim.");
    expect(resolveCitations("see [1](https://x.y)", C)).toBe("see [1](https://x.y)");
  });

  it("renders Markdown as HTML the editor can take", () => {
    const html = answerToHtml("## Key idea\n\n- **Reward** drives learning [1]\n\n| a | b |\n|---|---|\n| 1 | 2 |", C);
    expect(html).toContain("<h2>Key idea</h2>");
    expect(html).toContain("<strong>Reward</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("Lecture 10");
  });
});

import { extractEmbeddedBlocks, restoreEmbeddedBlocks, embedBlocksHtml } from "./embeddedBlocks";
import { insertBlocks, previewInserts, type SourceInsert } from "./sourceInserts";

const NOTE = "note-1";
const FIG: SourceInsert = { token: "[[src:a1b2c3]]", kind: "figure", source_id: "r1", note_id: NOTE,
  title: "Lecture 10", anchor_type: "page", value: 7, label: "p. 7", url: "https://signed/fig", caption: "" };

function embeddedOf(html: string) {
  return extractEmbeddedBlocks(html).embedded;
}

describe("citations become jump-back pills on insert", () => {
  it("puts a page pill after the paragraph that cites it, once per place", () => {
    const html = answerToHtml("Q-values update [1][2]. Again [1].", C, [], NOTE);
    expect(html).not.toMatch(/\[\d\]|\[\[cite/);
    const [pills] = embeddedOf(html);
    expect(pills.map((b) => b.type)).toEqual(["checkpoint", "checkpoint"]);
    expect(pills[0].props).toMatchObject({ noteId: NOTE, resourceId: "r1", anchorType: "page", value: "3" });
  });

  it("keeps a brought-in note's citation as words", () => {
    const notes: Citation[] = [{ n: 1, resource_id: "n9", kind: "note", note_id: "n9", title: "My RL note",
      anchor_type: "section", anchor_start: 0, anchor_end: 0 }];
    const html = answerToHtml("Claim [1].", notes, [], NOTE);
    expect(html).toContain("My RL note (note)");
    expect(embeddedOf(html)).toEqual([]);
  });
});

describe("source tokens become the real blocks", () => {
  it("replaces a token's own paragraph with the figure and its page pill", () => {
    const html = answerToHtml("The diagram:\n\n[[src:a1b2c3]]\n\nThat's it.", [], [FIG], NOTE);
    const { html: stripped, embedded } = extractEmbeddedBlocks(html);
    expect(embedded[0].map((b) => b.type)).toEqual(["image", "checkpoint"]);
    expect(embedded[0][0].props.url).toBe("https://signed/fig");
    // in place, between the two paragraphs; no empty paragraph left behind
    expect(stripped.indexOf("The diagram")).toBeLessThan(stripped.indexOf("⟦sb:0⟧"));
    expect(stripped.indexOf("⟦sb:0⟧")).toBeLessThan(stripped.indexOf("That's it"));
    expect(stripped).not.toContain("<p></p>");
  });

  it("drops a token nothing stands for", () => {
    expect(answerToHtml("x\n\n[[src:ffffff]]", [], [], NOTE)).not.toContain("src:");
  });

  it("round-trips embedded blocks through the editor's parse step", () => {
    const blocks = [{ type: "math", props: { latex: "a<b & \"c\"" } }];
    const { html, embedded } = extractEmbeddedBlocks(`<p>a</p>${embedBlocksHtml(blocks)}`);
    expect(embedded[0]).toEqual(blocks);
    const parsed = [{ type: "paragraph", content: [{ type: "text", text: "a" }] },
                    { type: "paragraph", content: [{ type: "text", text: html.match(/⟦sb:0⟧/)![0] }] }];
    expect(restoreEmbeddedBlocks(parsed, embedded).map((b) => b.type)).toEqual(["paragraph", "math"]);
  });

  it("builds every kind the viewer buttons build", () => {
    const base = { token: "[[src:000000]]", source_id: "r1", note_id: NOTE, title: "T" } as const;
    expect(insertBlocks({ ...base, kind: "quote", text: "words", anchor_type: "page", value: 3, label: "p. 3" })
      .map((b) => b.type)).toEqual(["quote", "checkpoint"]);
    expect(insertBlocks({ ...base, kind: "table", markdown: "| a |\n|---|\n| 1 |" })[0].type).toBe("table");
    expect(insertBlocks({ ...base, kind: "formula", latex: "x^2" })[0]).toMatchObject({ type: "math", props: { latex: "x^2" } });
    expect(insertBlocks({ ...base, kind: "clip", url: "u", anchor_type: "time", value: 720 })
      .map((b) => b.type)).toEqual(["video", "checkpoint"]);
    expect(insertBlocks({ ...base, kind: "audio", url: "u" })[0].type).toBe("audio");
    expect(insertBlocks({ ...base, kind: "frame", url: "u" })[0].type).toBe("image");
  });

  it("shows a token in the chat bubble as what it will become", () => {
    const md = previewInserts("See:\n\n[[src:a1b2c3]]", [FIG]);
    expect(md).toContain("![Lecture 10](https://signed/fig)");
    expect(md).not.toContain("[[src:");
  });
});
