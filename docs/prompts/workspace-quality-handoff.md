# Workspace output quality — handoff (written 2026-09-04, session end)

You are continuing work on the **Workspaces** feature of Second Brain
(`/home/ayoub/projects/second_brain`, branch `feat/notion-databases-ui-parity`).
Everything below is uncommitted in the working tree — 21 modified files plus two
new ones. Last commit is `d6eb1b5`.

## What this feature is

`/brain/workspace/<noteId>` — one note plus the sources attached to it (PDF,
markdown/txt, YouTube, video, website). Sources are extracted, chunked, and one
AI synthesis writes the whole note. The output must match the user's own
lecture-note format: chapters → sections → collapsible concept toggles, dense in
callouts, tables, and formulas.

**The user's format spec is `docs/prompts/lesson-notes-notion-dialect.md`.** That
is the prompt he actually uses by hand, in Notion's markdown dialect.
`backend/prompts/mastery_guide.py` is the HTML dialect of the same rules and is
what the app really sends. When the two disagree, the .md file is the intent.

## The single most important fact about this pipeline

`pages_text` is the **only** path to the model:

```
extract → pages_text → chunk_pages → resource_chunks rows
                                   → synthesis.source_text_from_chunks → prompt → Claude
```

Anything held only in `elements` is for the VIEWER and the model never sees it.
`_insert_chunks` IS the handoff.

## Model

Claude **Haiku 4.5** (`claude-haiku-4-5`, no date suffix), key in `backend/.env`
as `ANTHROPIC_API_KEY`. `providers.list_providers()` pins Anthropic first with a
stable sort so a saved row in the `ai_providers` table cannot take the job back.
`client._anthropic_complete` streams internally and surfaces the response body on
error. A synthesis run takes 90 s – 10 min.

---

## Verified working (measured, not assumed)

Extraction, on the real lecture `~/Downloads/Lect10-IML26.pdf` (17 slides):

| | before | after |
|---|---|---|
| source tables reaching the model | 0 of 14 | **14** |
| headings marked | 3 | **17** |
| formulas detected | 0 | **20** |
| input budget | 24 000 chars | 180 000 |

- **Tables** were detected, converted to markdown, and then *excluded* from
  `pages_text` with nothing put in their place. Now spliced back at their
  vertical position (insertion, never a global re-sort — sorting by `y`
  interleaves the columns of a two-column paper).
- **Headings**: the old rule `size >= doc_median * 1.35` cannot find slide
  titles (real deck: 14.3 pt titles vs 12.8 pt body = 1.12×). Loosening the ratio
  is the WRONG fix — at 1.04× it marked 102 of 339 blocks. It is now a union of
  the global ratio rule and a slide rule (largest text near a page's top, above
  the document's MODAL block size).
- **PowerPoint mojibake** (`pdf_elements.repair_text`): a .pptx export encodes
  glyphs, not text. Subscripts land in the **Odia block** — `୭ୠୱୣ୰୴ୣୢ` is exactly
  "observed", a clean linear offset from U+0B5F — bold maths lands in
  Mathematical Alphanumerics (NFKC fixes it), and Symbol/Wingdings land in the
  private use area. Same glyph signature is the only way to detect a PowerPoint
  equation, since `_MATH_FONT` looks for TeX font names a .pptx never has.
- **md/txt** were tagged `[page 1]` entirely and routed to `PdfViewer` (react-pdf
  cannot parse a `.md`, so they never rendered). New
  `services/workspace/sections.py` splits them like a website;
  `WebsiteViewer` renders both.

Colour, in the note:

- **Heading colour used to bleed into the whole block.** BlockNote ships
  `.bn-block:has(> .bn-block-content[data-text-color=orange]) { color: … }` and
  `.bn-block` wraps the heading *and* its children, so an orange concept toggle
  turned its entire body orange. Measured: 18 of 26 toggles bleeding → **0**
  after the fix in `globals.css`.
- The prompt now asks for an **inline highlight span**, not a block attribute.
  Tested through the real parser:
  | markup | parses to |
  |---|---|
  | `<h3 data-background-color="orange">` | block prop → bleeds |
  | `<span data-style-type="backgroundColor" data-value="orange">` | **inline style ✅** |
  | `<span style="background-color:orange">` | inline style ✅ |
  | `<mark>` | silently ignored |
  This matches the user's rules doc: *"On headings and toggles, `{color:name}` is
  applied as a text annotation (highlights the words), not as a block
  background."*
- **Overview** is now a collapsible toggle inside the Overview box:
  `<div data-type="callout" data-callout-type="OVERVIEW"><details><summary>Overview</summary>…`
  → `callout → toggleListItem "Overview" → body`. This is the user's
  `> ##### Overview` (gray quote containing a toggle).
  **`<blockquote><details>…</details></blockquote>` silently discards the entire
  body — do not use it.**

## The prompt, measured properly (2026-09-04)

The three-run table this document used to carry read a trend into three samples
of three different configurations. **It was noise.** Re-running the UNCHANGED
prompt five times on the same PDF gives:

| | run 1 | run 2 | run 3 | run 4 | run 5 |
|---|---|---|---|---|---|
| math blocks | 17 | 4 | 8 | 4 | 3 |
| tables | 8 | 6 | 3 | 7 | 11 |

Same prompt, same input, same model. Math 3–17 and tables 3–11 is the noise
floor, and the old 16→13→3 / 3→5→9 story fits inside it. **Nothing about this
prompt can be concluded from n=1, and very little from n=3.** Every number
below is n≥5, most n=10.

### The harness

`extract_pdf → chunk_pages → source_text_from_chunks → build_note_synthesis_prompt
→ complete()` reproduced offline, so a config can be run ten times in parallel in
two minutes instead of ten UI round-trips. Metrics are counts of literal strings
in the model's raw HTML, and the HTML→block-tree mapping was verified 1:1 live
(7 `<div data-type="math">` in a draft became exactly 7 `math` blocks in the
note), so counting the HTML is legitimate.

### What shipped, versus the old prompt (n=10 vs n=5)

| | before | after | |
|---|---|---|---|
| math blocks | 7.2 `[3–17]` | **15.1** `[8–18]` | p = 0.031 |
| runs inside the colour budget | **0 / 5** | **10 / 10** | red ≤2 · orange ≤4 · yellow ≤6 |
| concept toggles opening with the definition blockquote | 56 % | **90 %** | |
| tables | 7.0 `[3–11]` | 7.1 `[5–11]` | p = 0.65 — unchanged |
| block-level colour (the bleed bug) | 0 | 0 | |

Three edits, each validated on its own before the next:

1. **SOURCE COVERAGE** — the table rule and a new equation rule merged into ONE
   section instead of two competing ones. Tried separately first: a standalone
   equation rule symmetric to the table rule DID double the maths, but cost
   tables (7.0 → 4.6) and made the model drop the FORMULA callout wrapper
   entirely (3.2 → 0.6 per run), emitting bare math blocks in its place. Merging
   them, with "neither of the two outranks the other" said explicitly and the
   FORMULA-callout structure restated, recovered both.
2. **Plain headings in every skeleton.** This is the colour fix, and the cause
   was never counting — *every structural example in the prompt showed a
   highlighted heading*, so the model copied the template: 2.6 of 3.0 chapter
   titles came out highlighted. Writing the skeletons bare dropped that to 0.4
   and took orange from 6.2 to 3.2 in one edit. Two attempts to fix this by
   rewriting the "how to spend the budget" prose — once longer and more
   mechanical, once much shorter — both made it WORSE (hl_total 10.8 → 18.2 and
   → 22.8). Leave that block alone; it earns its length.
3. **Term-shaped toggle titles** — "Temporal Difference Error", not "Why the
   Q-value Was Wrong". Titles that are questions invite prose; this is what
   moved definition-first from 56 % to 90 %, and it also firmed up tables
   (min 3 → min 5).

### The one real lesson

This prompt behaves like a fixed attention budget. Every emphatic addition took
something from another rule, in all three directions tried, and the two edits
that worked did so by REPLACING template text rather than adding exhortation.
Measure the whole metric table after any prompt change, not just the thing you
were trying to fix.

## `applied_at` — verified live

Verified on a fresh 111-block note, not by inspection. Network timeline from the
apply:

```
203763 start PATCH /api/notes/<id>          BlockEditor's own flush
203768 start PATCH /api/notes/<id>          persistApplied's save
205350 end   PATCH ... 200
205351 start POST  .../synthesis/applied    1 ms after the confirmed write
206121 end   POST  ... 200                  applied_at recorded
```

`markSynthesisApplied` is now strictly gated on a 200 from the note write. The
old code fired it synchronously after `api.apply()` — before the PATCH had
started, ~1.6 s earlier here, and on the replace path before BlockNote had even
parsed the HTML. The window that stranded drafts is closed. The same run also
confirmed 0 empty callouts, 0 block-level colour, and highlight spans landing as
inline styles.

## Vision — built, and OFF on purpose

`services/workspace/figures.py` + `synthesize_vision` in the router + a
`FIGURE_EXTENSION` in the prompt. It works. It is gated behind
`WORKSPACE_SYNTHESIS_VISION` (default false), because when it was measured it
did not pay:

- The "26 figures per lecture" figure was misleading. 26 crops, but only **9
  distinct** — the university logo alone is 16 of them, once per slide — and
  after dropping page furniture and flat-filled template panels, **6** are sent.
  Exactly **one** is a real diagram (the Sutton & Barto agent/environment loop
  on page 3). The rest are the robot clip-art icon.
- Over 5 runs with the figures attached, nothing appeared that the text-only
  runs missed. The loop diagram's distinctive content (its `S_t` / `A_t` /
  `R_{t+1}` labelling) appeared in 0 of 5 runs; the deck's text already names
  the five components the diagram draws.
- Colour-budget compliance fell from 10/10 runs to 4/5 (3/5 with the raw
  undeduplicated crops).

So the plumbing is done and tested (24 tests) and one env var turns it on. It
needs a genuinely diagram-heavy source to be worth it — re-measure there before
making it the default.

## Found while verifying: math inside a table cell was being deleted

A BlockNote table cell holds INLINE content only, so a block-level
`<div data-type="math">` inside a `<td>` is dropped by the parser — silently,
and the table still comes out well-formed with an empty column. Caught live: a
Step / Computation / Result table reached the note with all three of its
formulas gone and only the step names and the answers left.

The two prompt rules collide on every worked example — steps go in a
Step/Action/Result table, formulas are math blocks — so this was going to keep
happening. Fixed in code rather than in the prompt, because a code fix cannot
cost some other rule its attention:
`inlineMathInTableCells()` in `components/editor/calloutChildren.ts`, called by
both parse paths in `BlockEditor.tsx`, flattens a stranded math block to its
LaTeX source text. Ugly in the cell, but present. Two tests in `calloutChildren.test.ts` run the REAL BlockNote parser on the
exact markup: one asserts the loss (`["1. Bellman", "", "-0.85"]`), the other
asserts the fix (`["1. Bellman", "Q(s,a) = R + \\gamma m", "-0.85"]`). If
BlockNote ever supports block content in a cell, the first test fails and tells
you.

**Proven at the parser level, not end-to-end.** Re-synthesising to get a draft
that puts math in a cell again is a coin flip — the next three runs did not —
and the app appended rather than replaced, so the old broken table stayed in the
note. The parser is where the content was being dropped, so that is the layer
the test pins; an end-to-end confirmation is still owed.

## What is still open

1. **Definition-first is 90 %, not 100 %.** Of 187 concept toggles measured, 19
   still open with something other than the blockquote. Most of those have titles
   that are phrases rather than terms, which the user's own spec does not
   actually require a `> **Term:**` line for — so part of the remaining 10 % is
   the metric being stricter than the spec, not a defect. Decide which before
   spending another edit on it.
2. **Anchors still run backwards occasionally** — 0.6 per run, one or two `<h3>`
   anchors out of ~14. The rule has been strengthened twice without fixing it;
   this is probably better solved in code (sort/repair the anchors on apply)
   than in the prompt.
3. **Tables are at the source's real ceiling, not below it.** Worth recording,
   because the old handoff said "5 of 14 source tables still lost": the deck has
   10 pipe-table blocks but only **3 semantically distinct** tables — the Q-table
   appears six times with updated numbers, the reward grid three times — and the
   prompt explicitly allows merging repeats. Output averages 7.1 tables. There is
   no table loss to fix; the 14 was counting the same table six times.
4. **Vision needs a diagram-heavy source to be judged.** See above.
5. **Video sources are still audio-only**, and `formula_to_latex` still only
   fires on a user click. Both untouched.

## Traps — read before measuring anything

1. **Never judge note fidelity from text copied OUT of the editor.** Markdown
   serialisation drops toggles to `*`, invents an empty table header row, and
   turns rendered KaTeX into mangled unicode. All three looked like bugs; none
   were. Read the block tree via `GET /api/notes/<id>`.
2. **BlockNote parses `<details><summary><hN>` into `heading` + `isToggleable:
   true`, NOT `toggleListItem`.** Counting block types by name makes 26 working
   toggles look like zero. (`toggleListItem` is what the Notion-import path
   produces, which is why both appear in this codebase.)
3. **Callout children need the two-phase dance.** Raw
   `tryParseHTMLToBlocks(html)` produces callouts with EMPTY bodies — BlockNote
   cannot reconstruct nested callout children. The app lifts them out with
   `extractCalloutChildren` and reattaches with `attachCalloutChildren`
   (`components/editor/calloutChildren.ts`). Replicating an apply by hand without
   this emptied all 29 callouts and nearly got reported as a product bug.
4. **An unknown `data-callout-type` does not fail loudly** — it silently renders
   as a grey NOTE. Invented types look fine and are not.
5. Wait for the settle before judging: 2 s autosave, delete+refresh, proxy round
   trips.

## Running it

```bash
./app.sh start | stop | status | logs      # backend + frontend + llama.cpp
tail -f /tmp/second-brain-backend.log      # synthesis progress lives here
```

Two venvs, deliberately: `backend/.venv` is the RUNTIME one (has pymupdf,
trafilatura, faster-whisper); `backend/venv` is the TEST one.

```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 ./venv/bin/python -m pytest tests/ -p asyncio -q
cd frontend && npx tsc --noEmit
```

Current: **1878 passed, 0 errors.** The ~448 Notion-databases errors the old
handoff told you to ignore are gone — that harness's Postgres is reachable now.
`pillow` is a direct dependency (figure downscaling) and is declared in
`requirements.txt`; the TEST venv needed it installed explicitly.

Test PDF: `~/Downloads/Lect10-IML26.pdf`. Test note used this session:
`/brain/workspace/6cb7e33f-dae4-4641-b687-8b7b75fe2338`.

## How the user wants this done

Measure before claiming. He caught a "verified" report that was really a block
count, and he was right. Report what is proven, what is not, and what you got
wrong — separately.
