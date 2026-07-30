// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { extractCalloutChildren, attachCalloutChildren } from "./calloutChildren";

describe("extractCalloutChildren", () => {
  it("pulls each callout div's inner HTML out and strips it from the document", async () => {
    const html =
      '<h2>Title</h2>' +
      '<div data-type="callout" data-callout-type="TIP"><p>insight</p></div>' +
      '<p>after</p>';
    const parseHTML = async (h: string) => [{ type: "paragraph", innerHtml: h } as any];

    const { strippedHtml, calloutChildren } = await extractCalloutChildren(html, parseHTML);

    expect(strippedHtml).toContain('data-callout-type="TIP"');
    expect(strippedHtml).not.toContain("<p>insight</p>");
    expect(strippedHtml).toContain("<p>after</p>");
    expect(calloutChildren).toHaveLength(1);
    expect((calloutChildren[0][0] as any).innerHtml).toBe("<p>insight</p>");
  });

  it("returns no callout children when there are no callout divs", async () => {
    const parseHTML = async () => [];
    const { strippedHtml, calloutChildren } = await extractCalloutChildren("<p>plain</p>", parseHTML);
    expect(strippedHtml).toBe("<p>plain</p>");
    expect(calloutChildren).toHaveLength(0);
  });
});

describe("attachCalloutChildren", () => {
  it("assigns extracted children to callout blocks in document order, including nested ones", () => {
    const blocks = [
      { id: "a", type: "callout", children: [] },
      {
        id: "b",
        type: "heading",
        children: [
          { id: "c", type: "callout", children: [] },
        ],
      },
    ] as any;
    const calloutChildren = [
      [{ id: "child1", type: "paragraph" }],
      [{ id: "child2", type: "paragraph" }],
    ] as any;

    const result = attachCalloutChildren(blocks, calloutChildren);

    expect(result[0].children).toEqual(calloutChildren[0]);
    expect(result[1].children[0].children).toEqual(calloutChildren[1]);
  });

  it("leaves non-callout blocks' children untouched", () => {
    const blocks = [{ id: "a", type: "paragraph", children: [] }] as any;
    const result = attachCalloutChildren(blocks, []);
    expect(result[0].children).toEqual([]);
  });
});
