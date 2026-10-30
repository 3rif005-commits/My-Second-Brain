import { describe, expect, it } from "vitest";
import { holdBackOpenTail } from "./streamingTail";

describe("holdBackOpenTail", () => {
  it("cuts a link whose URL is still arriving", () => {
    expect(holdBackOpenTail("see [Weekly review · 26 Oct](/brain/b15e45f4-f7ba"))
      .toBe("see ");
    expect(holdBackOpenTail("see [Weekly rev")).toBe("see ");
    expect(holdBackOpenTail("see [Weekly review]")).toBe("see ");
  });

  it("keeps finished links and citation markers", () => {
    expect(holdBackOpenTail("see [Weekly](/brain/x) now")).toBe("see [Weekly](/brain/x) now");
    expect(holdBackOpenTail("stable [1]")).toBe("stable [1]");
    expect(holdBackOpenTail("see [Weekly](/brain/x)")).toBe("see [Weekly](/brain/x)");
  });

  it("cuts display math without its closing delimiter", () => {
    expect(holdBackOpenTail("Because\n\\[ \\begin{aligned} \\frac{\\partial L}"))
      .toBe("Because\n");
    expect(holdBackOpenTail("Because\n$$ x = ")).toBe("Because\n");
    expect(holdBackOpenTail("a \\(x + ")).toBe("a ");
  });

  it("keeps closed math", () => {
    const md = "a \\[x\\] and $$y$$ and \\(z\\)";
    expect(holdBackOpenTail(md)).toBe(md);
  });

  it("leaves an open code fence alone", () => {
    const md = "```js\nconst a = [1, 2";
    expect(holdBackOpenTail(md)).toBe(md);
  });
});
