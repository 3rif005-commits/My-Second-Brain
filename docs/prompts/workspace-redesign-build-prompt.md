# Build prompt — Workspaces compact redesign

Paste everything below the line into a fresh session (main model Sonnet 5 or
Opus 5, **not** Fable). The design phase is already done and approved; this
prompt is the implementation handoff.

---

Implement the approved Workspaces redesign in this repo. The design is already
brainstormed, written, and approved — **do not re-brainstorm it**.

## Read first, in this order

1. `docs/superpowers/specs/2026-07-30-workspaces-compact-redesign-design.md` —
   **the approved spec. It is the source of truth.** Follow it; don't redesign it.
2. `docs/prompts/workspace-redesign-compact-ui-prompt.md` — the original brief
   behind the spec (the "why", and the hard requirements it has to satisfy).
3. Auto-memories `project_workspaces_redesign`, `project_workspaces_feature`, and
   `project_backend_test_quirks` — the environment quirks and every gotcha hit
   building the thing you're now reshaping. Gotchas 1, 2, 4, 8 (BlockNote
   `createReactBlockSpec` factory, react-pdf SSR, no native dialogs, react-pdf
   text-layer z-index) apply directly to the code you'll be writing.
4. The code the spec touches: `backend/routers/workspaces.py`,
   `backend/services/workspace/`, `backend/services/ai/`,
   `frontend/components/workspace/`, `frontend/app/(brain)/brain/workspaces/`,
   `supabase/migrations/012_workspaces.sql`.

## Process

1. Use the **`superpowers:writing-plans`** skill to turn the spec into an
   implementation plan. Follow the spec's §10 build order unless you find a real
   ordering problem — if you do, say so rather than silently reordering.
2. Then execute the plan via whatever execution process that skill sets up
   (`superpowers:executing-plans` / `subagent-driven-development`), using TDD per
   `superpowers:test-driven-development` for the backend work — the spec's §9
   lists the exact test cases, including the new `test_synthesis_trigger.py`
   settle-guard cases.
3. Use `superpowers:verification-before-completion` before claiming anything
   works. Evidence, not assertions.

## Hard constraints

- **Fully replace the canvas.** No alternate mode, no flag, no "keep it just in
  case". Delete `WorkspaceCanvas.tsx`, `ResourceCard.tsx`, `NotePageCard.tsx`,
  both `brain/workspaces/` routes, and the `@xyflow/react` dependency.
- **One note per session, never one per resource.** `summary_html` leaves
  `note_resources` entirely; synthesis lives on `note_synthesis`, keyed by note.
- **Do not rebuild the engine.** PDF/website/YouTube/video extraction,
  ffmpeg/yt-dlp frame/clip/audio capture (including the `_with_retry` fix in
  `processor.py`), `services/ai/` provider routing and fallback, element-level
  PDF extraction, formula→LaTeX, grounded chat with anchored citations, and every
  `viewers/*` component are proven and live-tested as of 2026-07-29. Reshape the
  shell around them. `SplitView.tsx` is dissolved into `NotePane.tsx` by moving
  its editor host / `ingestHtml` handoff / anchor logic / send-to-note bus — not
  by rewriting them from scratch.
- **No native `window.confirm/prompt/alert`** anywhere — they freeze the tab for
  browser automation. Use the existing `ConfirmDialog` / `PromptDialog` /
  `useToast()`.

## Blocking gate: the migration

`013_note_sources.sql` **drops tables** and this machine has no DB access
(`DATABASE_URL` in `backend/.env` is a placeholder). Write the migration, then
**stop and ask me to run it** in the Supabase SQL editor (project
`esfhsdukyhyrlgzflsad`) before anything that needs the new schema live. Do not
assume it has been applied. Everything that doesn't depend on the live schema
(prompt, synthesis service, tests, frontend) can proceed while you wait.

If Supabase shows "Project is paused", that's the free-tier auto-pause — one
non-destructive click to resume, not a bug in your code.

## Verification

Backend (note both quirks — two venvs, and ROS system pytest plugins break
collection):

```bash
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio
```

Frontend:

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Live servers (this environment's background processes do not survive a session
boundary — expect to restart all three):

```bash
./llama.sh start
cd backend && .venv/bin/uvicorn main:app --reload --port 8000
cd frontend && npm run dev
```

`next dev` cold-compiling this route takes 30–60s on this machine. Not a hang.

## UI/UX review — delegate the screenshots

Once the shell renders, drive it in a real browser with the **claude-in-chrome**
tools. But **delegate the repeated screenshot-inspection loop to a subagent via
the `Agent` tool with `model: "haiku"`** — screenshot review is image-heavy and
expensive on a strong model. Tell the subagent what to look for: layout, spacing,
visual hierarchy, whether it reads as "operational and minimalist" per the brief,
and whether the source rail / viewer / note / chat-drawer proportions work with
1, 3, and 5 sources attached. Keep the main session for design decisions, code
changes, and synthesizing Haiku's feedback into action. Iterate on real
screenshots like a designer would — don't just eyeball the JSX.

## When it's done

- Rewrite `docs/workspace-manual-test-checklist.md` for the new flow (drop 3
  sources → one synthesized note → per-source viewers → capture → checkpoints →
  chat citations across sources → re-synthesize replace/append). I'll run it.
- Update `STATUS.md` (replace the "Workspaces — CODE COMPLETE" section),
  `ANDROID_PARITY.md` #20, and the `project_workspaces_redesign` /
  `project_workspaces_feature` memories to reflect what actually shipped.
- Give me the CLI test commands to run, per my standing preference for a test
  batch after each milestone.
