import { describe, expect, it } from "vitest";
import { fitScale, groupSlides, initialPresent, presentKey, type PresentState } from "./present";

const run = (s: PresentState | "exit", ...keys: string[]) =>
  keys.reduce<PresentState | "exit">((acc, k) => (acc === "exit" ? acc : presentKey(acc, k)), s);

describe("groupSlides", () => {
  it("starts a slide at each h1/h2; h3 and body stay on the slide", () => {
    expect(groupSlides([null, 1, null, 3, null, 2, null])).toEqual([[0], [1, 2, 3, 4], [5, 6]]);
    expect(groupSlides([2, null])).toEqual([[0, 1]]);
    expect(groupSlides([])).toEqual([]);
  });
});

describe("presentKey", () => {
  const s = initialPresent(5);
  it("moves with arrows, space, page keys, and stops at the ends", () => {
    expect((run(s, "ArrowRight", " ", "PageDown") as PresentState).index).toBe(3);
    expect((run(s, "ArrowLeft") as PresentState).index).toBe(0);
    expect((run(s, "End", "ArrowRight") as PresentState).index).toBe(4);
  });
  it("number + Enter jumps; out of range clamps", () => {
    expect((run(s, "4", "Enter") as PresentState).index).toBe(3);
    expect((run(s, "9", "9", "Enter") as PresentState).index).toBe(4);
    expect((run(s, "3") as PresentState).typed).toBe("3");
  });
  it("G grid, B black, Esc backs out one layer at a time then exits", () => {
    const g = run(s, "g", "b") as PresentState;
    expect(g.grid && g.black).toBe(true);
    expect(run(g, "Escape")).toMatchObject({ grid: false, black: true });
    expect(run(g, "Escape", "Escape")).toMatchObject({ grid: false, black: false });
    expect(run(g, "Escape", "Escape", "Escape")).toBe("exit");
    expect(run(s, "2", "Escape")).toMatchObject({ typed: "", index: 0 });
  });
});

describe("fitScale", () => {
  it("shrinks to fit, never grows, never below the floor", () => {
    expect(fitScale(800, 1200, 800, 600)).toBe(0.5);
    expect(fitScale(800, 900, 800, 600)).toBeCloseTo(0.667, 2);
    expect(fitScale(400, 300, 800, 600)).toBe(1);
    expect(fitScale(800, 3000, 800, 600)).toBe(0.5);
    expect(fitScale(0, 0, 800, 600)).toBe(1);
  });
});
