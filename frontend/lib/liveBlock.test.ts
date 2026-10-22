import { describe, expect, it } from "vitest";
import {
  MAX_FRAME_HEIGHT, MIN_FRAME_HEIGHT, heightFromMessage, liveBlockRequest, stripFences, withAutoHeight,
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
