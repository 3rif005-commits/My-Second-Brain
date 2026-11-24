# Phase 1: the worksheet loop (Map → Write → Check → Fix)

Design: `docs/INTERACTIVE_NOTES_DESIGN.md` (approved 2026-11-24). This file is the build list;
tick items as they land.

## Shape

- `/solve-worksheet` in the AI panel no longer writes the whole note. It **maps** (one call),
  and the result is a **skeleton** plus the plan (`kind: "units"`).
- The skeleton goes into the note at once (decision 1): the same rule as Insert, so an empty
  note is filled and a note with text gets it appended. Each unit heading carries
  `data-unit="KEY"`, read before BlockNote parses the HTML (like `readDraftAnchors`) and bound to
  its block id.
- The card says what was found and offers **Solve all · $x** (decision 2: pause after the map).
- Solve all = one call per exercise (decision 3), 4 in parallel, streamed back as each finishes.
  Each exercise replaces its skeleton heading, unless you have edited it since. Then one last
  call writes the Overview and the revision sheet. The answer key is built from the bands, with no model.
- Each unit heading gets a mark in the margin. Click it to get: source page (the sheet opens
  with the question tinted), Mark checked, Redo, Redo with a note. A Redo replaces the unit and
  offers Keep / Back to old.
- A line at the top of the note: "N of M checked · K to look at".

Unit keys: the path in the plan. `"1"` is exercise 1, `"1.2"` its second question, and
`"1.2.1"` that question's first sub-part. Two special keys: `"overview"` and `"revision"`.

## Backend

- [x] `supabase/migrations/035_note_units.sql`: table `note_units`, one row per unit,
      unique `(note_id, key)`, RLS owner policy, `NOTIFY pgrst`. **The user runs it before the push.**
- [x] `services/workspace/units.py`:
  - `plan_prompt` / `parse_plan`: the skill text + sources + MAP_NOTE → JSON. The result is
    checked: keys assigned, each quote looked for in its source (`quote_found`), and a page
    given when the model left it out.
  - `skeleton_html(plan)`: h1, an Overview placeholder, the exercises as nested toggle headings
    with the grey question line, the highlights, and the revision placeholder.
  - `write_exercise(...)`, `redo_unit(...)`, `finish_sheet(...)`: the skill text + sources
    (cached prefix) + an engine note for this call → HTML through `skill_html.finish`.
    `data-unit` is restored by heading order if the model drops it.
  - `free_checks(unit_html, unit, sheet_text)`: no band or two bands; a number in the grey
    question that is not in the sheet; the quote not found in the sheet.
  - `answer_key(doc_html)`: a Q | Answer table from the bands.
- [x] `skill_run.produce_skill_result`: `solve-worksheet` → `units.map_result(...)`.
  `batch_eligible` → False for it (a plan is not one call).
- [x] Routes (`note_sources.py`): `GET /notes/{id}/units`, `PUT /notes/{id}/units/bind`,
  `POST /notes/{id}/units/solve` (SSE), `POST /notes/{id}/units/{key}/redo`,
  `PATCH /notes/{id}/units/{key}`.
- [x] Tests: plan parsing and checks, skeleton shape (parses through the worksheetDraft
  path), unit-key restore, free checks, answer key, and the solve stream with a fake model.

## Frontend

- [x] `lib/units.ts` (pure, tested): types, `readDraftUnits`, `bindUnits`, `unitMarks`.
- [x] `NoteDraft.units` → NotePane binds keys to block ids after the insert and PUTs them.
- [x] NotePane `fillUnit(key, html)` / `replaceUnit` (skip edited units) and a window event
      so the panel can feed it.
- [x] Margin marks + popover; the top progress line; unit quotes added to the tinted passages.
- [x] Panel card for `kind: "units"`: found N · Solve all (price) · progress · errors.
- [x] `/api/ws` allow-list already covers `notes/…` (nothing to add).

## Checks before push

`cd frontend && npx tsc --noEmit && npx vitest run components/editor lib` (relevant subset), the
backend tests for the new files, and a live run on the deployed site after the user runs 035.

## Not in Phase 1

The AI check, Refresh per rule, "Add as a question", chat → unit suggestions, the editor AI
with unit context, the study guide, and a live (self-updating) answer key block.

## Status (2026-11-24)

Built and tested offline: backend 15 tests in `tests/test_units.py` (plus the skill, chat-skill
and job suites, 161 passed), frontend `lib/units.test.ts` (the backend's own skeleton and
exercise parsed through the editor's real path; every key binds), `tsc` clean, the related
frontend suites pass.

**Not yet:** migration 035 run in Supabase, then the push, then a live run on a real worksheet.

Known limits, left for later:
- If an exercise fails during Solve all, "Solve the rest" writes it, but the revision sheet is
  only written when one run writes every exercise.
- The price shown before `/solve-worksheet` is the old one-call estimate. The map costs less;
  the card shows Solve all's own price.
- "Run later" (background jobs) for solve-worksheet runs the map only, and its card doesn't
  know the units flow yet.
- A note holds one solving plan: mapping a second worksheet into the same note replaces the
  first one's marks (its text stays).
- A mark inside a closed toggle shows only once the toggle is opened; the exercise's mark
  summarizes what is inside it.

## Live test on ESD 2 Tutorial 3 (2026-11-24, deployed site, Nemotron)

Checked in Chrome on the user's worksheet note: map (4 exercises, 8 questions, all tinted),
Solve all from the card (hands the run to the note) and from the note's line, Overview,
revision sheet (Rules & formulas boxes + answer key, 9 rows), marks, Next, the sheet link,
Mark checked, Redo with a note, Keep / Back to old (also after a reload), the menu closing,
and Insert after solving (appends, the parts stay; Undo restores it).

Found and fixed during the test (11): an Insert after Solve all replaced the whole note; Solve
all lost on reload; progress counted parts no longer in the note; several bands flagged; "5
chapters" summary; revision sheet never written (no row for its heading); a quote with a maths
letter (𝑌) not found and linked to the solution page; one-sub-part questions nested; a redone
part arrived closed; Back to old did nothing after a reload; the menu stayed open and could sit
off-screen. Also: an exercise with no words of its own takes its first part's page.

## K-maps, circuits and logic answers (2026-11-24, live on ESD 2 Tutorial 3)

The user found the solved worksheet had no Karnaugh map and no circuit. Causes: SKILL.md forbade
drawing circuits and didn't know K-maps; the plan had no idea what an answer must show; the
checks only looked for a band. Built and checked live:
- SKILL.md (user-approved): circuits as Mermaid gate diagrams, PLA/PAL programming tables, K-maps
  as Gray-code tables.
- "Needs:" per part (migration 036), editable in the note and sent with Solve all, plus a code
  safety net (a K-map per Σ-function of 3–4 variables; table and circuit for design with a
  PLA/PAL; nothing for "explain/would…" questions).
- Free checks: a missing need is flagged; Boolean answers are checked on every input
  (`logic_check.py`); one repair pass for missing items, a missing band and wrong functions.
- When code knows the answer (≤ 6 variables, Quine–McCluskey) a red **Computed check** box under
  the band gives the correct simplest form. Live: Nemotron kept its wrong K-map group even when
  given the right form, so the box is what keeps the note right.
- Diagrams inside closed toggles were drawn at size zero (a flat line); they now redraw when shown.

Still weak: Mermaid circuits are tangled boxes and arrows, and a wrong circuit isn't caught
(see docs/CIRCUIT_SCHEMATIC_BLOCK.md). Nemotron rarely fixes its own working.
