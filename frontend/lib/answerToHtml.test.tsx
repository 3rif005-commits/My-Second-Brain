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
