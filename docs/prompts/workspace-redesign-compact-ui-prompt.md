# PROMPT: Redesign Workspaces — replace the canvas with a compact, single-note UI

Copy everything below this line into a fresh Claude Code session in this repo.
Before pasting: make sure the session model is **Sonnet 5 or Opus 5, not Fable** —
this is real design and engineering work, not a persona/style task.

---

I want you to redesign and rebuild a significant part of an existing, CODE COMPLETE,
already-tested feature in my Second Brain app: **Workspaces**. This is not greenfield —
read before you touch anything.

## Read first (in this order)

1. `STATUS.md` — the "Workspaces — CODE COMPLETE" section.
2. Auto-memory file `project_workspaces_feature.md` (loaded automatically for this
   project) — what shipped, what's verified live, and every gotcha hit building it.
   Also read `project_backend_test_quirks.md` for environment quirks (two venvs, no
   direct DB access, etc.).
3. `docs/plans/2026-07-12-workspaces.md` and `docs/research/workspace-research.md` —
   the original design and the technology choices behind the extraction/capture/chat
   pipeline. Most of that pipeline is being **kept** (see below) — this is context for
   why it's built the way it is.
4. `docs/workspace-manual-test-checklist.md` — what's been live-verified, including a
   2026-07-29 dated entry about ffmpeg-dependent capture flows and a real bug that was
   found and fixed in the background processor.
5. The actual code: `backend/routers/workspaces.py`, `backend/services/workspace/`,
   `backend/services/ai/`, `frontend/components/workspace/`, `frontend/app/(brain)/brain/workspaces/`.

## Why this is happening

The current Workspaces feature works and is tested end-to-end, but the UX is wrong for
how I actually work. I do NOT want:

- An infinite freeform canvas where resource cards and note cards are placed, dragged,
  resized, and manually arranged.
- A separate "create a new workspace" step (naming it, etc.) before I can start working.
- One output note **per resource** — today, importing 3 resources creates 3 separate
  summary notes.

I do want something **operational, minimalist, and reliable** — a compact UI: open it,
upload resource(s), and have all the tools to work on those sources right there in a
tight layout, with the note being produced directly from that — no canvas, no card
management, no naming ceremony first.

## What "workspace" means now

A "workspace" is **not a persistent, listable entity you create and name** anymore.
It is just **the compact UI surface** — the combination of a source-management panel
(add/view/remove resources) and the tools that act on those sources (extraction,
frame/clip/audio capture, checkpoints, grounded chat) — that appears when you're working
on a note that has resources attached to it. Figure out the right data-model shape for
this during design (e.g. resources attaching directly to a note rather than to a
separate `workspaces` container) — don't assume the current `workspaces` /
`workspace_pages` / `workspace_resources` schema survives unchanged.

## Hard requirements

1. **Fully replace** the canvas-based UI. Do not keep it as an alternate/optional mode.
2. **One output note per working session**, not one per resource. If multiple resources
   are attached, they all feed into a single note; the AI synthesizes across all of them
   (not just concatenates per-resource summaries).
3. That note needs **high flexibility for manipulating its content** — it's a normal,
   fully-editable note (same block editor as everywhere else in the app), not a frozen
   AI output. The user must be able to freely restructure, rewrite, and extend it.
4. **Keep the underlying engine** — do not rebuild these from scratch, they are proven
   and live-tested as of 2026-07-29:
   - PDF/website/YouTube/video extraction (`backend/services/workspace/*.py`)
   - ffmpeg/yt-dlp frame/clip/audio capture (`backend/services/workspace/media.py`,
     `video.py`) — including the retry fix in `processor.py`'s status/meta writes
   - The provider-agnostic AI layer (`backend/services/ai/`) and its capability-based
     fallback routing
   - Element-level PDF extraction (text/heading/image/table/formula with bboxes)
   - Grounded chat with anchored citations
   - Checkpoint deep-links and formula→LaTeX
   Redesign the **shell** (data model for how resources attach to a note, the frontend
   UI) around this engine, not the engine itself, unless something in it is now the
   wrong shape for "one note, many resources" (e.g. today's per-resource summary
   generation, or `note_anchors` keyed off individual resources — check carefully).
5. Resources upload/attach directly in the compact UI — no intermediate "create
   workspace" screen or dialog.

## Process — do not skip steps

This repo uses the **superpowers** skill system. Follow it exactly:

1. Use the **`superpowers:brainstorming`** skill to design this. Explore the existing
   code (per "Read first" above) before asking me anything. Ask clarifying questions one
   at a time — there will be real open questions (e.g., what happens to existing
   workspace data created under the old model; whether there's still a way to browse
   "notes with resources attached" from the sidebar; how multi-resource synthesis should
   change the summary prompt). Propose approaches, present the design in reviewable
   sections, and get my explicit approval before writing anything.
2. Write the design to `docs/superpowers/specs/` per that skill's convention, self-review
   it, and have me review the written file before moving on.
3. Then use the **`superpowers:writing-plans`** skill to turn the approved design into an
   implementation plan.
4. Only then implement — following whatever plan-execution process that skill sets up.

## UI/UX testing requirement

Once there's something to look at, use the **claude-in-chrome** tools to actually drive
the new UI in a real browser and assess it visually — don't just eyeball the JSX. Iterate
on layout/spacing/hierarchy based on real screenshots, the same way a designer would.

**Cost control for this**: the repeated screenshot-inspection loop during UI iteration is
image-heavy and expensive on a strong model. Delegate that specific review step to a
subagent via the `Agent` tool with `model: "haiku"` — describe what to look for (layout
issues, spacing, hierarchy, does it look "operational and minimalist" per the brief
above) and let Haiku do the visual read; keep the main session (Sonnet/Opus) for design
decisions, code changes, and synthesizing Haiku's feedback into action. Do not burn the
main model's budget on repeated raw screenshot review.

## What I'm not telling you

I'm deliberately not prescribing the exact new data model, the exact layout, or the
exact list of UI components — that's what the brainstorming/design phase is for. Bring
me options with trade-offs where there's a real decision, and your recommendation.
