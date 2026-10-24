import { describe, expect, it } from "vitest";
import {
  CONTENT_HEIGHT_JS, MAX_FRAME_HEIGHT, MIN_FRAME_HEIGHT, heightFromMessage, liveBlockRequest, stripFences, withAutoHeight,
} from "./liveBlock";

describe("withAutoHeight", () => {
  it("adds the reporter before </body>, or at the end", () => {
    const a = withAutoHeight("<html><body><p>x</p></body></html>");
    expect(a.indexOf("sb-live-height")).toBeLessThan(a.indexOf("</body>"));
    expect(withAutoHeight("<p>x</p>").startsWith("<p>x</p><script>")).toBe(true);
  });
});

describe("heightFromMessage", () => {
  it("accepts only its own message shape and clamps", () => {
    expect(heightFromMessage({ "sb-live-height": 412.2 })).toBe(413);
    expect(heightFromMessage({ "sb-live-height": 5 })).toBe(MIN_FRAME_HEIGHT);
    expect(heightFromMessage({ "sb-live-height": 99999 })).toBe(MAX_FRAME_HEIGHT);
    expect(heightFromMessage({ "sb-live-height": "400" })).toBeNull();
    expect(heightFromMessage({ height: 400 })).toBeNull();
    expect(heightFromMessage("400")).toBeNull();
    expect(heightFromMessage(null)).toBeNull();
  });
});

describe("liveBlockRequest", () => {
  it("a new block is a plain request", () => {
    expect(liveBlockRequest("Quiz", "a quiz on entropy", null)).toBe('Title: "Quiz"\n\na quiz on entropy');
  });
  it("an untitled block sends no title line", () => {
    expect(liveBlockRequest("  ", "a quiz on entropy", null)).toBe("a quiz on entropy");
    expect(liveBlockRequest("", "bigger", "<p>old</p>")).toMatch(/^This is the block's current code/);
  });
  it("a filled block sends its code and asks for an edit", () => {
    const r = liveBlockRequest("Quiz", "make the labels bigger", "<p>old</p>");
    expect(r).toContain("<p>old</p>");
    expect(r).toContain("make the labels bigger");
    expect(r).toMatch(/complete updated document/);
  });
});

describe("stripFences", () => {
  it("unwraps a fenced reply and leaves plain HTML alone", () => {
    expect(stripFences("Here:\n```html\n<p>a</p>\n```\nDone")).toBe("<p>a</p>");
    expect(stripFences("<p>b</p>")).toBe("<p>b</p>");
    expect(stripFences("```mermaid\nflowchart LR\n  A-->B\n```")).toBe("flowchart LR\n  A-->B");
  });
});

describe("imageFromTransfer", () => {
  it("finds an image among dropped/pasted files, ignores text", async () => {
    const { imageFromTransfer } = await import("./liveBlock");
    const img = new File([new Uint8Array([1])], "board.png", { type: "image/png" });
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    expect(imageFromTransfer({ files: [txt, img], items: [] } as unknown as DataTransfer)).toBe(img);
    expect(imageFromTransfer({ files: [txt], items: [] } as unknown as DataTransfer)).toBeNull();
    expect(imageFromTransfer(null)).toBeNull();
  });
});

describe("CONTENT_HEIGHT_JS", () => {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const contentHeight = new Function(`${CONTENT_HEIGHT_JS}; return contentHeight;`)() as
    (b: unknown, scrollY: number, css: (el: unknown) => Record<string, string>) => number;
  type El = { tagName: string; bottom: number; mb?: number };
  const kid = ({ tagName, bottom, mb = 0 }: El) =>
    ({ tagName, mb, getBoundingClientRect: () => ({ bottom }) });
  const body = (scrollHeight: number, kids: El[], pb = 0, bmb = 0) =>
    ({ scrollHeight, pb, bmb, children: kids.map(kid) });
  // getComputedStyle stand-in: margins/paddings carried on the fakes
  const css = (el: unknown): Record<string, string> => {
    const e = el as { mb?: number; pb?: number; bmb?: number };
    return e.pb !== undefined
      ? { paddingBottom: `${e.pb}px`, marginBottom: `${e.bmb}px` }
      : { marginBottom: `${e.mb ?? 0}px` };
  };

  it("is the content's height, not the frame's: a 120 px diagram in a 300 px frame reports 120", () => {
    expect(contentHeight(body(120, [{ tagName: "DIV", bottom: 118 }]), 0, css)).toBe(120);
  });
  it("counts the last line's bottom margin, which sticks out of the body (no inner scrollbar)", () => {
    expect(contentHeight(body(440, [{ tagName: "DIV", bottom: 420 }, { tagName: "P", bottom: 440, mb: 6 }]), 0, css)).toBe(446);
  });
  it("counts the body's own padding and margin (a block with default body styles)", () => {
    expect(contentHeight(body(100, [{ tagName: "P", bottom: 108 }], 0, 8), 0, css)).toBe(116);
  });
  it("counts children that stick out of the body (absolutely positioned, full height)", () => {
    expect(contentHeight(body(0, [{ tagName: "CANVAS", bottom: 300 }]), 0, css)).toBe(300);
    expect(contentHeight(body(50, [{ tagName: "DIV", bottom: 200 }]), 40, css)).toBe(240);
  });
  it("ignores script and style tags", () => {
    expect(contentHeight(body(90, [{ tagName: "SCRIPT", bottom: 500 }, { tagName: "STYLE", bottom: 500 }]), 0, css)).toBe(90);
  });
});
