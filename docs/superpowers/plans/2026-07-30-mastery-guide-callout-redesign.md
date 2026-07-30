# Mastery Guide Callout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "basic" mastery-guide prompt with a richer chapter/section/concept/sub-case structure and a real 9-type callout palette, by adding a `callout` custom block to BlockNote's schema (none exists today) and rewriting `backend/prompts/mastery_guide.py`'s `SYSTEM_PROMPT` to emit HTML that block actually renders.

**Architecture:** One new custom BlockNote block (`callout`, container with children, following the existing `math`/`checkpoint` pattern in `frontend/components/editor/customBlocks.tsx`) plus a small HTML pre-processing step in `BlockEditor.tsx` that extracts each callout `<div>`'s inner content and attaches it as real nested child blocks (mirroring the codebase's existing `interactive`-div-stripping pattern, since a `content: "none"` custom block matched via a generic `tag: "*"` parse rule does not auto-absorb sibling HTML as children the way BlockNote's native toggleable headings do). The backend prompt is rewritten to emit this HTML dialect. A necessary side effect: the multi-source synthesis feature's `data-anchor` sync mechanism is hard-coded to `<h2>`, but the new hierarchy makes `<h2>` a coarse "Chapter" — anchors must move to `<h3>` ("Section", the actual granular unit), so `NotePane.tsx` and `note_synthesis.py` need a matching one-line change each.

**Tech Stack:** Next.js/React frontend (BlockNote 0.48 editor), Python/FastAPI backend, pytest for backend tests, new vitest+jsdom setup for frontend unit tests (none exists today — frontend currently only has Playwright e2e).

## Global Constraints

- Callout colors: exactly the 9 values in BlockNote's default palette (`gray`, `brown`, `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`), each used for exactly one callout type — no invented colors.
- Heading color attribute is always `data-text-color`, never `data-importance` or `data-color` (both are silently dropped by BlockNote's real parser — confirmed by reading `frontend/node_modules/@blocknote/core/dist/blocks-DYl7UTS4.js` and the `Heading/block.d.ts` prop schema).
- Heading levels: h1 = doc title, h2 = Chapter, h3 = Section, h4 = optional dense-section, h5 = Concept (toggleable), h6 = Sub-case (toggleable, nested inside a Concept).
- Drop entirely: interactive quiz block, metadata block, inline `<span data-color>` coloring, the `[TOC]` directive.
- `backend/prompts/mastery_guide.py`'s `SYSTEM_PROMPT` constant name and `build_mastery_guide_prompt(source_text, title="")` signature must not change — `backend/prompts/note_synthesis.py` imports `SYSTEM_PROMPT` verbatim and `backend/tests/test_note_synthesis.py::test_reuses_mastery_guide_prompt_verbatim` enforces this.
- Backend tests: run from `backend/` as `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio`.

---

## Task 1: `callout` and `math` parse support in the BlockNote schema

**Files:**
- Modify: `frontend/components/editor/customBlocks.tsx`
- Modify: `frontend/components/editor/BlockEditor.tsx:50-60` (schema registration)
- Create: `frontend/vitest.config.ts`
- Create: `frontend/components/editor/customBlocks.test.tsx`
- Modify: `frontend/package.json` (add `vitest`, `jsdom`, `@vitejs/plugin-react` devDependencies + `"test": "vitest run"` script)

**Interfaces:**
- Produces: `CalloutBlockSpec` (factory, same shape as existing `MathBlockSpec`/`CheckpointBlockSpec`) and `CALLOUT_PALETTE: Record<CalloutType, {color: string; icon: string; label: string}>`, both exported from `customBlocks.tsx`. `CalloutType` is the union `"OVERVIEW"|"NOTE"|"TIP"|"IMPORTANT"|"WARNING"|"CAUTION"|"FORMULA"|"ANALOGY"|"EXAM"`.
- Produces: `MathBlockSpec` now also matches raw HTML — no signature change, same export.

- [ ] **Step 1: Install test dependencies**

```bash
cd frontend && npm install -D vitest jsdom @vitejs/plugin-react
```

- [ ] **Step 2: Add vitest config**

```ts
// frontend/vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "e2e"],
  },
});
```

Add to `frontend/package.json` `"scripts"`: `"test": "vitest run"`.

- [ ] **Step 3: Write the failing test for the callout palette + parse rule**

```tsx
// frontend/components/editor/customBlocks.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { BlockNoteEditor } from "@blocknote/core";
import { CalloutBlockSpec, CALLOUT_PALETTE, MathBlockSpec } from "./customBlocks";

function makeEditor() {
  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      callout: CalloutBlockSpec(),
      math: MathBlockSpec(),
    },
  });
  const editor = BlockNoteEditor.create({ schema });
  // tryParseHTMLToBlocks needs the editor mounted — mirrors the pattern in
  // @blocknote/xl-multi-column's own test suite (node_modules/@blocknote/xl-multi-column/src/test/conversions/htmlConversion.test.ts)
  editor.mount(document.createElement("div"));
  return editor;
}

describe("CALLOUT_PALETTE", () => {
  it("has exactly the 9 defined callout types, one color each, no repeats", () => {
    const types = Object.keys(CALLOUT_PALETTE);
    expect(types.sort()).toEqual(
      ["ANALOGY", "CAUTION", "EXAM", "FORMULA", "IMPORTANT", "NOTE", "OVERVIEW", "TIP", "WARNING"].sort()
    );
    const colors = types.map((t) => CALLOUT_PALETTE[t as keyof typeof CALLOUT_PALETTE].color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("callout HTML parsing", () => {
  it("parses a div[data-type=callout] into a callout block with the right calloutType", async () => {
    const editor = makeEditor();
    const blocks = await editor.tryParseHTMLToBlocks(
      '<div data-type="callout" data-callout-type="TIP"></div>'
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("callout");
    expect((blocks[0].props as any).calloutType).toBe("TIP");
  });

  it("falls back to NOTE for an unrecognized calloutType", async () => {
    const editor = makeEditor();
    const blocks = await editor.tryParseHTMLToBlocks(
      '<div data-type="callout" data-callout-type="NOT_A_TYPE"></div>'
    );
    expect((blocks[0].props as any).calloutType).toBe("NOTE");
  });

  it("does not match unrelated divs", async () => {
    const editor = makeEditor();
    const blocks = await editor.tryParseHTMLToBlocks('<div class="foo">hi</div>');
    expect(blocks.some((b) => b.type === "callout")).toBe(false);
  });
});

describe("math HTML parsing", () => {
  it("parses a div[data-type=math] into a math block using its text content as latex", async () => {
    const editor = makeEditor();
    const blocks = await editor.tryParseHTMLToBlocks(
      '<div data-type="math">E = mc^2</div>'
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("math");
    expect((blocks[0].props as any).latex).toBe("E = mc^2");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd frontend && npx vitest run components/editor/customBlocks.test.tsx
```

Expected: FAIL — `CalloutBlockSpec` and `CALLOUT_PALETTE` are not exported yet.

- [ ] **Step 5: Implement `CalloutBlockSpec`, `CALLOUT_PALETTE`, and `MathBlockSpec`'s parse rule**

Add to `frontend/components/editor/customBlocks.tsx` (keep the existing `MathBlockSpec`/`CheckpointBlockSpec` code — only the two changes below):

```tsx
// Add a `parse` hook to the existing MathBlockSpec definition. Change:
//   export const MathBlockSpec = createReactBlockSpec(
//     {
//       type: "math",
//       propSchema: { latex: { default: "" } },
//       content: "none",
//     },
//     { render: (props) => <MathBlockView ... /> }
//   );
// to:
export const MathBlockSpec = createReactBlockSpec(
  {
    type: "math",
    propSchema: {
      latex: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => <MathBlockView block={props.block} editor={props.editor} />,
    parse: (element: HTMLElement) => {
      if (element.getAttribute("data-type") !== "math") return undefined;
      return { latex: element.textContent?.trim() || "" };
    },
  }
);
```

```tsx
// New block, appended to customBlocks.tsx

export type CalloutType =
  | "OVERVIEW" | "NOTE" | "TIP" | "IMPORTANT" | "WARNING"
  | "CAUTION" | "FORMULA" | "ANALOGY" | "EXAM";

export const CALLOUT_PALETTE: Record<CalloutType, { color: string; icon: string; label: string }> = {
  OVERVIEW:  { color: "blue",   icon: "📋", label: "Overview" },
  NOTE:      { color: "gray",   icon: "ℹ️", label: "Note" },
  TIP:       { color: "green",  icon: "💡", label: "Tip" },
  IMPORTANT: { color: "yellow", icon: "❗", label: "Important" },
  WARNING:   { color: "orange", icon: "⚠️", label: "Warning" },
  CAUTION:   { color: "red",    icon: "🛑", label: "Caution" },
  FORMULA:   { color: "purple", icon: "📐", label: "Formula" },
  ANALOGY:   { color: "brown",  icon: "💭", label: "Analogy" },
  EXAM:      { color: "pink",   icon: "🎯", label: "Exam" },
};

const CALLOUT_COLOR_CLASSES: Record<string, string> = {
  blue:   "bg-blue-50 border-blue-300 dark:bg-blue-900/20 dark:border-blue-700",
  gray:   "bg-gray-50 border-gray-300 dark:bg-gray-800/40 dark:border-gray-600",
  green:  "bg-green-50 border-green-300 dark:bg-green-900/20 dark:border-green-700",
  yellow: "bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-700",
  orange: "bg-orange-50 border-orange-300 dark:bg-orange-900/20 dark:border-orange-700",
  red:    "bg-red-50 border-red-300 dark:bg-red-900/20 dark:border-red-700",
  purple: "bg-purple-50 border-purple-300 dark:bg-purple-900/20 dark:border-purple-700",
  brown:  "bg-[#f5efe8] border-[#c9a876] dark:bg-[#3a2f22]/40 dark:border-[#7a6142]",
  pink:   "bg-pink-50 border-pink-300 dark:bg-pink-900/20 dark:border-pink-700",
};

function CalloutBlockView({ block }: { block: any }) {
  const rawType = block.props.calloutType as string;
  const type: CalloutType = rawType in CALLOUT_PALETTE ? (rawType as CalloutType) : "NOTE";
  const { color, icon, label } = CALLOUT_PALETTE[type];
  return (
    <div
      className={`w-full my-1 px-3 py-2 rounded-lg border ${CALLOUT_COLOR_CLASSES[color]}`}
      contentEditable={false}
    >
      <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
    </div>
  );
}

export const CalloutBlockSpec = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      calloutType: { default: "NOTE" as CalloutType },
    },
    content: "none",
  },
  {
    render: (props) => <CalloutBlockView block={props.block} />,
    parse: (element: HTMLElement) => {
      if (element.getAttribute("data-type") !== "callout") return undefined;
      const raw = element.getAttribute("data-callout-type") || "NOTE";
      const calloutType = raw in CALLOUT_PALETTE ? raw : "NOTE";
      return { calloutType };
    },
  }
);
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd frontend && npx vitest run components/editor/customBlocks.test.tsx
```

Expected: PASS (5 tests)

- [ ] **Step 7: Register `callout` in the editor schema**

In `frontend/components/editor/BlockEditor.tsx`, modify the import and schema block:

```tsx
// change:
import { MathBlockSpec, CheckpointBlockSpec } from "./customBlocks";
// to:
import { MathBlockSpec, CheckpointBlockSpec, CalloutBlockSpec } from "./customBlocks";
```

```tsx
// change:
const multiColSchema = withMultiColumn(
  (BlockNoteSchema as any).create({
    blockSpecs: {
      ...defaultBlockSpecs,
      math: MathBlockSpec(),
      checkpoint: CheckpointBlockSpec(),
    },
    inlineContentSpecs: { ...defaultInlineContentSpecs, mention: MentionSpec },
  })
);
// to:
const multiColSchema = withMultiColumn(
  (BlockNoteSchema as any).create({
    blockSpecs: {
      ...defaultBlockSpecs,
      math: MathBlockSpec(),
      checkpoint: CheckpointBlockSpec(),
      callout: CalloutBlockSpec(),
    },
    inlineContentSpecs: { ...defaultInlineContentSpecs, mention: MentionSpec },
  })
);
```

- [ ] **Step 8: Run the full frontend test suite**

```bash
cd frontend && npm test
```

Expected: PASS, no regressions.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/editor/customBlocks.tsx frontend/components/editor/customBlocks.test.tsx \
  frontend/components/editor/BlockEditor.tsx frontend/vitest.config.ts frontend/package.json frontend/package-lock.json
git commit -m "feat(editor): add callout block to BlockNote schema, math HTML parse rule"
```

---

## Task 2: Attach callout children during HTML ingestion

A `content: "none"` custom block matched via the generic `tag: "*"` parse rule does not automatically absorb the matched element's inner HTML as nested child blocks (only BlockNote's native `<details>`-aware heading parser does that special-casing). So a `<div data-type="callout">...<p>body</p>...</div>` parses into an empty callout shell with its inner `<p>` silently dropped, unless we pull the inner HTML out first. This task adds that extraction step, mirroring the existing `interactive`-div-stripping pattern already in `BlockEditor.tsx`.

**Files:**
- Modify: `frontend/components/editor/BlockEditor.tsx`
- Create: `frontend/components/editor/calloutChildren.ts`
- Create: `frontend/components/editor/calloutChildren.test.ts`

**Interfaces:**
- Consumes: `CalloutBlockSpec`'s `calloutType` prop shape from Task 1 (block `type === "callout"`).
- Produces: `extractCalloutChildren(html: string, parseHTML: (html: string) => Promise<AnyBlock[]>): Promise<{ strippedHtml: string; calloutChildren: AnyBlock[][] }>` and `attachCalloutChildren(blocks: AnyBlock[], calloutChildren: AnyBlock[][]): AnyBlock[]`, both exported from `calloutChildren.ts`. `BlockEditor.tsx`'s `insertHtmlAtEnd` calls both before inserting.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/components/editor/calloutChildren.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run components/editor/calloutChildren.test.ts
```

Expected: FAIL — `./calloutChildren` does not exist.

- [ ] **Step 3: Implement `calloutChildren.ts`**

```ts
// frontend/components/editor/calloutChildren.ts
type AnyBlockLike = { type: string; children?: AnyBlockLike[]; [key: string]: unknown };

export async function extractCalloutChildren<T extends AnyBlockLike>(
  html: string,
  parseHTML: (html: string) => Promise<T[]>
): Promise<{ strippedHtml: string; calloutChildren: T[][] }> {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const calloutDivs = [...doc.querySelectorAll('div[data-type="callout"]')];
  const calloutChildren: T[][] = [];
  for (const el of calloutDivs) {
    const children = await parseHTML(el.innerHTML);
    calloutChildren.push(children);
    el.innerHTML = "";
  }
  return { strippedHtml: doc.body.innerHTML, calloutChildren };
}

export function attachCalloutChildren<T extends AnyBlockLike>(
  blocks: T[],
  calloutChildren: T[][]
): T[] {
  let i = 0;
  function walk(list: T[]): T[] {
    return list.map((b) => {
      const children = Array.isArray(b.children) ? walk(b.children as T[]) : [];
      if (b.type === "callout") {
        return { ...b, children: calloutChildren[i++] ?? [] };
      }
      return { ...b, children };
    });
  }
  return walk(blocks);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npx vitest run components/editor/calloutChildren.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Wire the helpers into `insertHtmlAtEnd`**

In `frontend/components/editor/BlockEditor.tsx`, add the import:

```tsx
import { extractCalloutChildren, attachCalloutChildren } from "./calloutChildren";
```

Change `insertHtmlAtEnd` (currently around line 270):

```tsx
// from:
async insertHtmlAtEnd(html: string) {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const parsed = await editor.tryParseHTMLToBlocks(doc.body.innerHTML);
  const before = (editor.document as AnyBlock[]).length;
  ...

// to:
async insertHtmlAtEnd(html: string) {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const { strippedHtml, calloutChildren } = await extractCalloutChildren(
    doc.body.innerHTML,
    (h) => editor.tryParseHTMLToBlocks(h)
  );
  const rawParsed = await editor.tryParseHTMLToBlocks(strippedHtml);
  const parsed = attachCalloutChildren(rawParsed as AnyBlock[], calloutChildren);
  const before = (editor.document as AnyBlock[]).length;
  ...
```

(Everything after `const before = ...` stays unchanged — `parsed` now carries the attached children.)

- [ ] **Step 6: Run the full frontend test suite**

```bash
cd frontend && npm test
```

Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/editor/calloutChildren.ts frontend/components/editor/calloutChildren.test.ts \
  frontend/components/editor/BlockEditor.tsx
git commit -m "feat(editor): attach callout children during HTML ingestion"
```

---

## Task 3: Rewrite the mastery guide `SYSTEM_PROMPT`

**Files:**
- Modify: `backend/prompts/mastery_guide.py`
- Create: `backend/tests/test_mastery_guide_prompt.py`

**Interfaces:**
- Consumes: nothing new — `build_mastery_guide_prompt(source_text: str, title: str = "") -> str` keeps its exact signature (relied on by `backend/services/agent/...` callers and `note_synthesis.py`'s import of `SYSTEM_PROMPT`).
- Produces: same `SYSTEM_PROMPT` constant name, new content. Must still contain `{source_text}` interpolation via `build_mastery_guide_prompt` unchanged.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_mastery_guide_prompt.py
"""The mastery guide prompt must speak the callout dialect the BlockNote
schema now understands, and must no longer ask for blocks that don't exist
(data-importance headings, the quiz block, the metadata block)."""
from prompts.mastery_guide import SYSTEM_PROMPT, build_mastery_guide_prompt


def test_uses_callout_divs_not_the_broken_callout_syntax():
    assert 'data-type="callout"' in SYSTEM_PROMPT
    assert 'data-callout-type=' in SYSTEM_PROMPT
    assert 'data-color="blue"' not in SYSTEM_PROMPT  # the old, non-functional attribute


def test_defines_the_nine_callout_types():
    for callout_type in ["OVERVIEW", "NOTE", "TIP", "IMPORTANT", "WARNING",
                          "CAUTION", "FORMULA", "ANALOGY", "EXAM"]:
        assert callout_type in SYSTEM_PROMPT


def test_uses_text_color_not_the_broken_importance_attribute():
    assert "data-importance" not in SYSTEM_PROMPT
    assert "data-text-color" in SYSTEM_PROMPT


def test_defines_the_four_heading_levels():
    assert "<h2" in SYSTEM_PROMPT and "Chapter" in SYSTEM_PROMPT
    assert "<h3" in SYSTEM_PROMPT and "Section" in SYSTEM_PROMPT
    assert "<h5" in SYSTEM_PROMPT and "Concept" in SYSTEM_PROMPT
    assert "<h6" in SYSTEM_PROMPT and "Sub-case" in SYSTEM_PROMPT


def test_toggles_use_details_summary():
    assert "<details>" in SYSTEM_PROMPT and "<summary>" in SYSTEM_PROMPT


def test_drops_the_quiz_and_metadata_blocks():
    assert "data-type=\"interactive\"" not in SYSTEM_PROMPT
    assert "data-type=\"metadata\"" not in SYSTEM_PROMPT
    assert "Knowledge Check" not in SYSTEM_PROMPT


def test_states_the_color_hard_limits():
    assert "red" in SYSTEM_PROMPT and "2" in SYSTEM_PROMPT  # red ≤ 2 stated somewhere
    assert "orange" in SYSTEM_PROMPT


def test_build_mastery_guide_prompt_still_truncates_and_titles():
    prompt = build_mastery_guide_prompt("x" * 30000, title="My Lecture")
    assert SYSTEM_PROMPT in prompt
    assert "My Lecture" in prompt
    assert prompt.count("x") <= 20000 + 1  # source capped at 20k chars
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_mastery_guide_prompt.py -p asyncio -v
```

Expected: FAIL — current `SYSTEM_PROMPT` still uses `data-importance`, `data-color`, the quiz block, no callout divs.

- [ ] **Step 3: Replace `SYSTEM_PROMPT` in `backend/prompts/mastery_guide.py`**

Keep the file's docstring, `build_mastery_guide_prompt` function, and overall file shape — only replace the `SYSTEM_PROMPT` string body:

```python
SYSTEM_PROMPT = """IDENTITY
You are a senior student writing exam-ready notes from a lecture. These notes
are streamed live into a BlockNote block editor, block by block. Every
structural choice must map to a real BlockNote block — wrong structure means
lost content, not just ugly formatting.

BEFORE WRITING
Read the entire lecture end-to-end. Identify:
- The major conceptual themes and how many there actually are
- How concepts connect and build on each other
- What is actual content vs. structural filler (transitions, empty headings,
  rhetorical questions with no answer on the slide)
Discard filler. Cover everything else. Follow the lecture's own order — never
reorganize it.

STRUCTURE

| Level    | Tag                          | Use for                                    |
|----------|-------------------------------|---------------------------------------------|
| Chapter  | <h2 data-text-color="X">      | A major conceptual theme                     |
| Section  | <h3 data-text-color="X">      | A coherent cluster of concepts within a chapter |
| Concept  | <details><summary><h5>        | An atomic idea — the primary content unit    |
| Sub-case | <details><summary><h6>        | Worked example, derivation, or edge case     |

Use a plain <h4> only when a section is too dense for flat Concept toggles.
The number of chapters is decided by the lecture, not by this prompt — 2 real
themes get 2 <h2> chapters, 7 get 7.

Concept and Sub-case headings MUST be wrapped in <details><summary>...</summary>
so they render as collapsible toggles:
  <details>
    <summary><h5 data-text-color="orange">Concept name</h5></summary>
    ...concept body (callouts, blockquote, lists, tables, sub-case toggles)...
  </details>
Chapter, Section, and dense-section headings are plain <h2>/<h3>/<h4> — do not
wrap them in <details>.

CHAPTER PATTERN

Every chapter opens with an Overview callout right after its <h2>:

<h2 data-text-color="orange">Chapter Title</h2>
<div data-type="callout" data-callout-type="OVERVIEW">
  <p><strong>What:</strong> the chapter's essence in one meta-level line — what
  this chapter is DOING, not a list of what's inside.</p>
  <p><strong>How it breaks down:</strong></p>
  <ul>
    <li><strong>Section 1 title</strong> — what it covers or reveals, using the
    exact section name as the label</li>
    <li><strong>Section 2 title</strong> — same</li>
  </ul>
  <p><strong>Takeaway:</strong> one connection, trade-off, or perspective shift
  that only makes sense after understanding the sections. Test before writing
  it: could you write this from the chapter title alone, without having read
  the sections? If yes, cut it. If no genuine reframing insight exists, omit
  this paragraph entirely.</p>
</div>

<h3 data-text-color="X">Section 1 Title</h3>
<details><summary><h5 data-text-color="X">Concept A</h5></summary>...</details>
<details><summary><h5 data-text-color="X">Concept B</h5></summary>...</details>

<h3 data-text-color="X">Section 2 Title</h3>
<details><summary><h5 data-text-color="X">Concept C</h5></summary>...</details>

Sections contain Concept toggles directly — no Overview callout at the section
level, only at the chapter level.

INSIDE A CONCEPT TOGGLE

Default bias: structured blocks over prose. If you would write more than two
sentences about the same topic, restructure as bullets, a table, or a callout
instead.

- Single definition → first line of the toggle body is
  <blockquote><p><strong>Term:</strong> one sentence.</p></blockquote>
  Never open a concept toggle with a prose paragraph when its title names a
  concept. Multiple terms in one toggle → one <li><strong>Term:</strong> ...
  per term instead of a blockquote.
- Ordered steps / process / algorithm → <ol>, or a Step/Action/Result <table>.
  Never <strong>Step N:</strong> bullets — steps are sequences, not labeled
  facts.
- 3+ parallel facts, properties, or reasons → <ul>, never run-on prose. Any
  time you would write "X, Y, and Z" in a sentence, use a list instead.
- Cause → effect or condition → result → <ul> with bold labels:
  <li><strong>Cause:</strong> ... → <strong>Effect:</strong> ...</li>
- Contrast between EXACTLY two named things → an IMPORTANT callout, followed
  immediately by a comparison <table> as the next sibling block (not nested
  inside the callout). Never use IMPORTANT for pros/cons or for 3+ things.
- 3+ things compared on 2+ attributes → a <table>, never an IMPORTANT callout.
- Pros AND cons of the same thing → a TIP callout for the pro and a separate
  CAUTION callout for the con — never combined into one callout.
- Formula to memorize → a FORMULA callout naming what it's for, followed by
  <div data-type="math">LaTeX here, no dollar signs, no code fences</div>,
  followed by a <ul> breaking down each variable.
- Formula with a worked substitution → put the worked example in its own
  Sub-case (<h6>) toggle nested inside the Concept toggle.
- Example with sequential steps → a Sub-case toggle whose body is a
  Step/Action/Result <table> or an <ol> — never inline bullets.
- Summary of a mechanism or workflow → a NOTE callout with nested <ul>.
- Exam-guaranteed content → an EXAM callout stating the specific fact,
  formula, or rule that will be tested.
- Exam rule, hard constraint, or prerequisite → a WARNING callout.
- Common student mistake or false belief → a CAUTION callout.
- Non-obvious insight or shortcut → a TIP callout.
- Unfamiliar concept explained via a familiar analogy ("similar to", "like X
  in circuits", any physics<->electrical or concept<->everyday parallel) → an
  ANALOGY callout.
- Pure narrative with no list structure → 1-2 sentences max in a <p>. Longer
  than that, convert to bullets.

CALLOUT RULE
Callouts are always standalone blocks:
  <div data-type="callout" data-callout-type="TIP">
    <p>callout body — can contain <ul>, <table>, or nested <details> too</p>
  </div>
Never place a callout inside a list item or a table cell. Use at least two
different callout types per section — if every callout in a section is NOTE,
you are not using the palette.

CALLOUT TYPES (exactly these nine data-callout-type values)
OVERVIEW  — chapter overview (always, chapter level only)
NOTE      — summary of a mechanism, workflow, or neutral info
TIP       — non-obvious insight or shortcut
IMPORTANT — contrast between exactly two named things (always + a table next)
WARNING   — hard constraint, exam rule, or prerequisite
CAUTION   — common student mistake or dangerous misunderstanding
FORMULA   — formula to memorize (always followed by a math block + variable list)
ANALOGY   — analogy or mental model to build intuition
EXAM      — content that is exam-guaranteed

EXAM CALLOUT RULE
Every Concept toggle whose <h5> carries data-text-color="red" or "orange" must
contain at least one EXAM callout stating the specific fact, formula, or rule
the exam will test. Heading color alone does not signal exam importance.

HEADING COLOR SCALE (data-text-color on h2/h3/h4/h5/h6)
red    — exam-critical, will be tested
orange — core concept, non-negotiable
yellow — necessary to follow what comes next
green  — useful, part of the lesson
blue   — peripheral, good to know, not required
purple — negligible, safe to skip for exams
pink   — unsure, evaluate later

Hard limits per lecture: red on at most 2 headings, orange on at most 4,
yellow on at most 6. When in doubt, go one level lower. Only these seven
values plus "default" are valid — no other color name.

WHAT YOU DO NOT DO
- Reorganize the lecture's structure
- Force bullets everywhere — only for 2+ parallel items
- Pack depth into prose instead of distributing it across toggles, callouts,
  tables, and code
- Use data-importance or data-color anywhere — they do not exist, use
  data-text-color
- Apply a heading or callout color decoratively — always answer "what kind of
  content, or how important, or what relationship does this show?"
- Output anything other than valid HTML — no Markdown, no plain text
- Restate a heading's title as the first sentence under it

OUTPUT FORMAT
Start immediately with:

<h1>[Lecture Title]</h1>
<p><strong>Source:</strong> [source]</p>
<p><strong>Topic:</strong> [topic in plain language]</p>
<ul>
  <li>[Chapter 1 title]</li>
  <li>[Chapter 2 title]</li>
</ul>

<h2 data-text-color="X">Chapter 1</h2>
<div data-type="callout" data-callout-type="OVERVIEW">...</div>

<h3 data-text-color="X">Section 1.1</h3>
<details><summary><h5 data-text-color="X">Concept</h5></summary>...</details>

No preamble, no commentary — begin writing immediately with <h1>.

If the lecture is too long to finish at full quality in one response, finish
as many chapters as possible, then output a visible
<p><em>Paused — send "continue" to resume from Chapter N.</em></p>
and stop at a natural break point."""
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_mastery_guide_prompt.py -p asyncio -v
```

Expected: PASS (8 tests)

- [ ] **Step 5: Run the full backend test suite** (catches any break in `note_synthesis.py`'s verbatim-reuse test — expected to still pass since only `SYSTEM_PROMPT`'s content changed, not the constant name)

```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio
```

Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/mastery_guide.py backend/tests/test_mastery_guide_prompt.py
git commit -m "feat(prompts): rewrite mastery guide prompt for the new callout block"
```

---

## Task 4: Move the multi-source sync-anchor from `<h2>` to `<h3>`

The new hierarchy makes `<h2>` a coarse "Chapter" — too coarse to be the
per-source-location anchor. `<h3>` ("Section") is now the granular navigable
unit, so the multi-source synthesis feature's `data-anchor` mechanism must
move there. Both `<h2>` and `<h3>` are flat, top-level, non-toggleable blocks
in the parsed document (only Concept/Sub-case headings nest, via `<details>`),
so the existing flat (non-recursive) filtering logic in `NotePane.tsx` still
applies — only the target level number changes.

**Files:**
- Modify: `backend/prompts/note_synthesis.py`
- Modify: `frontend/components/workspace/NotePane.tsx`
- Modify: `backend/tests/test_note_synthesis.py` (extend, don't break existing assertions)
- Create: `frontend/components/workspace/anchorHeadings.test.ts`
- Create: `frontend/components/workspace/anchorHeadings.ts`

**Interfaces:**
- Produces: `findLevelHeadings(blocks: AnyBlock[], level: number): AnyBlock[]` extracted from `NotePane.tsx`'s inline filter, exported from `anchorHeadings.ts` for direct unit testing.

- [ ] **Step 1: Write the failing backend test**

Add to `backend/tests/test_note_synthesis.py` (new test, existing tests must keep passing untouched):

```python
def test_anchor_instruction_targets_h3_not_h2():
    prompt = build_note_synthesis_prompt(SOURCES)
    assert '<h3 data-anchor="SOURCE:TYPE:VALUE">' in prompt
    assert "data-importance" not in prompt  # old broken attribute, must be gone
    assert 'Do not put data-anchor on any element other than <h3>' in prompt
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_note_synthesis.py -p asyncio -v
```

Expected: FAIL — `ANCHOR_EXTENSION` still says `<h2>` and `data-importance`.

- [ ] **Step 3: Update `ANCHOR_EXTENSION` in `backend/prompts/note_synthesis.py`**

```python
# change:
ANCHOR_EXTENSION = """
SOURCE-INDEXED SYNC ANCHORS (mandatory for this note):
This note is displayed beside its sources and kept in sync with them. Every <h2>
section header MUST carry a data-anchor attribute of the form:

    <h2 data-importance="4" data-anchor="SOURCE:TYPE:VALUE">...</h2>

- SOURCE is the 1-based index of the source the section is anchored to — the n
  from the "=== SOURCE n ===" block the material came from.
- TYPE and VALUE depend on that source's tagging:
    video / audio source (lines prefixed [mm:ss] or [h:mm:ss]) → t:SECONDS
      SECONDS is where the section's material begins, in seconds.
    document / PDF source (text tagged [page N])               → p:PAGE
      PAGE is the 1-based page where the material begins.
    website source (text tagged [section N])                   → s:INDEX
      INDEX is the section number where the material begins.

Worked examples: data-anchor="1:p:14"   data-anchor="2:t:754"   data-anchor="3:s:6"

Anchors must be monotonically non-decreasing WITHIN one source; across sources
they may jump freely (you are organizing by concept, not by source).
Do not put data-anchor on any element other than <h2>.
Skip the interactive knowledge-check block for synthesized notes.
"""

# to:
ANCHOR_EXTENSION = """
SOURCE-INDEXED SYNC ANCHORS (mandatory for this note):
This note is displayed beside its sources and kept in sync with them. Every
<h3> Section header MUST carry a data-anchor attribute of the form:

    <h3 data-anchor="SOURCE:TYPE:VALUE">...</h3>

- SOURCE is the 1-based index of the source the section is anchored to — the n
  from the "=== SOURCE n ===" block the material came from.
- TYPE and VALUE depend on that source's tagging:
    video / audio source (lines prefixed [mm:ss] or [h:mm:ss]) → t:SECONDS
      SECONDS is where the section's material begins, in seconds.
    document / PDF source (text tagged [page N])               → p:PAGE
      PAGE is the 1-based page where the material begins.
    website source (text tagged [section N])                   → s:INDEX
      INDEX is the section number where the material begins.

Worked examples: data-anchor="1:p:14"   data-anchor="2:t:754"   data-anchor="3:s:6"

Anchors must be monotonically non-decreasing WITHIN one source; across sources
they may jump freely (you are organizing by concept, not by source).
Do not put data-anchor on any element other than <h3>.
"""
```

(The `Skip the interactive knowledge-check block` line is removed — the quiz block no longer exists in `SYSTEM_PROMPT` at all, so the instruction is stale.)

- [ ] **Step 4: Run the backend test to verify it passes**

```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/test_note_synthesis.py -p asyncio -v
```

Expected: PASS, including all pre-existing tests in this file (they assert on `data-anchor="SOURCE:TYPE:VALUE"`, `data-anchor="1:p:14"`, `t:SECONDS`/`p:PAGE`/`s:INDEX`, and `"one <h2> per source"` — none of which this edit touches).

- [ ] **Step 5: Write the failing frontend test for the extracted heading-finder**

```ts
// frontend/components/workspace/anchorHeadings.test.ts
import { describe, it, expect } from "vitest";
import { findLevelHeadings } from "./anchorHeadings";

describe("findLevelHeadings", () => {
  it("returns top-level heading blocks at the given level, in order", () => {
    const blocks = [
      { id: "a", type: "heading", props: { level: 2 } },
      { id: "b", type: "heading", props: { level: 3 } },
      { id: "c", type: "paragraph", props: {} },
      { id: "d", type: "heading", props: { level: 3 } },
    ] as any;
    expect(findLevelHeadings(blocks, 3).map((b: any) => b.id)).toEqual(["b", "d"]);
  });

  it("defaults missing level to 1 and excludes it from a level-3 search", () => {
    const blocks = [{ id: "a", type: "heading", props: {} }] as any;
    expect(findLevelHeadings(blocks, 3)).toEqual([]);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cd frontend && npx vitest run components/workspace/anchorHeadings.test.ts
```

Expected: FAIL — `./anchorHeadings` does not exist.

- [ ] **Step 7: Implement `anchorHeadings.ts`**

```ts
// frontend/components/workspace/anchorHeadings.ts
type AnyBlockLike = { type: string; props?: { level?: number } };

export function findLevelHeadings<T extends AnyBlockLike>(blocks: T[], level: number): T[] {
  return blocks.filter((b) => b.type === "heading" && (b.props?.level ?? 1) === level);
}
```

- [ ] **Step 8: Run it to verify it passes**

```bash
cd frontend && npx vitest run components/workspace/anchorHeadings.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 9: Wire it into `NotePane.tsx`**

Change the `collect` callback (currently around line 171-182):

```tsx
// from:
doc.querySelectorAll("h2").forEach((h) => {
// to:
doc.querySelectorAll("h3").forEach((h) => {
```

Update the comment above it from `One entry per <h2>` to `One entry per <h3>`.

Change `registerAnchors` (currently around line 130-144):

```tsx
// from:
const headings = blocks.filter(
  (b: AnyBlock) => b.type === "heading" && (b.props?.level ?? 1) === 2);
if (headings.length !== pending.anchors.length) {
  console.warn(
    `[workspace] anchor/heading mismatch: ${pending.anchors.length} <h2> in the draft ` +
    `vs ${headings.length} level-2 heading blocks — anchoring the first ` +
    `${Math.min(headings.length, pending.anchors.length)} only`);
}

// to:
const headings = findLevelHeadings(blocks, 3);
if (headings.length !== pending.anchors.length) {
  console.warn(
    `[workspace] anchor/heading mismatch: ${pending.anchors.length} <h3> in the draft ` +
    `vs ${headings.length} level-3 heading blocks — anchoring the first ` +
    `${Math.min(headings.length, pending.anchors.length)} only`);
}
```

Add the import near the top of `NotePane.tsx`:

```tsx
import { findLevelHeadings } from "./anchorHeadings";
```

Update the inline comment in `registerAnchors`'s forEach loop from `that <h2> carried no anchor` to `that <h3> carried no anchor` (cosmetic, keep it accurate).

- [ ] **Step 10: Run the full frontend test suite**

```bash
cd frontend && npm test
```

Expected: PASS, no regressions.

- [ ] **Step 11: Commit**

```bash
git add backend/prompts/note_synthesis.py backend/tests/test_note_synthesis.py \
  frontend/components/workspace/anchorHeadings.ts frontend/components/workspace/anchorHeadings.test.ts \
  frontend/components/workspace/NotePane.tsx
git commit -m "fix(workspace): move source-sync anchors from h2 to h3 to match the new chapter/section split"
```

---

## Task 5: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Start the app**

Use the project's `run` skill, or manually:
```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/uvicorn main:app --reload &
cd frontend && npm run dev
```

- [ ] **Step 2: Generate a mastery guide from a short real source**

In the browser, create/open a note, ingest a short lecture-like source (a PDF or pasted text with at least 2 distinct sub-topics so at least 2 chapters get generated), and trigger mastery-guide generation.

- [ ] **Step 3: Visually confirm, in the browser**

- Chapter (`h2`) and Section (`h3`) headings render as plain headings, colored per the importance scale, not collapsible.
- Concept (`h5`) and Sub-case (`h6`) headings render as collapsible toggles that expand/collapse on click.
- Every callout (Overview, and whichever of the 8 types the model used) renders as a distinctly colored box with its icon — not as flattened/lost text.
- A FORMULA callout's LaTeX renders as real KaTeX, not raw text.
- Any IMPORTANT callout is immediately followed by a comparison table.
- No `data-importance`, `data-color`, or literal `[!TYPE]`/`{color:X}` text leaks into the rendered note.

- [ ] **Step 4: If a multi-source note is easy to test, confirm sync-scroll still works**

Ingest 2+ sources into one note, generate a synthesized note, and confirm clicking a source's timestamp/page still scrolls the note to the right `<h3>` Section (not broken by the h2→h3 anchor move).

- [ ] **Step 5: Report back**

Note any visual issues found (they are follow-up polish, not blockers for this plan) and confirm the core flow — toggles collapse, callouts render in color, formulas render as KaTeX — works end to end.
