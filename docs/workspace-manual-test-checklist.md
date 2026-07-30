# Workspace — Manual Test Checklist

> Compact single-note redesign (2026-07-30). Replaces the canvas-based Workspaces
> checklist. Design spec: `docs/superpowers/specs/2026-07-30-workspaces-compact-redesign-design.md`.
>
> **Status: migration 013 applied 2026-07-30; a first live pass ran the same day.**
> Backend: `169 passed, 0 failures, 0 errors`. Frontend: `npx tsc --noEmit` clean,
> `npm run build` clean with `/brain/workspace` and `/brain/workspace/[noteId]` in
> the route table.
>
> Driven end to end in Chrome on 2026-07-30 with a YouTube source and a Wikipedia
> article: lazy note creation, background processing, the settle-guard synthesis,
> auto-apply, the title upgrade, source-indexed section chips in two colours,
> grounded chat with cross-source citations, citation-click source switching,
> checkpoint insert + deep link, source removal taking its chips with it, and
> re-synthesis actually rewriting the note. Four defects were found and fixed in
> that pass (see "Known quirks" at the end).
>
> **Not yet exercised live:** file upload (PDF / markdown / video), frame / clip /
> audio capture, the multi-file deferred batch drop, and the append branch of
> re-synthesis. Those sections below are written but unverified — treat a failure
> there as new information, not as a known-good regression.

## 0. One-time setup (required before anything works)

1. **Apply migration 013 — this is your manual step, not yet applied.**
   No direct DB access exists from this machine, so run it in the Supabase
   dashboard: SQL Editor → paste the full contents of
   `supabase/migrations/013_note_sources.sql` → Run. It is destructive: it
   `DROP`s `workspaces`, `workspace_pages`, `workspace_resources`,
   `resource_elements`, `resource_chunks`, `note_anchors` and the
   `match_workspace_chunks` function, then recreates the schema around
   `note_resources` + `note_synthesis`. Do **not** run `012_workspaces.sql` —
   that was the canvas-era migration and is superseded by 013.
   **Before you get there:** a free-tier Supabase project auto-pauses after
   inactivity, so landing on a "Project is paused" screen when you open the
   dashboard is expected, not a fault — resuming is one non-destructive click
   (data and backups are kept), then the SQL editor is reachable as normal.
2. **Install ffmpeg** (frame / clip / audio extraction — everything else works
   without it):
   ```bash
   sudo apt install ffmpeg
   ```
3. *(Optional)* **faster-whisper** for local transcription of uploaded video
   files (~1 GB models; without it, uploaded videos degrade to no-transcript):
   ```bash
   cd backend && source .venv/bin/activate && pip install faster-whisper
   ```
4. `yt-dlp` should already be installed into `backend/.venv` (needed for
   YouTube frame/clip/audio capture).

## 1. Start the app

```bash
# Terminal 1 — embedder (needed for grounded chat indexing)
./llama.sh start

# Terminal 2 — backend
cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000

# Terminal 3 — frontend
cd frontend && npm run dev
```

Open http://localhost:3000 → log in → sidebar → **Workspace**.

**Environment note:** the first request to `/brain/workspace` cold-compiles
that route and can take **30–60 seconds** in dev mode. That is not a hang —
wait it out before assuming something is broken.

## 2. Empty shell

- [ ] `/brain/workspace` renders a drop zone: "Drop your sources here", a
      **Choose files** button and a **Paste a link** button. No workspace list,
      no "create workspace" dialog — this route *is* the empty state.
- [ ] If you have earlier sessions, a **"Pick up where you left off"** strip
      appears below the drop zone, one pill per note with its title and source
      count (e.g. "3 sources"). Click one → it opens
      `/brain/workspace/<that noteId>` with its sources and note restored.
- [ ] On a fresh account (no sessions yet) the strip is simply absent — that is
      correct, not a bug.

## 3. First drop → one note

- [ ] Drop a single PDF onto the drop zone (or click **Choose files**).
- [ ] The URL rewrites to `/brain/workspace/<id>` and the shell appears: a
      header bar, a left column (source rail over a viewer), a right column
      (the note).
- [ ] In the **Sources** rail, the PDF's row shows a status dot that starts
      amber-pulsing (`queued`/`processing`) and settles to a solid colored dot
      once `ready`. The row's title is the filename until the source finishes
      processing.
- [ ] Once `ready`, the note pane starts writing itself — the header's
      right-hand status text reads "Writing the note…" while it runs, and the
      draft lands in the note without you doing anything. (This is the D1
      settle-guard: one source with nothing else pending triggers synthesis
      immediately.)
- [ ] The note title updates to whatever the synthesis draft suggested for a
      single-source session (typically close to the source's own title).

## 4. Three sources at once → exactly ONE synthesis

This is the headline behavior to verify — it is the reason the feature was
rebuilt.

- [ ] Start a **new** session (back arrow in the header, or `/brain/workspace`
      directly).
- [ ] Select **three sources at once** in one drop — e.g. drag a PDF, then
      before it finishes drop a YouTube link and an article URL through
      **Paste a link**, or better: select a PDF file and paste both URLs within
      a few seconds of each other so several are in flight together.
- [ ] Watch the rail: each source progresses `queued → processing → ready`
      independently, at its own pace (PDFs are fast; a YouTube link with a
      transcript is fast; a website with no transcript falls back to a slower
      Gemini-native path if configured).
- [ ] **Confirm exactly one synthesis pass happens for the whole session** —
      the header shows "Writing the note…" once, not once per source, and the
      note ends up with **one continuous draft**, not three separate blurbs
      stacked end to end.
- [ ] Read the resulting note: it should be **organized by concept**, not by
      source. Concretely: it must **not** contain one `<h2>` per source (i.e.
      you should not see three headings that are obviously just each source's
      name/title in sequence with no synthesis between them). Shared material
      should be stated once; where sources disagree or complement each other,
      the draft should say so.
- [ ] The note's title should read as a **topic title** for the whole session,
      not the filename of whichever source happened to finish processing
      first.
- [ ] **Regression check — YouTube-first title upgrade.** Order matters for
      this one: this time, attach the **YouTube link first**, before the PDF
      and the article, so the note is created from the YouTube source and
      starts out titled **"YouTube video"**. When the draft lands, the note's
      title must change to a topic title drawn from the draft's `<h1>` —
      something like "How backpropagation works" — and must **not** stay
      "YouTube video", and must **not** become the video's own channel/video
      title either. Why this is here: the background processor renames the
      *source* once it learns the real video title, but the *note* keeps its
      placeholder — so the title-upgrade code has to recognize every title the
      note could have inherited, not just the source's current one. A note
      still reading "YouTube video" after the draft lands means this check
      regressed. One boundary to also check: if you rename the note yourself
      (click the title, type something, blur) *before* the draft lands, your
      title must win — the suggestion is only ever applied to an untouched,
      auto-assigned title.

If you see one heading per source with no cross-referencing, or more than one
"Writing the note…" cycle for a single batch of sources dropped together, that
is a real regression — file it.

## 5. Per-source viewers

- [ ] Click each source row in the rail — the right-hand pane stays the note,
      the **left-hand viewer** (below the rail) swaps to match:
  - **PDF/document**: page-by-page view with colored element outlines when you
    hover (text = indigo/none-clickable, image = green, table = blue,
    formula = purple). A persistent **📍 p.N** button sits bottom-right.
  - **YouTube**: the embedded player with **🖼 Frame / 🎬 Clip / 🎧 Audio /
    📍 Checkpoint** controls below it.
  - **Video (uploaded)**: a plain `<video>` element with the same four
    controls below it.
  - **Website**: a readable, scrollable extraction of the page's sections,
    with a link back to the original URL at the top.
- [ ] Switching sources in the rail swaps the viewer without losing your place
      in the note.

## 6. Capture (frame / clip / audio)

Requires ffmpeg; YouTube capture also requires yt-dlp.

- [ ] On an **uploaded video** source: click **🖼 Frame** → an image block
      lands in the note captioned `Frame @ mm:ss`. Frame capture is
      client-side and should be near-instant.
- [ ] Click **🎬 Clip** once → the button becomes **⏹ End clip (from mm:ss)**
      and turns red. Click it again at a later point → a video block lands in
      the note. Click **🎧 Audio** the same way (press once to mark the start,
      again to mark the end) → an audio block lands.
- [ ] **The clip and audio buttons deliberately share one start marker** — if
      you press Clip to mark a start point, then press Audio, you are ending
      an *audio* capture from the point you marked with Clip (there is a
      **cancel** button that appears once a start is marked, if you want to
      abandon it instead). This is intentional, not a bug: don't file it.
- [ ] Repeat frame/clip/audio on a **YouTube** source. These go through
      `yt-dlp --download-sections` server-side and **can legitimately take
      30–128 seconds** — the button reads "Capturing…"/"Extracting…" while it
      runs. Don't assume a hang under ~2 minutes.
- [ ] **Known environment quirk, not an app bug:** in an automated/sandboxed
      browser session, Chrome's `<video>` element can occasionally wedge at
      `readyState=0` even though the exact same signed URL serves correct
      bytes over `curl`/`fetch`. A plain page reload clears it. If you hit
      this, reload and retry rather than treating it as a regression.

## 7. Sync (sections ↔ source position)

- [ ] Once the note has at least one synthesized section, a **Sections** chip
      row appears above the note — one pill per anchor, each with a small
      colored dot (matching that source's rail color) and a label (`12:30`,
      `p. 4`, `§7`).
- [ ] Click a chip whose source isn't currently active → the viewer switches
      to that source first, then seeks/scrolls to the right spot, and the note
      scrolls to that chip's block.
- [ ] With the sync toggle (the small link icon + "on"/"off" at the right of
      the chip row) **on**, scrolling/playing the **active** source highlights
      and scrolls to the matching note block as you cross anchors. Toggle it
      **off** → this stops.
- [ ] Sync only follows anchors belonging to whichever source is currently
      active in the viewer — anchors for other sources don't fire until you
      switch to them. That's by design.

## 8. Checkpoints + deep links

- [ ] In a video or YouTube source, click **📍 Checkpoint mm:ss** → an amber
      pill block lands in the note. In a PDF, select some text → a floating
      bar offers **📍 Checkpoint** for the current page; the persistent
      **📍 p.N** button does the same without a selection. In a website,
      click a section → the action bar's **📍** button inserts one for that
      section.
- [ ] Copy the note's URL with `?source=<id>&t=|p=|s=<value>` (or just note
      that a checkpoint pill's link carries this), open it in a **new tab** →
      the shell loads, selects that source, and seeks/scrolls to the right
      spot once the viewer is ready.
- [ ] Open a note from **before this redesign** that has an old-style
      checkpoint block (from the canvas era) — it has no `noteId` to link to,
      so it renders as a **dead grey pill** (no link, tooltip explains the
      source is gone) instead of a broken link. That's the intended fallback,
      not a bug.

## 9. Chat citations across sources

- [ ] Click the chat icon (message-square icon) in the header → a **drawer**
      slides in from the right, over the note pane (it is never a third
      column).
- [ ] Ask a question that can only be answered by **combining two different
      sources** in the session. The streamed answer should cite both, with
      `[n]` chips.
- [ ] Each citation chip carries a small colored dot matching its source's
      rail color (a chip with no resolvable source shows no dot rather than
      borrowing another source's color — that's intentional, not a missing
      style).
- [ ] Click a citation chip → the viewer switches to (or stays on) that
      source and seeks to the cited spot.
- [ ] Ask something none of your sources cover → the assistant should say the
      sources don't cover it, not fabricate an answer.

## 10. Re-synthesize

- [ ] Remove a source (✕ on hover over its row, confirm in the dialog) →
      **that source's section chips disappear** from the note immediately.
      The note's own blocks/text are untouched — removing a source never
      deletes what's in the note.
- [ ] Once the set of ready sources no longer matches what the current draft
      was built from, the header button changes from **"Re-synthesize"** to
      **"Re-synthesize (N sources)"** (highlighted). This is the honest
      indicator that a fresher draft is available.
- [ ] **Regression check** — attach a fourth source to a session that already
      has a first draft. Wait for it to reach `ready`. Click
      **"Re-synthesize (4 sources)"**. Confirm the note **actually changes**
      — new content from the fourth source should appear. (A bug where this
      silently did nothing — the client kept polling but never applied the
      new draft — was found and fixed; this step is here specifically to
      catch a regression of it.)
- [ ] With **no edits of your own** in the note (i.e. it's exactly what the
      last synthesis wrote), clicking re-synthesize should **not** prompt you
      — it silently replaces. **If the replace/append dialog pops up on an
      untouched, freshly synthesized note, that is a real bug** — the
      dirty-flag logic assumes the editor fires its change event synchronously
      when a draft is applied, and this is the symptom if that assumption
      ever breaks.
- [ ] Now type something of your own into the note, then re-synthesize. A
      dialog titled **"This note has your own edits in it"** should appear,
      with buttons **"Keep my note, add at the end"** and **"Replace
      everything"** (styled as the dangerous option). Click **"Replace
      everything"** → the note's blocks are fully overwritten by the new
      draft. Re-synthesize again with edits present, and this time dismiss the
      dialog by clicking the backdrop (or press outside the box) → it should
      behave like **"Keep my note, add at the end"** (the dialog's backdrop
      click intentionally maps to the non-destructive choice, not the
      destructive one).

## 11. Failure paths

- [ ] Paste a URL that will fail (a bad/unreachable link, or a YouTube link
      you know has no captions and no video-capable provider configured) into
      a session that also has at least one good source. The bad source shows
      **failed** (red dot) in the rail with its error in a tooltip, and a
      retry arrow. **The other, good source(s) must still synthesize** — one
      bad source must never block the rest.
- [ ] A source sitting at **`queued`** (e.g. because a multi-source drop's
      batch-start call failed, or you're just watching it briefly before it
      flips to `processing`) shows the same retry-arrow icon in the rail, with
      a tooltip "Queued — click to start processing". Clicking it kicks off
      processing.
- [ ] Make **every** source in a session fail (e.g. all bad URLs). Confirm:
      no synthesis ever fires, the note stays empty, and there is **no error
      banner about synthesis** — because synthesis never ran, there's nothing
      to report a failure about. Per-source errors are still visible in the
      rail. If you see a "Couldn't write the note…" banner in this all-failed
      case, that's a bug.
- [ ] With no AI provider configured in Settings → AI Providers, drop a source
      whose text is extractable (e.g. a website or a PDF) — synthesis will
      fail; the failure banner reads something like *"Couldn't write the
      note: All AI providers failed for job 'summarize_text': none
      configured"* with a **Retry** link and a dismiss (✕). (Only the
      video-native path — a YouTube/video source with no transcript and no
      Gemini-class provider — produces the more specific "add a Gemini key in
      Settings → AI Providers" message; the general no-provider case surfaces
      the provider-chain error above instead.) Either way, sources stay
      viewable and capture still works — only the note-writing step is
      blocked.
- [ ] **Environment gotcha, not necessarily an app bug:** if you see a sudden
      wave of backend 5xx responses or PostgREST connection errors partway
      through a session (after everything was working a minute earlier), check
      the Supabase dashboard before debugging it as application code — a
      free-tier project can pause itself mid-session, and that looks exactly
      like a backend outage from the browser.

## 12. Editing freedom

- [ ] After a draft lands, freely restructure it: reorder blocks, rewrite
      paragraphs, delete a section, add your own headings/lists/tables.
      Nothing about the note should feel special or locked — it's an ordinary
      note.
- [ ] Reload the page → your edits persisted (autosave). Navigate away to
      `/brain` and back into this note via **"Open sources (N)"** in the
      normal note toolbar → the workspace shell reopens with the same note and
      sources.
- [ ] Deleting a section you'd anchored to a source doesn't leave the app in a
      broken state — its chip disappears the next time anchors are
      recalculated (on the next apply), it isn't actively pruned on every
      keystroke, so don't be surprised if a stray chip for a just-deleted
      section lingers until the next synthesis or reload.

## Automated checks (run before this checklist, still the gate for regressions)

```bash
# backend
cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio
# 169 passed, 0 failures, 0 errors as of 2026-07-30
# (plugin autoload disabled because ROS Jazzy's system pytest plugins crash collection)

# frontend
cd frontend && npx tsc --noEmit && npm run build
# both clean as of 2026-07-30; /brain/workspace and /brain/workspace/[noteId] appear
# in the build's route table
```

**Neither of these substitutes for actually running this checklist in a
browser.** A first live pass ran on 2026-07-30; the sections it did not reach
are listed in the header.

## Known quirks — expected, do not file these as bugs

- **Collapsed Deep Dive toggles look like missing content, and are not.** A
  nested `<details>` becomes a nested `toggleListItem` block that starts
  collapsed, so the note *appears* to hold about half the draft until you expand
  them. Verified on a real draft: 10,003 characters in the draft, 10,003 in the
  saved note, all 27 toggle summaries present, nesting two levels deep. If you
  are checking this yourself, compare the note's **saved block tree** (walk
  `children` too) against the draft's `textContent` — reading the editor's
  rendered `innerText` silently omits every collapsed toggle and will convince
  you content was lost.
- **Re-synthesis asks replace-vs-append after a page reload**, even on a note
  you haven't touched. Deliberate: once the page reloads, the client can no
  longer prove the content came from a draft rather than from you, so it asks
  rather than risk overwriting your writing. Within a single session it does not
  ask.
- **The synthesis can take 3–5 minutes**, and can fail with `Server
  disconnected`. That is the free-tier OpenRouter model (Gemini is quota-dead
  and 429s first, by design — the fallback chain is working). Hit Retry in the
  banner; your existing note is left intact by a failed run.
- **The checkpoint button's label shows a stale timestamp** (e.g. `0:00`) while
  the value it inserts is the live playhead position. Pre-existing cosmetic
  quirk in the video viewers.
- **A source stuck at `queued`** has a retry arrow in the rail — that is the
  escape hatch if the batch never started.

## If you are driving this with browser automation

Two things will waste your time otherwise:

- The synthetic mouse click opens `PromptDialog` and it closes again before the
  next call, and `type` does not reach the controlled input. Dispatch
  `button.click()` directly and set the input through the native value setter
  plus an `input` event.
- **Never run `npm run build` while `next dev` is running** — they share the
  `.next` directory and the build kills the dev server.
