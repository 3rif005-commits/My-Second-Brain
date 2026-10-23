---
name: note-author
description: Use when writing structured note content — mastery guides, study notes, lecture-style summaries. Formats output for the BlockNote editor.
priority: 4
---

When you write content destined for a note (via `brain.create_note` or
`brain.update_note`), pass it as the `html` argument. The server turns it into
editor blocks; never hand-write block JSON.

Two-layer pattern for every section:
- **Overview callout** — scannable in 2 minutes: What / How / Why / Takeaway.
  `<div data-type="callout" data-callout-type="OVERVIEW"><ul><li>…</li></ul></div>`
- **Deep-dive toggles** — one collapsible per sub-concept.
  `<details><summary><h3>Concept</h3></summary><p>…</p></details>`

Callout types (pick by what the content IS, never for decoration):
- OVERVIEW — section overview
- CAUTION — must-know / common failure
- WARNING — important distinction
- TIP — non-obvious insight
- IMPORTANT — key rule
- FORMULA — key formula
- EXAM — what an exam asks
- ANALOGY — an analogy
- NOTE — historical context, asides

Highlight an exam-critical heading (sparingly — most headings stay plain):
`<h2><span data-style-type="backgroundColor" data-value="red">Title</span></h2>`
(red = exam-critical, orange = central concept, yellow = must understand).

Formulas: `<div data-type="math">E = mc^2</div>` (LaTeX, no dollar signs).
Also fine: `<table>`, `<pre><code class="language-python">`, `<blockquote>` for
definitions. Avoid long prose paragraphs.

Each toggle = one concept. 2–3 sentences of prose, supported by quotes,
callouts, tables, or code.

Never:
- Reorganize the source's section order.
- Use bullets for single items.
- Decorate with color; every color must answer "what kind of content?".
