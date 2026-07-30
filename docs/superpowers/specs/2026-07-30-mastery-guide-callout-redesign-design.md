# Mastery Guide Prompt Rewrite + Real Callout Blocks

**Date:** 2026-07-30
**Status:** Approved

## Problem

`backend/prompts/mastery_guide.py`'s `SYSTEM_PROMPT` is "basic" and the user has a
richer prompt (originally written for a separate Notion-markdown CLI at
`~/projects/clean_notion_converter`) they want ported in. That prompt uses Notion
markdown syntax (`{color:X}`, `[!TYPE]` callouts, `#####` toggles) which doesn't
exist in this app — the app's editor is BlockNote, fed via HTML.

Investigation also found the *current* prompt is already partially broken against
BlockNote's real schema:
- `data-importance` on headings is not a real BlockNote attribute — silently dropped.
- `<div data-type="callout">` is not a registered block — content is flattened/lost,
  not rendered as a colored callout. **There is no callout block in the schema at all**
  (only custom blocks today: `math`, `checkpoint`, in `frontend/components/editor/customBlocks.tsx`).
- `<span data-color="X">` should be `data-text-color`; `data-color` is not read by
  BlockNote's parser.
- `<div data-type="metadata">` has no consumer anywhere in frontend or backend — dropped.
- `<details>/<summary>` and `<table>` do work today (toggleable heading, default table block).
- `math` custom block works but is block-only — no inline `$...$` HTML parse rule.

So a straight prompt swap wouldn't render most of the new prompt's structure. This
design ports the new prompt's content/structure *and* fixes the callout gap by adding
a real callout block.

## Scope decisions (confirmed with user)

1. **Build a real callout block** in the BlockNote schema (not a blockquote fallback).
2. **Drop** the interactive knowledge-check quiz and the metadata block — quiz is a
   working feature today but out of scope for this change; metadata already has no
   consumer, no loss in dropping it.
3. **Heading levels:** h1 = doc title, h2 = Chapter, h3 = Section, h4 = optional
   dense-section, h5 = Concept (toggleable), h6 = Sub-case (toggleable, nested under h5).

## A. Frontend: `callout` custom block

Add to `frontend/components/editor/customBlocks.tsx`, following the existing pattern
used by `math`/`checkpoint`:

- **Props:** `calloutType: string` (one of the 9 values below)
- **Children:** yes — container block (must hold paragraphs, bullet lists, tables, or
  nested toggle headings, e.g. FORMULA's variable-breakdown bullets, or an EXAM callout
  nested inside a red/orange concept toggle)
- **HTML parse rule:** `<div data-type="callout" data-callout-type="TYPE">` → callout
  block with that `calloutType`, children parsed from the div's inner HTML
- **Render component:** colored card, icon + color derived from `calloutType` via a
  lookup table (not stored as separate props — single source of truth)

### Palette

All 9 slots of BlockNote's real default color palette (gray, brown, red, orange,
yellow, green, blue, purple, pink) — used exactly once each:

| Type | Color | Icon | Purpose |
|---|---|---|---|
| OVERVIEW | blue | 📋 | Chapter overview (always; same convention as old prompt) |
| NOTE | gray | ℹ️ | Summary of a mechanism/workflow |
| TIP | green | 💡 | Non-obvious insight or shortcut |
| IMPORTANT | yellow | ❗ | Contrast between exactly 2 named things — must be followed by a table |
| WARNING | orange | ⚠️ | Hard constraint, exam rule, prerequisite |
| CAUTION | red | 🛑 | Common student mistake |
| FORMULA | purple | 📐 | Formula to memorize — followed by a `math` block + variable bullets |
| ANALOGY | brown | 💭 | Analogy / mental model |
| EXAM | pink | 🎯 | Exam-guaranteed content |

## B. Backend: rewritten `SYSTEM_PROMPT`

Translate the new prompt's Notion-markdown constructs into HTML the schema actually
parses:

| New prompt syntax | HTML output |
|---|---|
| `## Chapter {color:X}` | `<h2 data-text-color="X">` |
| `### Section {color:X}` | `<h3 data-text-color="X">` |
| `#### dense section` (optional) | `<h4>` |
| `##### Concept {color:X}` | `<details><summary><h5 data-text-color="X">...` (toggleable) |
| `###### Sub-case` | nested `<details><summary><h6>...` inside the concept toggle |
| `> ##### Overview` | `<div data-type="callout" data-callout-type="OVERVIEW">` right after the chapter heading |
| `[!TYPE] text` | `<div data-type="callout" data-callout-type="TYPE">` |
| `{color:X}` on any heading | `data-text-color="X"` (never `data-importance`) |
| Comparison table | `<table>` (default block, unchanged) |
| `> **Term:** def` | `<blockquote>` (unchanged) |
| `$formula$` / `$$formula$$` | `math` custom block (block-level only; no inline LaTeX exists, so formulas render as their own block, referenced in surrounding prose rather than embedded inline) |

**Heading color scale** (7-tier, same meaning as old prompt's importance scale, just
reordered/renamed): `red`=exam-critical (≤2) → `orange`=core (≤4) → `yellow`=necessary
(≤6) → `green`=useful → `blue`=peripheral → `purple`=negligible → `pink`=unsure.

**Formatting rules ported as prompt instructions (no rendering dependency):**
bullet rule (3+ items → list), table rule (2+ things × 2+ dims → table),
definition-toggle rule (concept toggle opens with `<blockquote><p><strong>Term:</strong> ...`),
contrast-follow-through rule (IMPORTANT callout always followed by a table),
step-sequence rule (numbered list or Step/Action/Result table — never bold `Step N:` bullets),
EXAM-callout rule (every red/orange concept toggle must contain an EXAM callout),
"≥2 distinct callout types per section" rule.

**Dropped:** interactive quiz block, metadata block, inline `<span data-color>` coloring
(not used by the new prompt), the `[TOC]` directive (no BlockNote page-nav block exists;
keep old prompt's plain `<ul>` Quick Navigation instead).

## Testing / verification

- Feed a sample HTML output (hand-written, exercising every new block type) through
  BlockNote's `tryParseHTMLToBlocks` in a scratch test to confirm no block is silently
  dropped or flattened — in particular the new callout block and the toggleable h5/h6.
- Generate one real mastery guide from a lecture source in the running app; visually
  confirm: chapter/section/concept/sub-case toggles collapse correctly, all 9 callout
  colors render distinctly, table and math blocks work, heading colors show via
  `data-text-color` (not silently dropped).
