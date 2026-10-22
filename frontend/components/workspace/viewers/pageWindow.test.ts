import { describe, expect, it } from "vitest";
import { pageHeight, pagesToRender } from "./pageWindow";

describe("pagesToRender", () => {
  it("draws the visible pages plus two on each side", () => {
    expect([...pagesToRender([50, 51], 300)]).toEqual([48, 49, 50, 51, 52, 53]);
  });
  it("starts at the top before anything is reported visible", () => {
    expect([...pagesToRender([], 300)]).toEqual([1, 2, 3]);
  });
  it("clamps to the document", () => {
    expect([...pagesToRender([1], 2)]).toEqual([1, 2]);
    expect([...pagesToRender([300], 300)]).toEqual([298, 299, 300]);
    expect([...pagesToRender([999, -3], 10)]).toEqual([1, 2, 3]);
    expect(pagesToRender([1], 0).size).toBe(0);
  });
  it("a 300-page book never draws more than a handful", () => {
    expect(pagesToRender([120, 121, 122], 300).size).toBeLessThanOrEqual(7);
  });
});

describe("pageHeight", () => {
  it("scales by width and refuses bad sizes", () => {
    expect(pageHeight([[612, 792]], 1, 680)).toBeCloseTo(880);
    expect(pageHeight([[612, 792]], 2, 680)).toBeNull();
    expect(pageHeight([[0, 792]], 1, 680)).toBeNull();
  });
});
