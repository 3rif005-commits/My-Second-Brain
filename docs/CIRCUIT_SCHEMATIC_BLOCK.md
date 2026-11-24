# A real circuit block (schematics the AI writes, the app draws)

2026-11-24 · status: **documented, not planned yet** · asked for by the user as an app-wide
feature, not a worksheet fix.

## The problem

Electronics and digital-logic notes are full of circuits, and the app can't show one.

- Live finding on ESD 2 Tutorial 3 (PLA/PAL design): the worksheet solver answered "design a PLA
  circuit" in words. The skill was told to describe circuits, because nothing could draw them.
- The stopgap (2026-11-24) draws logic circuits as Mermaid flowcharts: gates as boxes, wires as
  arrows. It is readable and checkable, but it isn't a schematic. There are no gate symbols, no
  bubbles for inversion, no PLA crosspoint grid, nothing analogue (resistors, op-amps, transistors).
  A student revises from the drawing their teacher uses, so a box labelled "AND: AB" is a
  translation they have to undo in their head.
- Asking a model to draw an SVG by hand fails: wires cross gates, pins don't line up, and every
  run is different. Mermaid taught the same lesson: **the model writes the structure; a library
  does the layout.**

## Why it's worth a block of its own (not just for worksheets)

| Where | What a circuit block gives |
|---|---|
| Worksheet solver | "Design a PAL" answered with the PAL itself; the drawing is part of the answer. |
| Study guide | Lecture slides that show a circuit keep it, as the guide keeps tables and equations. |
| Source viewer | "Capture figure" on a slide's circuit → a block you can edit, not a picture. |
| The editor (/circuit) | The student builds or corrects a circuit by hand, the way they write a table. |
| Checking | A circuit stored as a netlist can be **evaluated**: its truth table vs the question's minterms (`services/workspace/logic_check.py` already does this for expressions), so a wrong wire is caught for free. |
| Revision | A digital circuit can be **simulated**: click inputs, watch the output. That's a real advantage over paper and over Notion. |

## Shape of a solution

- **Stored form = a netlist, not a picture.** For example JSON: inputs, gates (type, inputs),
  outputs; for analogue, components and nodes. The AI writes it, a person can edit it, code can
  evaluate it.
- **Drawn by a layout library** inside the existing interactive block (it already loads libraries
  from jsDelivr / cdnjs / unpkg / esm.sh). Candidates to evaluate. Names are from memory; check
  each one's licence, size and output before choosing:
  - *netlistsvg*: schematics from a Yosys-style JSON netlist, with automatic layout.
  - *DigitalJS*: digital circuits in the browser, simulated, from a similar netlist.
  - *WaveDrom*: timing diagrams, plus a mode that draws gate circuits from expressions.
  - *circuitikz* (LaTeX) / *Schemdraw* (Python): good analogue symbols, but they'd need
    rendering on the server.
- **One format the AI writes everywhere** (skills, chat, source capture), with a validator that
  refuses a netlist with dangling wires before it reaches the note.
- **Export:** an image for Notion and Markdown, like Mermaid blocks today.

## Open questions

1. Digital only first (gates, PLA/PAL, flip-flops, multiplexers), or analogue too? Analogue
   needs a different library and has no free "is it right" check.
2. Do PLA/PAL crosspoint grids belong in the same block, or are they a table with ×? Today's
   programming table may be enough.
3. Who draws the first version: the AI from text, or the student from a palette? Probably both,
   in the same netlist.

## Until then

Worksheets use Mermaid gate diagrams plus PLA/PAL programming tables
(`backend/skills/solve-worksheet/SKILL.md`), and the free checks flag a "design … circuit" part
that has neither.
