# Notes you can check, fix and steer: design

2026-11-24 · covers the `study-guide` and `solve-worksheet` skills · status: **approved 2026-11-24 (all five recommendations in §7); Phase 1 plan: `docs/plans/2026-11-24-units-phase1.md`**

## 1. The problem

Both skills write the whole note in one model call. The study guide splits long material into
chapter calls, but each chapter is still written in one pass. After that, the app treats the
result as finished: you get a preview card, click Insert once, and the AI never touches the note again.

The model does make mistakes: a wrong answer, a misread question, a missed sub-part, an
invented value, a rule from the wrong chapter. Checking a 30-question note against the sheet
by hand is slow. When you find a mistake, you have three ways to fix it, and each one is bad:

- **Rerun everything.** You get a new random note, and the parts that were right can come out wrong this time.
- **Fix it by hand.** This works, but nothing helps you.
- **Ask the editor AI.** It can see the note, but not the sheet, the course or the skill's rules.

**Keep:** the rules (both `SKILL.md` files, unchanged) and the rendering (toggle headings,
Rule line, green band, revision boxes, callouts, highlights).
**Change:** how a note is made, checked and fixed.

## 2. Diagnosis: why one shot fails

| # | Root cause | Evidence in our code |
|---|------------|----------------------|
| 1 | **We write one unit and check another.** The model writes a whole note, but you check and fix one question or one concept at a time. | `skill_run.produce_skill_result` returns one HTML. The card's Retry reruns everything (`PanelCards.tsx`, `onRetry`). |
| 2 | **The plan is invisible.** The decisions that cost the most are made in the model's head and can't be corrected before ~10k tokens are built on them: which questions exist, how they split, which rule each uses, what matters most. | solve-worksheet `BEFORE WRITING` steps 1–5. The study guide has a chapter plan (`chaptered.py`), but it is never shown. |
| 3 | **Nothing links back to the source.** To check an answer you search the sheet yourself. | solve-worksheet: "NO ANCHORS". Study guide: one page link per `<h3>`, nothing below that. |
| 4 | **The prompts ask for what one pass cannot do.** | Worksheet: "You write from top to bottom and cannot go back". Study guide: "Decide at the END… 1. Write the whole document with NO highlights", but a streamed answer can't go back to add them. "If the check fails, fix the working": the Check line is written by the same pass, after the working, so it says ✓ out of habit. |
| 5 | **Quality drops along the document.** | Worksheet: "LONG WORKSHEETS… shorter working for the later ones". E9: one call over three lectures wrote each at 55–80% of the depth it got alone. Same lecture, run to run: 3–8 tables, 6–15 formulas. |
| 6 | **The summaries are copies, not views.** The answer key, the revision sheet, the Overview and the highlights are written once, from the solutions. Fix one answer and the key is now wrong. | solve-worksheet: "It is distilled from the solutions you wrote". |
| 7 | **The fixing tools don't know the job.** The editor AI sees the note but not the sheet, the course or the skill's rules, and runs on the Fast slot. The chat is not allowed to write into the open note. | `editorAI.ts` `editorDocumentState`, `agent_inline.py` `SLOT = "fast"`, `engine.py` "Denied: that note is open in the editor". |
| 8 | **Worksheet answers are never checked.** The study guide's check counts boxes, tables and page links; it never asks whether a fact is right. | `produce_skill_result` sets `check = None` for every skill except the study guide. |

All eight come from one assumption: that the first draft is right. The design has to assume it
isn't, on every model, because the default model is Nemotron and the app runs on any provider.

## 3. What other products do

| Product | Pattern | What we take |
|---------|---------|--------------|
| Gamma, GitHub Copilot Workspace | Plan first, as something you can edit, then generate from it. Change any stage and regenerate what follows. | **The map step** |
| NotebookLM, Elicit | Every claim or cell points to the passage it came from. Click → the source opens with that passage highlighted. | **Each question linked to its passage in the sheet** |
| GitHub pull-request review | A "Viewed" box per file and a count of how many are done | **✓ checked per unit, "6 of 11 checked"** |
| Cursor, Notion AI | An AI change to one part is shown as a diff you accept or reject. "Try again" takes an instruction. | **Redo one unit, with a note, as a suggestion** |
| Photomath, Wolfram Alpha | The answer is checked by a separate route (a solver), not by the writer saying ✓ | **AI check: solve it again blind, compare** |
| Spreadsheets | Totals are formulas over the cells, never typed again | **Answer key built from the bands; revision sheet refreshed from the Rule lines** |

## 4. The design

### 4.1 One idea: the note is a tree of units

A **unit** is a piece you check and fix:

- worksheet: exercise → question → sub-part
- study guide: chapter → section → concept

Each unit has a heading block in the note, the source passage it comes from, a state, and its plan
(kind, rule names, importance). The rendering is the same as today; the units are
structure you don't see under it, kept by block id the way `note_anchors` already keeps page links.

### 4.2 The flow: Map → Write → Check → Fix

#### 1 · Map (one fast, cheap call)

One call reads the sources and returns the plan as data. For a worksheet, it lists every exercise,
question and sub-part, and gives each one:

- the sheet's own numbering;
- the shortened question (the grey line);
- **the exact words of the question in the sheet** and its page;
- its kind (Recall / Short / Multi-step / Open);
- its rule names and its importance.

This is the skill's existing `BEFORE WRITING` and `HEADING HIGHLIGHTS`, run as its own step, so
we can see its result for the first time.

The plan goes into the note as a **skeleton**: the real toggle headings with their grey question
lines and no answers yet. In the sheet, every question it found is tinted and numbered. **A question
with no tint was missed**, and you see it before anything is spent on writing.

To fix the plan, edit the note: delete a heading to skip it, merge two, or rename one. If a question was missed,
select it in the sheet and click "Add as a question".

```
┌ TD3.pdf ─────────────────────────┐  ┌ TD 3 · Solutions ───────────────────────────────┐
│ Exercise 1  Laser beam           │  │ Found 2 exercises, 5 questions.                  │
│ ▒① a) Find the frequency of…  ▒ │◄─┤ ▸ Exercise 01 · Laser beam                       │
│ ▒① b) Find the intensity…     ▒ │  │   ▸ (a) Frequency            ○  not written      │
│ ▒① c) Find E0 and B0…         ▒ │  │   ▸ (b) Intensity            ○  not written      │
│ Exercise 2                       │  │   ▸ (c) Field amplitudes     ○  not written      │
│ ▒② Which is the SI unit of…   ▒ │  │ ▸ Exercise 02 · Unit of momentum                 │
│   3. Show that p = E/c …         │  │                                                  │
│      ↑ no tint: the map missed it│  │ [ Solve all · ~$0.07 ]                           │
└──────────────────────────────────┘  └──────────────────────────────────────────────────┘
```

#### 2 · Write (in parallel)

The model writes one exercise per call (one chapter per call for the study guide), four calls at a
time, the way the chaptered study guide already works. Each call gets the same `SKILL.md` and
sources, plus a short note from the app: "write only exercise 2; use these rule names exactly as
given; these highlights are already chosen". Each question lands in its skeleton heading as soon as
its exercise is done.

A question you have already edited is never overwritten: the new version is offered as a suggestion instead.

#### 3 · Check

Each unit heading gets a status mark in the margin. It sits beside the heading like today's
source dots, and is not saved in the note's text:

`○` not checked · `✓` checked by you · `⚠` something to look at

Hover a unit to get its actions:

- **`p.1 ↗`** opens the sheet at the question, tinted.
- **`✓`** marks the unit as checked.
- **`Redo ▾`** opens the fix menu (step 4).

A line at the top says "6 of 11 checked · 1 to look at". Click it to go to the next unchecked unit.

**Free checks** (no model) that raise `⚠`:

- a number in the grey question line that does not appear in the sheet (an invented value; the skill's
  HONESTY rule, now enforced);
- a planned question with no green band, or with two;
- the question's quoted words not found in the sheet (the map misread it);
- a Rule name with no revision box, or a box that no solution uses.

**AI check** (paid, per unit or for all): a second call solves the question blind, from
the sheet and the course, then compares its answer with the band. Numbers are compared in code,
everything else by the model. If they disagree, the unit gets `⚠` with both answers shown side by side. The check only
flags; you decide.

#### 4 · Fix

`Redo ▾` on any unit:

```
Redo
Redo with a note…    "use the course's form of Gauss's law"
More steps · Shorter
Check with AI
```

The new version comes from the same backend writer as Solve all: the same rules, and the
unit's source passage, its plan and the rule names used elsewhere in the note. It replaces the unit
in the note, and the unit's mark offers **Keep** or **Back to old** until you choose. The old
version is kept in `note_units`.

*Changed while planning Phase 1:* the first draft of this design sent a Redo through the
editor AI's accept/reject review. Answers can hold Mermaid diagrams, and only the backend's
`skill_html.finish` turns them into live diagram blocks; the editor AI's operations can't create
them. Giving the editor AI the unit's context ("fix this step") moves to Phase 2.

You can always just type, too: the result is a normal note.

### 4.3 The summaries follow the units

- **Answer key:** a live block, like a database view, that reads the note's green bands. Fix a band
  and the key changes with it. It is exported as a plain table.
- **Revision sheet, Rules & formulas:** written from the Rule lines by its own call at the end.
  When a Rule line changes, its heading shows "2 rules changed · Refresh", and Refresh rewrites only
  those boxes.
- **Overview** (top of the worksheet, each study-guide chapter): the Map / "How it breaks down" line
  is rebuilt from the unit titles; Refresh rewrites the other lines.
- **Highlights:** chosen in the map, where the model sees every question at once. That is the only
  place the red/orange/yellow limits can really be kept. You change a highlight with the normal
  highlight menu.

### 4.4 The rules stay where they are

Both `SKILL.md` files stay as they are, and you can still edit them in Settings → Skills. Every call
sends the whole skill text, then a short note from the app saying what this call does. This is how
`chaptered.py` already writes a chapter (`CHAPTER_NOTE`). The skill text and the sources are the same
in every call and come first, so the prompt cache charges for them once.

| Stage | Main parts of SKILL.md it relies on | The app's note says |
|-------|-------------------------------------|---------------------|
| Map | BEFORE WRITING, DEPTH, HEADING HIGHLIGHTS, how rules are named | "Plan only; answer in JSON" |
| Write | THE PAGE, ONE QUESTION, WORKING, ANSWER BAND, CALLOUTS, MATHS, HONESTY, STYLE | "Write only exercise N; these rule names; these highlights" |
| Redo | the same | "Rewrite only this unit; the student's note; the current version" |
| Revision | RULES & FORMULAS | "Write only these boxes" |

The study guide works the same way: its chapter plan (`reference/chapter-plan.md`) becomes the
visible map, and each chapter call stays the ordinary study-guide prompt.

### 4.5 What it reuses

| Already built | Becomes |
|---------------|---------|
| `chaptered.py`: plan → write chapters in parallel → join | the engine for both skills |
| `synthesis_messages` cache split | every unit call shares the cached skill text and sources |
| `note_anchors` + `readDraftAnchors` (an `<h3>` linked to a page, by block id) | the link from each unit to its passage, at any depth |
| the source-coloured margin dots in `NotePane.tsx` | the status marks |
| `passageMarks.ts` (tints quoted passages in a PDF's text layer) | tints each mapped question in the sheet |
| xl-ai accept/reject review through `/agent/inline` | how a Redo arrives |
| source viewer selection actions (`sendBlocks.ts`) | "Add as a question" |
| `style_learning.py` | later: your Redo notes and edits suggest "Your style" lines |

### 4.6 Data

One new table, `note_units`, added by a migration you run in Supabase. Its columns:

- `note_id`
- `block_id`: the unit's heading
- `parent`
- `kind`
- `label`, e.g. "01 (b)"
- the source passage: resource, page and quote
- the plan: kind, rule names and importance
- `state`: planned / written / checked / flagged / edited
- the last AI check
- earlier AI versions, so a Redo can still be undone after the editor's own undo history is gone

## 5. Cost and speed

Today, one run on a synthetic 9-question sheet with Haiku 4.5 costs about $0.035 (STATUS.md).
With this design:

- **A full run** is about 6 calls (map + one per exercise + revision). The skill text and the sources are the
  same in each call, so:
  - with a prompt cache (Claude), expect about **2×** today's price;
  - without one, about **4–5×**.

  The price is shown before the run, as now.
- **Speed:** the map should show in seconds, and the exercises run in parallel, so the first answers appear
  sooner than the single answer does today. Not measured yet.
- **A Redo** is one unit, a few percent of a run, instead of a full rerun that may break what was right.

## 6. Build order

**Phase 1: the worksheet loop.** Worksheet first: wrong answers do the most harm there, and its
units are the clearest.

1. Map call → skeleton in the note; each question linked to its passage and tinted in the sheet.
2. Solve all: one call per exercise in parallel, landing in the skeleton; edited units kept.
3. Status marks, the "N of M checked" line, and the free checks.
4. Redo / Redo with a note, from the backend writer, with Keep / Back to old.
5. Answer key built from the bands, with no model (a self-updating block comes later).

**Phase 2: verification and the rest.** AI check (blind solve + compare), revision sheet Refresh
per rule, "Add as a question" from the sheet, and letting the chat propose a fix to a unit as a
suggestion instead of being refused.

**Phase 3: the study guide on the same engine.** The chapter plan shown as a skeleton; each section
and concept linked to its pages; in the source viewer, a mark on every page whose tables or formulas
don't appear in the note; Redo per chapter, section or concept.

Each phase gets its own plan file before any code is written.

## 7. Decisions (all approved 2026-11-24, as recommended)

1. **The skeleton goes into the note right after the map.** This replaces the 2026-09-24
   decision that nothing enters a note until you click Insert: you still choose where it goes
   (this note, or replace), but at the start. Recommended, because the note next to the sheet is
   where checking happens.
2. **Pause after the map** with one "Solve all" click, or go straight on. Recommended: pause.
   Checking the list takes seconds and catches the costliest mistakes (a missed or merged question
   spoils the answer key).
3. **Size of the first write:** one call per exercise (recommended: cheaper, and the questions of one
   exercise stay consistent) or one per question.
4. **Cost:** about 2× a one-shot run on Claude for the first write, much less for every fix after it.
5. **Order:** worksheet first, study guide after.

## 8. Not in this design

- A tutor mode, where you try a question first and the AI checks your attempt. It is a good idea, but a different feature.
- Fixing automatically after an AI check. The check only flags; a person decides.
- Changing the wording of either `SKILL.md`.
- Re-checking numbers with Python (Pyodide is already in the app). Worth a later look for numeric
  answers, after the AI check shows how often numbers are wrong.
