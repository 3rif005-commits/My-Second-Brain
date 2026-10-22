import { describe, expect, it } from "vitest";
import { blocksToLatex, escapeTex } from "./latexExport";

const t = (text: string, styles = {}) => ({ type: "text", text, styles });

describe("escapeTex", () => {
  it("escapes every special character", () => {
    expect(escapeTex("50% of $x & y_1 #2 {a} ~^\\")).toBe(
      "50\\% of \\$x \\& y\\_1 \\#2 \\{a\\} \\textasciitilde{}\\textasciicircum{}\\textbackslash{}");
  });
});

describe("blocksToLatex", () => {
  const doc = [
    { type: "heading", props: { level: 1 }, content: [t("Entropy")] },
    { type: "paragraph", content: [t("It is "), t("disorder", { bold: true }), t(" in "), { type: "inlineMath", props: { latex: "S=k\\ln W" } }] },
    { type: "bulletListItem", content: [t("first")], children: [{ type: "bulletListItem", content: [t("nested")] }] },
    { type: "bulletListItem", content: [t("second")] },
    { type: "numberedListItem", content: [t("step")] },
    { type: "math", props: { latex: "\\Delta S \\ge 0" } },
    { type: "heading", props: { level: 3 }, content: [t("Table")] },
    { type: "table", content: { type: "tableContent", rows: [{ cells: [[t("a")], [t("b")]] }, { cells: [[t("1")]] }] } },
    { type: "codeBlock", content: [t("x = 1 % not a comment")] },
    { type: "image", props: { url: "https://e.com/p.png", caption: "Figure 1" } },
    { type: "checkpoint", props: { value: "3" } },
  ];
  const tex = blocksToLatex("My note", doc);
  it("is a complete document", () => {
    expect(tex.startsWith("\\documentclass")).toBe(true);
    expect(tex).toContain("\\title{My note}");
    expect(tex.trim().endsWith("\\end{document}")).toBe(true);
  });
  it("maps headings, styles, inline and display math", () => {
    expect(tex).toContain("\\section*{Entropy}");
    expect(tex).toContain("\\subsection*{Table}".replace("subsection", "subsubsection"));
    expect(tex).toContain("It is \\textbf{disorder} in $S=k\\ln W$");
    expect(tex).toContain("\\[\n\\Delta S \\ge 0\n\\]");
  });
  it("groups list items, nests children, separates list kinds", () => {
    expect(tex).toMatch(/\\begin\{itemize\}\n  \\item first\n\\begin\{itemize\}\n  \\item nested\n\\end\{itemize\}\n\n  \\item second\n\\end\{itemize\}/);
    expect(tex).toContain("\\begin{enumerate}\n  \\item step\n\\end{enumerate}");
  });
  it("tables pad rows; code stays verbatim; pictures become caption + link; checkpoints vanish", () => {
    expect(tex).toContain("\\begin{tabular}{|l|l|}");
    expect(tex).toContain("1 &  \\\\");
    expect(tex).toContain("\\begin{verbatim}\nx = 1 % not a comment\n\\end{verbatim}");
    expect(tex).toContain("\\textit{[Figure 1]} (\\url{https://e.com/p.png})");
    expect(tex).not.toContain("checkpoint");
  });
});
