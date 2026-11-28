# Phase 2: checking and steering a solved worksheet

Design: `docs/INTERACTIVE_NOTES_DESIGN.md` §4.2 (Check, Fix) and §6 Phase 2. Phase 1 (the
worksheet loop) is in `2026-11-24-units-phase1.md`. Tick items as they land.

Order: what catches a wrong answer first, then what saves the student typing.

## 1. AI check (per part)

A part's menu gets **Check with AI**. On an exercise it checks every answer under it in one go.

1. The note sends the part's answers **as they are in the note now** (the student may have
   edited them): each answer's heading block HTML, by key.
2. Answers code can check exactly are not sent to the model: a Boolean function the question
   gives (logic_check, every input). Their verdict is "checked on every input" or the wrong
   minterms.
3. **Blind solve**, one call: the skill + sources prefix (cached), and a note listing the
   questions (key, label, the question and the data above it) with **no** answer. The model
   returns JSON `{answers: [{key, answer}]}`: the final answer only.
4. **Compare**:
   - numbers in code: every value of the blind answer (scientific notation, `\times 10^{n}`,
     `×10¹⁴`, `e14`) must be within 2 % of a value in the note's band → agree; none matches →
     differ; anything else → the judge;
   - the rest (expressions, words, a mix) goes to one short **judge** call with the pairs only
     (no sources): same final result or not, and why in one line.
5. Each answer gets agree / differ / unsure. A difference becomes a problem on the part,
   `AI check: a second solve got “…”; the note says “…” — why`, so the mark turns `!`; an
   agreement clears an earlier AI-check problem. The menu shows every verdict side by side.
   It only flags; the student decides (Redo, edit, or Mark checked).

No migration: verdicts that disagree live in `problems`; agreements are shown in the menu.

- [x] backend `units.ai_check` + `POST /notes/{id}/units/{key}/check`
- [x] frontend: menu button, verdict list, mark refresh; **Check all with AI** on the progress line (one call: key `_root`)
- [x] tests: number parsing, compare, the blind and judge calls with a fake model, storage
- [ ] live run on ESD 2 Tutorial 3 (AI Grid / Qwen)

## 2. Later in this phase


- **Refresh a rule box** on the revision sheet from the solutions that use it.
- **Add as a question**: select a passage in the sheet → a new part in the plan and the note.
- **Chat → a part**: the chat may propose a fix to a part as a suggestion (Keep / Back),
  instead of refusing.
