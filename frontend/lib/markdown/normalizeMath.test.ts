import { describe, expect, it } from "vitest";
import { normalizeMath } from "./Markdown";

describe("normalizeMath", () => {
  it("turns \\( \\) and \\[ \\] into dollar math", () => {
    expect(normalizeMath("rule \\( \\theta - \\alpha \\nabla L \\) here"))
      .toBe("rule $\\theta - \\alpha \\nabla L$ here");
    expect(normalizeMath("\\[ a^2 + b^2 \\]")).toBe("$$ a^2 + b^2 $$");
  });
  it("leaves code alone", () => {
    const md = "`\\(x\\)` and\n```\n\\[y\\]\n```";
    expect(normalizeMath(md)).toBe(md);
  });
});
