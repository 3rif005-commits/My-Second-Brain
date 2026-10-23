import { describe, expect, it } from "vitest";
import { needsMarkdown } from "./sectionMarkup";

describe("needsMarkdown", () => {
  it("renders Word equations", () => {
    expect(needsMarkdown("Formula: $E=\\frac{1}{2}mv^{2}$")).toBe(true);
    expect(needsMarkdown("$$\\int_0^1 x\\,dx$$")).toBe(true);
    expect(needsMarkdown("where $x_i$ is the input")).toBe(true);
  });
  it("keeps tables and lists", () => {
    expect(needsMarkdown("| a | b |\n|---|---|")).toBe(true);
    expect(needsMarkdown("- one\n- two")).toBe(true);
  });
  it("leaves prices and plain prose alone", () => {
    expect(needsMarkdown("Tickets cost $5 or $10 at the door.")).toBe(false);
    expect(needsMarkdown("It costs $ 20 total, $ 5 each")).toBe(false);
    expect(needsMarkdown("Mitochondria produce ATP.")).toBe(false);
    expect(needsMarkdown(null)).toBe(false);
  });
});
