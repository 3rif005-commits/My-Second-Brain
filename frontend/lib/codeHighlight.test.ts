import { describe, expect, it } from "vitest";
import { createCodeHighlighter, resolveCodeLanguage } from "./codeHighlight";

async function colours(code: string, lang: string) {
  const highlighter = await createCodeHighlighter();
  await highlighter.loadLanguage(lang as never);
  const { tokens } = highlighter.codeToTokens(code, { lang: lang as never, theme: "notion" });
  return Object.fromEntries(
    tokens.flat().filter((t) => t.content.trim()).map((t) => [t.content.trim(), t.color]),
  );
}

describe("resolveCodeLanguage", () => {
  it("maps ids, aliases and odd casing to a menu id", () => {
    expect(resolveCodeLanguage("html")).toBe("html");
    expect(resolveCodeLanguage("JS")).toBe("javascript");
    expect(resolveCodeLanguage("py")).toBe("python");
    expect(resolveCodeLanguage("plain text")).toBe("text");
    expect(resolveCodeLanguage("")).toBeUndefined();
    expect(resolveCodeLanguage("brainfuck")).toBeUndefined();
  });
});

describe("Notion code theme", () => {
  it("colours JavaScript like Notion: keyword, function, string, punctuation", async () => {
    const c = await colours('function greet(name) { return "hi " + name; }', "javascript");
    expect(c["function"]).toBe("var(--code-keyword)");
    expect(c["return"]).toBe("var(--code-keyword)");
    expect(c["greet"]).toBe("var(--code-function)");
    expect(c[`"hi "`]).toBe("var(--code-string)");
    expect(c["{"]).toBe("var(--code-punctuation)");
  });

  it("colours HTML like Prism: tag, attribute name, attribute value", async () => {
    const c = await colours('<div class="card">Hi</div>', "html");
    expect(c["div"]).toBe("var(--code-tag)");
    expect(c["class"]).toBe("var(--code-string)");
    expect(c[`"card"`]).toBe("var(--code-keyword)");
    expect(c["<"]).toBe("var(--code-punctuation)");
    expect(c["Hi"]).toBe("var(--code-fg)");
  });
});
