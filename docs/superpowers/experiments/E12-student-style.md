# E12 — the study guide learns the student's style (suggestions, never forced)

**Status:** 2026-09-26 — built, measured with a simulated student, live in
the app. **User applies migration 022** before "Learn from my edits" has data.
Spent $0.34 (two eval runs). The study-guide instructions were not edited;
with no style, the prompt is byte-identical to before (checked).

## Found first
The app did not keep what the AI wrote: a guide lived only in the browser
until it went into the note, so there was nothing to compare the student's
edits with. And the user has no real edited guides yet — so the learner is
tested with a simulated student.

## Built
- **Your style** (`skills/study-guide/reference/style.md`, Settings → Skills →
  Study guide → Your style): the student's preferences, one per line; comments
  are never sent. Added AFTER the instructions and the engine rules, before the
  sources (inside the cached fixed part), and repeated once at the very end.
  Applies to one-pass and chaptered guides.
- **Recording:** "Put in note" / "Insert here" stores the AI's version
  (`POST /notes/{id}/ai-outputs` → table `ai_outputs`, migration 022). Best
  effort — never blocks the insert.
- **Learn from my edits** (`POST /skills/study-guide/learn-style`): the AI's
  versions vs the notes as the student left them (edited ≥ 60 s after the
  insert), compared on what survives the editor (boxes by type, tables,
  formulas, headings, text, passages added/removed), one short model call →
  up to 5 SUGGESTIONS with evidence. The student clicks Add, then Save.
  Nothing reaches a guide unaccepted. No edited guides → a message, no model.

## Measured (`python -m evals.style_eval --generate 3`)
Simulated student on 5 real AI guides: deletes every ANALOGY box; ends every
chapter with a "Key takeaways" list.

| | run 1 | run 2 (after the fix) |
|---|---|---|
| learner found "no analogy boxes" | yes | yes |
| learner found "Key takeaways" | yes | yes |
| wrong extra suggestion | 1 ("more subheadings" — a side effect of the added heading) | 1 (same) |
| new guides: analogy boxes | 0, 0, 0 | 0, 0, 0 |
| new guides: chapters with Key takeaways | **1 of 11** | **9 of 9** |
| quality guard vs the approved note (median of 3) | PASS | PASS |

Run 1 had the style only in the middle of the prompt, as preferences: the
model mostly ignored the additive one. Run 2 calls them requirements and
repeats them at the very end — followed in every chapter. The extra
suggestion stays a suggestion: the student does not add it. (A rule telling
the learner to skip side effects did not remove it.)

## In the app
`settings-skills` e2e (free): the study guide shows "Several sources:
Automatic" and a Your style tab; "Learn from my edits" answers (before
migration 022: "Apply supabase/migrations/022_ai_outputs.sql first.");
nothing is saved.
