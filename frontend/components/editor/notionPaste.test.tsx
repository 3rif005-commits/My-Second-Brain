// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { BlockNoteSchema, defaultBlockSpecs, BlockNoteEditor } from "@blocknote/core";
import { transformNotionHtml } from "./notionPaste";
import { extractCalloutChildren, attachCalloutChildren } from "./calloutChildren";
import { CalloutBlockSpec, MathBlockSpec, InlineMathSpec } from "./customBlocks";
// @ts-ignore — runtime export; see the note on the core import above
import { defaultInlineContentSpecs } from "@blocknote/core";

// Every fixture below is INVENTED content shaped to match a structure captured
// from a real Notion clipboard payload (a paste listener reading
// event.clipboardData after a genuine ctrl+v). No real note content is used.

// String assertions alone have repeatedly missed real bugs in this feature —
// producing the right-looking markup is not the same as BlockNote producing
// the right block. These tests parse the transformed HTML through an actual
// editor and assert on the resulting BLOCK TREE. Same harness pattern as
// customBlocks.test.tsx.
function makeEditor() {
  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      callout: CalloutBlockSpec(),
      math: MathBlockSpec(),
    },
    inlineContentSpecs: { ...defaultInlineContentSpecs, inlineMath: InlineMathSpec },
  });
  const editor = BlockNoteEditor.create({ schema });
  editor.mount(document.createElement("div"));
  return editor;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

async function pasteToBlocks(html: string): Promise<AnyBlock[]> {
  const transformed = await transformNotionHtml(html, "note-1");
  return (await makeEditor().tryParseHTMLToBlocks(transformed)) as AnyBlock[];
}

function textOf(block: AnyBlock): string {
  return (block?.content ?? [])
    .map((c: { type: string; text?: string }) => (c.type === "text" ? c.text ?? "" : ""))
    .join("");
}

describe("transformNotionHtml — to-do blocks (literal [ ] / [x] markers)", () => {
  // Captured shape: a Notion to-do is <li><p>[ ] text</p></li>, with the
  // bracket as literal text — there is no <input> anywhere in the payload.
  // Ticking the box in Notion changes the marker to [x]; nothing else changes.
  it("turns an unchecked to-do into a real checkListItem, not a bullet with brackets", async () => {
    const blocks = await pasteToBlocks("<ul><li><p>[ ] water the plants</p></li></ul>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("checkListItem");
    expect(blocks[0].props.checked).toBe(false);
    expect(textOf(blocks[0])).toBe("water the plants");
  });

  it("carries the checked state across from an [x] marker", async () => {
    const blocks = await pasteToBlocks("<ul><li><p>[x] file the paperwork</p></li></ul>");
    expect(blocks[0].type).toBe("checkListItem");
    expect(blocks[0].props.checked).toBe(true);
    expect(textOf(blocks[0])).toBe("file the paperwork");
  });

  it("accepts an uppercase [X] marker too", async () => {
    const blocks = await pasteToBlocks("<ul><li><p>[X] done differently</p></li></ul>");
    expect(blocks[0].props.checked).toBe(true);
  });

  it("handles the un-wrapped variant (Notion only adds the <p> when some item has children)", async () => {
    const blocks = await pasteToBlocks("<ul><li>[ ] no paragraph wrapper</li></ul>");
    expect(blocks[0].type).toBe("checkListItem");
    expect(textOf(blocks[0])).toBe("no paragraph wrapper");
  });

  it("converts a to-do nested under another to-do, keeping each one's own state", async () => {
    const html =
      "<ul><li><p>[x] parent task</p><ul><li><p>[ ] child task</p></li></ul></li></ul>";
    const blocks = await pasteToBlocks(html);
    expect(blocks[0].type).toBe("checkListItem");
    expect(blocks[0].props.checked).toBe(true);
    expect(textOf(blocks[0])).toBe("parent task");
    expect(blocks[0].children[0].type).toBe("checkListItem");
    expect(blocks[0].children[0].props.checked).toBe(false);
  });

  it("leaves a to-do nested under a PLAIN bullet alone rather than corrupting the bullet", async () => {
    // BlockNote's checkListItem.parse looks for input[type=checkbox] among all
    // DESCENDANTS of an <li>, so giving the nested to-do a checkbox would make
    // the enclosing plain bullet parse as a check-list item too. Losing one
    // nested to-do's checkbox beats silently retyping its parent.
    const html =
      "<ul><li><p>an ordinary bullet</p><ul><li><p>[ ] nested todo</p></li></ul></li></ul>";
    const blocks = await pasteToBlocks(html);
    expect(blocks[0].type).toBe("bulletListItem");
    expect(textOf(blocks[0])).toBe("an ordinary bullet");
    expect(blocks[0].children[0].type).toBe("bulletListItem");
  });

  it("does not touch an ordinary bullet that merely mentions brackets mid-line", async () => {
    const blocks = await pasteToBlocks("<ul><li><p>see rule [ x ] in the appendix</p></li></ul>");
    expect(blocks[0].type).toBe("bulletListItem");
  });
});

describe("transformNotionHtml — plain lists must stay plain (the ambiguity guard)", () => {
  // Notion emits a TOGGLE and a BULLET-WITH-CHILDREN as byte-identical HTML —
  // both are <li><p>line</p>…children…</li> with no distinguishing marker.
  // Verified by capturing both from one page. So this shape must be left to
  // BlockNote's own list parsing; converting it would corrupt ordinary
  // nested bullets, which are far more common than toggles.
  it("keeps a bullet with nested children a bulletListItem with children", async () => {
    const html =
      "<ul>" +
      "<li><p>bullet alpha</p></li>" +
      "<li><p>bullet beta</p><ul><li>nested gamma</li></ul><p>indented paragraph</p></li>" +
      "</ul>";
    const blocks = await pasteToBlocks(html);
    expect(blocks.map((b) => b.type)).toEqual(["bulletListItem", "bulletListItem"]);
    expect(textOf(blocks[1])).toBe("bullet beta");
    // Every line survives, nested under the item it belonged to.
    expect(blocks[1].children.map((c: AnyBlock) => c.type)).toEqual([
      "bulletListItem",
      "paragraph",
    ]);
    expect(textOf(blocks[1].children[0])).toBe("nested gamma");
    expect(textOf(blocks[1].children[1])).toBe("indented paragraph");
  });

  it("keeps a numbered list numbered", async () => {
    const blocks = await pasteToBlocks("<ol><li>step one</li><li>step two</li></ol>");
    expect(blocks.map((b) => b.type)).toEqual(["numberedListItem", "numberedListItem"]);
  });
});

describe("transformNotionHtml — list items mixing a nested list with other nested blocks", () => {
  // Regression tests for a BlockNote HTML-parsing defect found by pasting a
  // captured Notion toggle: without `groupListItemChildren` the nested list
  // (or the trailing paragraph) escapes to the top level and one whole level
  // of hierarchy is lost. See that function's comment for the raw behavior.
  it("keeps a nested list nested when a paragraph child comes before it", async () => {
    const blocks = await pasteToBlocks(
      "<ul><li><p>line</p><p>child para</p><ul><li>nested</li></ul></li></ul>"
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].children.map((c: AnyBlock) => c.type)).toEqual([
      "paragraph",
      "bulletListItem",
    ]);
    expect(textOf(blocks[0].children[1])).toBe("nested");
  });

  it("keeps a paragraph that follows a nested list nested, and still a paragraph", async () => {
    const blocks = await pasteToBlocks(
      "<ul><li><p>line</p><ul><li>nested</li></ul><p>trailing para</p></li></ul>"
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].children.map((c: AnyBlock) => c.type)).toEqual([
      "bulletListItem",
      "paragraph",
    ]);
    expect(textOf(blocks[0].children[1])).toBe("trailing para");
  });

  it("reproduces the captured Notion toggle end to end, hierarchy intact", async () => {
    // Byte-for-byte the structure captured from a real Notion toggle holding
    // two paragraphs and a nested toggle of its own.
    const html =
      "<ul><li>" +
      "<p>Toggle title alpha</p>" +
      "<p>toggle child paragraph one</p>" +
      "<p>toggle child paragraph two</p>" +
      "<ul><li><p>Nested toggle beta</p><p>deep child inside nested toggle</p></li></ul>" +
      "</li></ul>";
    const blocks = await pasteToBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(textOf(blocks[0])).toBe("Toggle title alpha");
    const kids = blocks[0].children;
    expect(kids.map((c: AnyBlock) => c.type)).toEqual([
      "paragraph",
      "paragraph",
      "bulletListItem",
    ]);
    expect(textOf(kids[2])).toBe("Nested toggle beta");
    expect(textOf(kids[2].children[0])).toBe("deep child inside nested toggle");
  });

  it("works for a numbered list item too", async () => {
    const blocks = await pasteToBlocks(
      "<ol><li><p>step</p><p>note</p><ul><li>nested</li></ul></li></ol>"
    );
    expect(blocks[0].type).toBe("numberedListItem");
    expect(blocks[0].children.map((c: AnyBlock) => c.type)).toEqual([
      "paragraph",
      "bulletListItem",
    ]);
  });

  it("works for a to-do whose children mix a paragraph and a nested list", async () => {
    const blocks = await pasteToBlocks(
      "<ul><li><p>[x] task</p><p>note</p><ul><li>[ ] subtask</li></ul></li></ul>"
    );
    expect(blocks[0].type).toBe("checkListItem");
    expect(blocks[0].props.checked).toBe(true);
    expect(blocks[0].children.map((c: AnyBlock) => c.type)).toEqual([
      "paragraph",
      "checkListItem",
    ]);
  });

  it("leaves the shapes that already parse correctly alone", async () => {
    const allParagraphs = await pasteToBlocks("<ul><li><p>a</p><p>b</p><p>c</p></li></ul>");
    expect(allParagraphs[0].children.map((c: AnyBlock) => c.type)).toEqual([
      "paragraph",
      "paragraph",
    ]);
    const singleList = await pasteToBlocks("<ul><li><p>a</p><ul><li>b</li></ul></li></ul>");
    expect(singleList[0].children.map((c: AnyBlock) => c.type)).toEqual(["bulletListItem"]);
  });
});

describe("transformNotionHtml — toggles wrapped in a <blockquote> (the unambiguous shape)", () => {
  // A <blockquote> whose only child is a list can't be a genuine Notion quote
  // (those hold exactly one <p>) and can't be a plain list (those aren't
  // wrapped at all), so reconstructing a real toggle here is safe.
  it("reconstructs a real toggleListItem, not a flattened bullet list", async () => {
    const html =
      "<blockquote><ul><li>Toggle summary line</li><li>hidden child one</li><li>hidden child two</li></ul></blockquote>";
    const blocks = await pasteToBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("toggleListItem");
    expect(textOf(blocks[0])).toBe("Toggle summary line");
    expect(blocks[0].children).toHaveLength(2);
    expect(textOf(blocks[0].children[0])).toBe("hidden child one");
    expect(textOf(blocks[0].children[1])).toBe("hidden child two");
  });

  it("unwraps the <p> Notion adds around each item's own line", async () => {
    const html =
      "<blockquote><ul><li><p>Toggle summary line</p></li><li><p>hidden child</p></li></ul></blockquote>";
    const blocks = await pasteToBlocks(html);
    expect(blocks[0].type).toBe("toggleListItem");
    expect(textOf(blocks[0])).toBe("Toggle summary line");
    expect(textOf(blocks[0].children[0])).toBe("hidden child");
  });

  it("reproduces the captured real-page shape: one <li> with a bare line plus a nested list", async () => {
    // Exactly what a real Notion toggle sitting under a heading serialises to,
    // captured at Notion's own clipboard write: the outer list has a SINGLE
    // <li> whose line is a bare text node, followed by its children as a
    // nested <ul>. Newlines/indentation between them are in the real markup.
    const html =
      "<blockquote>\n  <ul>\n    <li>\n      Overview\n      <ul>\n" +
      "        <li>first child</li>\n        <li>second child</li>\n        <li>third child</li>\n" +
      "      </ul>\n    </li>\n  </ul>\n</blockquote>";
    const blocks = await pasteToBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("toggleListItem");
    // The line is exactly the summary text — no blank lines smuggled in by the
    // source markup's indentation (which previously rendered as hard breaks
    // and pushed the collapse triangle onto its own row).
    expect(textOf(blocks[0])).toBe("Overview");
    expect(blocks[0].content.every((c: { type: string }) => c.type === "text")).toBe(true);
    expect(blocks[0].children).toHaveLength(3);
  });

  it("keeps content already nested inside the first item as the toggle's children", async () => {
    const html =
      "<blockquote><ul><li><p>Summary</p><ul><li>already nested</li></ul></li></ul></blockquote>";
    const blocks = await pasteToBlocks(html);
    expect(blocks[0].type).toBe("toggleListItem");
    expect(textOf(blocks[0])).toBe("Summary");
    expect(textOf(blocks[0].children[0])).toBe("already nested");
  });

  it("reconstructs a heading-style toggle as a toggleable heading", async () => {
    // BlockNote's heading spec declares runsBefore: ["toggleListItem"], so a
    // <summary> holding an <h2> parses as a toggleable heading rather than a
    // toggle list item — the same <details> output covers both.
    const html = "<blockquote><ul><li><h2>Section</h2></li><li>body line</li></ul></blockquote>";
    const blocks = await pasteToBlocks(html);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].props.level).toBe(2);
    expect(blocks[0].props.isToggleable).toBe(true);
    expect(textOf(blocks[0].children[0])).toBe("body line");
  });

  it("handles an ordered list inside the blockquote the same way", async () => {
    const html = "<blockquote><ol><li>Summary</li><li>child</li></ol></blockquote>";
    const blocks = await pasteToBlocks(html);
    expect(blocks[0].type).toBe("toggleListItem");
    expect(blocks[0].children[0].type).toBe("numberedListItem");
  });

  it("leaves a genuine quote (<blockquote> with only a <p> child) untouched", async () => {
    const blocks = await pasteToBlocks("<blockquote><p>A real quote, not a toggle.</p></blockquote>");
    expect(blocks[0].type).toBe("quote");
    expect(textOf(blocks[0])).toBe("A real quote, not a toggle.");
  });

  it("leaves a <blockquote> with multiple children (not the single-list shape) untouched", async () => {
    const out = await transformNotionHtml(
      "<blockquote><p>Intro</p><ul><li>a point</li></ul></blockquote>",
      "note-1"
    );
    expect(out).toContain("<blockquote");
    expect(out).not.toContain("<details");
  });
});

describe("transformNotionHtml — block equations (literal $$…$$ text)", () => {
  // Captured shape: <p>$$<br>{latex}<br>$$</p>. No MathML, no KaTeX markup.
  it("converts a $$…$$ paragraph into a real math block", async () => {
    const blocks = await pasteToBlocks("<p>$$<br>\\sum_{i=1}^{n} x_i = y<br>$$</p>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("math");
    expect(blocks[0].props.latex).toBe("\\sum_{i=1}^{n} x_i = y");
  });

  it("handles the single-line $$…$$ form too", async () => {
    const blocks = await pasteToBlocks("<p>$$E = mc^2$$</p>");
    expect(blocks[0].type).toBe("math");
    expect(blocks[0].props.latex).toBe("E = mc^2");
  });

  it("leaves an empty $$$$ paragraph alone", async () => {
    const out = await transformNotionHtml("<p>$$$$</p>", "note-1");
    expect(out).not.toContain('data-type="math"');
  });
});

describe("transformNotionHtml — inline equations (literal $…$ mid-sentence)", () => {
  // The note that prompted this work carries 36 inline `$…$` spans and zero
  // `$$…$$` blocks, so inline is the form that actually matters. It can't
  // become its own block without tearing the sentence in half — it needs the
  // `inlineMath` inline content type (customBlocks.tsx).
  function inlineTypes(block: AnyBlock): string[] {
    return (block.content ?? []).map((c: { type: string }) => c.type);
  }

  it("turns a mid-sentence $…$ into real inline math, keeping one paragraph", async () => {
    const blocks = await pasteToBlocks("<p>Inline math $E = mc^2$ ends the sentence.</p>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    expect(inlineTypes(blocks[0])).toEqual(["text", "inlineMath", "text"]);
    // Verifies BlockNote maps data-latex onto the prop with no custom parse fn.
    expect(blocks[0].content[1].props.latex).toBe("E = mc^2");
    expect(blocks[0].content[0].text).toBe("Inline math ");
    expect(blocks[0].content[2].text).toBe(" ends the sentence.");
  });

  it("handles several formulas in one paragraph", async () => {
    const blocks = await pasteToBlocks("<p>Both $a_1$ and $b^2$ appear here.</p>");
    const maths = (blocks[0].content ?? []).filter((c: { type: string }) => c.type === "inlineMath");
    expect(maths.map((m: AnyBlock) => m.props.latex)).toEqual(["a_1", "b^2"]);
  });

  it("keeps backslash commands intact", async () => {
    const blocks = await pasteToBlocks("<p>The sum $\\sum_{i=1}^{n} x_i$ converges.</p>");
    const math = (blocks[0].content ?? []).find((c: { type: string }) => c.type === "inlineMath");
    expect(math.props.latex).toBe("\\sum_{i=1}^{n} x_i");
  });

  it("does not swallow prices", async () => {
    const blocks = await pasteToBlocks("<p>It costs $5 to $10 per seat.</p>");
    expect(inlineTypes(blocks[0])).toEqual(["text"]);
    expect(textOf(blocks[0])).toBe("It costs $5 to $10 per seat.");
  });

  it("does not treat a lone dollar sign as an opening delimiter", async () => {
    const blocks = await pasteToBlocks("<p>Budget is $500 total.</p>");
    expect(inlineTypes(blocks[0])).toEqual(["text"]);
  });

  it("leaves dollars inside code alone", async () => {
    const blocks = await pasteToBlocks('<pre><code class="language-bash">echo $HOME and $PATH</code></pre>');
    expect(blocks[0].type).toBe("codeBlock");
    expect(textOf(blocks[0])).toBe("echo $HOME and $PATH");
  });

  it("does not mangle a $$…$$ block into inline math", async () => {
    // Ordering guard: rewriteBlockEquations must consume the block form first.
    const blocks = await pasteToBlocks("<p>$$<br>a^2 + b^2 = c^2<br>$$</p>");
    expect(blocks[0].type).toBe("math");
    expect(blocks[0].props.latex).toBe("a^2 + b^2 = c^2");
  });

  it("converts inline math inside a list item without disturbing the list", async () => {
    const blocks = await pasteToBlocks("<ul><li><p>Update rule uses $\\alpha$ here.</p></li></ul>");
    expect(blocks[0].type).toBe("bulletListItem");
    expect(inlineTypes(blocks[0])).toContain("inlineMath");
  });
});

describe("transformNotionHtml — code blocks parse natively (no rewrite needed)", () => {
  it("keeps a <pre><code class=language-x> as a codeBlock with its language", async () => {
    const blocks = await pasteToBlocks(
      '<pre><code class="language-python">return a + b</code></pre>'
    );
    expect(blocks[0].type).toBe("codeBlock");
    expect(blocks[0].props.language).toBe("python");
    expect(textOf(blocks[0])).toBe("return a + b");
  });
});

describe("transformNotionHtml — Notion's own callout block (the confirmed real shape)", () => {
  // Captured shape: <p>&lt;aside&gt;<br>{emoji}</p><p>…body…</p><p>&lt;/aside&gt;</p>
  it("converts an <aside>-marked span into a callout div typed by its leading emoji", async () => {
    const html =
      "<p>&lt;aside&gt;<br>💡 A helpful tip goes here.</p>" + "<p>&lt;/aside&gt;</p>";
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain('data-type="callout"');
    expect(out).toContain('data-callout-type="TIP"');
    expect(out).toContain("A helpful tip goes here.");
    expect(out).not.toContain("&lt;aside&gt;");
    // The emoji is consumed into the block's type, not left duplicating the
    // callout's own rendered icon pill in its body text. A palette emoji is
    // fully represented by the type, so no data-callout-icon is needed.
    expect(out).not.toContain("💡");
  });

  it("handles the emoji sitting alone on the marker paragraph, body in the next one", async () => {
    // This is what real Notion emits: the emoji ends the marker paragraph and
    // the callout's text is its own following <p>.
    const html =
      "<p>&lt;aside&gt;<br>💡</p>" +
      "<p>A default callout with the default emoji icon.</p>" +
      "<p>&lt;/aside&gt;</p>";
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain('data-callout-type="TIP"');
    expect(out).toContain("A default callout with the default emoji icon.");
  });

  it("preserves an emoji outside this app's nine instead of silently relabelling it", async () => {
    const html = "<p>&lt;aside&gt;<br>🚀 Ship it.</p><p>&lt;/aside&gt;</p>";
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain('data-callout-icon="🚀"');
    expect(out).toContain("Ship it.");
    expect(out).not.toContain("🚀 Ship it."); // the emoji moved to the attribute
  });

  it("keeps a multi-codepoint emoji whole rather than splitting it", async () => {
    const html = "<p>&lt;aside&gt;<br>👍🏽 Nice work.</p><p>&lt;/aside&gt;</p>";
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain('data-callout-icon="👍🏽"');
  });

  it("preserves multi-block callout content (a list) between the markers", async () => {
    const html =
      "<p>&lt;aside&gt;<br>🎯 Key facts:</p>" +
      "<ul><li>fact one</li><li>fact two</li></ul>" +
      "<p>&lt;/aside&gt;</p>";
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain('data-callout-type="EXAM"');
    expect(out).toContain("fact one");
    expect(out).toContain("fact two");
  });

  it("defaults to NOTE with no icon when the callout has no emoji at all", async () => {
    const html = "<p>&lt;aside&gt;<br>Just plain text, no icon.</p><p>&lt;/aside&gt;</p>";
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain('data-callout-type="NOTE"');
    expect(out).not.toContain("data-callout-icon");
  });

  it("leaves an ordinary <li> with no <aside> markers untouched", async () => {
    const out = await transformNotionHtml("<ul><li>Just a normal bullet point</li></ul>", "note-1");
    expect(out).toContain("Just a normal bullet point");
    expect(out).not.toContain('data-type="callout"');
  });

  it("converts a callout whose markers are bunched with unrelated siblings inside one <li>", async () => {
    // Notion emits a toggle's children as flat siblings of its own line, so a
    // callout inside a toggle lands mid-<li> with unrelated rows around it —
    // the open marker isn't that li's first child, nor the close its last.
    const html =
      "<ul><li>" +
      "<p>An unrelated leading paragraph</p>" +
      "<p>&lt;aside&gt;<br>🛑 Careful here.</p>" +
      "<p>&lt;/aside&gt;</p>" +
      "<p>An unrelated trailing paragraph</p>" +
      "</li></ul>";
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain('data-callout-type="CAUTION"');
    expect(out).toContain("Careful here.");
    expect(out).toContain("An unrelated leading paragraph");
    expect(out).toContain("An unrelated trailing paragraph");
    expect(out).not.toContain("&lt;aside&gt;");
  });

  it("converts two back-to-back callouts sharing the same parent", async () => {
    const html =
      "<p>&lt;aside&gt;<br>💡 First tip.</p>" +
      "<p>&lt;/aside&gt;</p>" +
      "<p>&lt;aside&gt;<br>🛑 Second warning.</p>" +
      "<p>&lt;/aside&gt;</p>";
    const out = await transformNotionHtml(html, "note-1");
    expect((out.match(/data-type="callout"/g) || []).length).toBe(2);
    expect(out).toContain('data-callout-type="TIP"');
    expect(out).toContain('data-callout-type="CAUTION"');
    expect(out).toContain("First tip.");
    expect(out).toContain("Second warning.");
  });
});

describe("transformNotionHtml — div-based toggle fallback (not the Notion shape, kept defensively)", () => {
  it("rewrites a div-based toggle shape into <details><summary>", async () => {
    const html = '<div class="notion-toggle-block"><div>Overview</div><div>Body text</div></div>';
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain("<details");
    expect(out).toContain("<summary>Overview</summary>");
    expect(out).toContain("Body text");
  });

  it("converts a toggle nested inside another toggle, not just the outer one", async () => {
    const html =
      '<div class="notion-toggle-block">' +
      "<div>Outer</div>" +
      '<div class="notion-toggle-block"><div>Inner</div><div>Inner body</div></div>' +
      "</div>";
    const out = await transformNotionHtml(html, "note-1");
    expect((out.match(/<details/g) || []).length).toBe(2);
    expect(out).toContain("<summary>Outer</summary>");
    expect(out).toContain("<summary>Inner</summary>");
    expect(out).toContain("Inner body");
  });

  it("passes through genuine <details><summary> unchanged (BlockNote already understands it)", async () => {
    const blocks = await pasteToBlocks(
      "<details open><summary>Overview</summary><div>Body text</div></details>"
    );
    expect(blocks[0].type).toBe("toggleListItem");
    expect(textOf(blocks[0])).toBe("Overview");
    expect(textOf(blocks[0].children[0])).toBe("Body text");
  });
});

describe("the whole paste pipeline, as BlockEditor's pasteHandler runs it", () => {
  // transform -> extractCalloutChildren -> tryParseHTMLToBlocks ->
  // attachCalloutChildren, the exact sequence in BlockEditor.tsx. Worth
  // covering here because `groupListItemChildren` now wraps a callout div in a
  // plain <div> when it shares a list item with a nested list, and that
  // wrapper sits between the callout and the document extractCalloutChildren
  // walks.
  async function pasteLikeTheEditor(html: string): Promise<AnyBlock[]> {
    const editor = makeEditor();
    const transformed = await transformNotionHtml(html, "note-1");
    const { strippedHtml, calloutChildren } = await extractCalloutChildren(
      transformed,
      async (h: string) => (await editor.tryParseHTMLToBlocks(h)) as AnyBlock[]
    );
    const raw = (await editor.tryParseHTMLToBlocks(strippedHtml)) as AnyBlock[];
    return attachCalloutChildren(raw, calloutChildren);
  }

  it("keeps a callout's body when the callout shares a list item with a nested list", async () => {
    const html =
      "<ul><li>" +
      "<p>outer line</p>" +
      "<p>&lt;aside&gt;<br>💡 Remember this.</p>" +
      "<p>&lt;/aside&gt;</p>" +
      "<ul><li>a nested bullet</li></ul>" +
      "</li></ul>";
    const blocks = await pasteLikeTheEditor(html);
    expect(blocks).toHaveLength(1);
    expect(textOf(blocks[0])).toBe("outer line");
    const kids = blocks[0].children;
    expect(kids.map((c: AnyBlock) => c.type)).toEqual(["callout", "bulletListItem"]);
    expect(kids[0].props.calloutType).toBe("TIP");
    // Not an empty shell — the callout's own body came along.
    expect(textOf(kids[0].children[0])).toBe("Remember this.");
    expect(textOf(kids[1])).toBe("a nested bullet");
  });

  it("keeps two sibling callouts' bodies attached to the right one", async () => {
    const html =
      "<p>&lt;aside&gt;<br>💡 first body</p><p>&lt;/aside&gt;</p>" +
      "<p>&lt;aside&gt;<br>🛑 second body</p><p>&lt;/aside&gt;</p>";
    const blocks = await pasteLikeTheEditor(html);
    const callouts = blocks.filter((b) => b.type === "callout");
    expect(callouts).toHaveLength(2);
    expect(textOf(callouts[0].children[0])).toBe("first body");
    expect(textOf(callouts[1].children[0])).toBe("second body");
  });
});

describe("transformNotionHtml — unfetchable Notion attachment: images", () => {
  it("replaces an attachment: scheme image with a labeled placeholder", async () => {
    // Confirmed against a real Notion paste: every image uses an
    // `attachment:<uuid>:<filename>` src — an internal Notion reference,
    // not a fetchable URL. There is no way to recover the bytes from
    // clipboard data alone.
    const html = '<img src="attachment:abc123:diagram.png" alt="diagram.png">';
    const out = await transformNotionHtml(html, "note-1");
    expect(out).not.toContain("<img");
    expect(out).toContain("diagram.png");
    expect(out).toContain("not available via copy-paste");
  });

  it("does not touch a real fetchable https image", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const html = '<img src="https://example.com/real.png" alt="real.png">';
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain("<img");
    expect(out).toContain("https://example.com/real.png");
  });
});

describe("transformNotionHtml — image re-hosting (any external https source, not Notion-specific)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rewrites an external image src to the re-hosted url on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://storage.example/hosted.png" }),
    }) as unknown as typeof fetch;

    const html = '<img src="https://prod-files-secure.s3.amazonaws.com/signed.png">';
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain("https://storage.example/hosted.png");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/ws/notes/note-1/paste-image",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("keeps the original src when re-hosting fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const html = '<img src="https://prod-files-secure.s3.amazonaws.com/signed.png">';
    const out = await transformNotionHtml(html, "note-1");
    expect(out).toContain("https://prod-files-secure.s3.amazonaws.com/signed.png");
  });

  it("does not attempt to re-host a same-origin image", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    const html = `<img src="https://${window.location.host}/already-ours.png">`;
    await transformNotionHtml(html, "note-1");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
