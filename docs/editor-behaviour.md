# Editor behaviour

How keys behave in a note, where this app adds to BlockNote's defaults. Each row names the
test that pins it: **change the behaviour, this file and the test together** (WordCraft's
`typing-parity.md` rule, ArtCraft study M4). BlockNote's own keys (Enter splits a block,
Tab nests, `/` opens the menu…) are not repeated here.

| Where | Key | What happens | Pinned by |
|---|---|---|---|
| Note, text selected | Ctrl/⌘ K | Inline AI opens at that block | — (BlockEditor.tsx `AIKeyboardHandler`) |
| Note, nothing selected | Ctrl/⌘ K | Falls through: the app's AI panel opens | — |
| Math block, editing | Ctrl/⌘ Enter | Saves the formula | — |
| Math block, editing | Esc | Closes without saving | — |
| Inline math, editing | Enter or leaving the box | Saves; an emptied or unchanged box keeps the old formula (an empty one could never be clicked again) | `customBlocks.test.tsx` "inline math edit" |
| Inline math, editing | Esc | Closes without saving | — |
| Present mode | → ↓ Space PageDown Enter N / ← ↑ PageUp Backspace P; Home / End | Next / previous slide, stops at the ends; first / last | `present.test.ts` "moves with arrows…" |
| Present mode | digits then Enter | Jumps to that slide (out of range clamps) | `present.test.ts` "number + Enter jumps" |
| Present mode | G / B or . | Grid of slides / black screen | `present.test.ts` "G grid, B black…" |
| Present mode | Esc | Backs out one layer (typed number, grid, black screen), then leaves | same |
| Present mode | Ctrl/⌘/Alt + anything | Ignored, so browser shortcuts still work | — |

"—" means not pinned yet: when you next change that row, add its test.
