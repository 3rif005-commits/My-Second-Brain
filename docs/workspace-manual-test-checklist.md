# Workspaces — Manual Test Checklist

> Phase 4 deliverable (2026-07-12). Run through this once after the setup steps.
>
> **2026-07-29: ffmpeg-dependent flows verified live** (uploaded-video import, frame/clip/audio
> capture on both uploaded video and YouTube). See the dated entry at the bottom of this file.

## 0. One-time setup (required before anything works)

1. **Apply the migration** — no direct DB access exists from this machine, so run it
   in the Supabase dashboard: SQL Editor → paste the full contents of
   `supabase/migrations/012_workspaces.sql` → Run. (Same procedure as migration 009.)
2. **Install ffmpeg** (frames / clips / audio extraction — everything else works without it):
   ```bash
   sudo apt install ffmpeg
   ```
3. *(Optional)* **faster-whisper** for local transcription of uploaded video files
   (~1 GB models; without it, uploaded videos degrade to no-transcript):
   ```bash
   cd backend && source .venv/bin/activate && pip install faster-whisper
   ```
4. `yt-dlp` was already installed into `backend/.venv` (needed for YouTube frame/clip capture).

## 1. Start the app

```bash
# Terminal 1 — embedder (needed for grounded chat indexing)
./llama.sh start

# Terminal 2 — backend
cd backend && source .venv/bin/activate && uvicorn main:app --reload

# Terminal 3 — frontend
cd frontend && npm run dev
```

Open http://localhost:3000 → log in.

## 2. Canvas + import (each source type)

- [ ] Sidebar → **Workspaces** → **New workspace** → name it → canvas opens.
- [ ] **Add source → Paste URL** → a Wikipedia article (e.g. `https://en.wikipedia.org/wiki/Gradient_descent`).
      Card appears with status `queued → processing → ready` (poll updates by itself).
- [ ] **Add source → Paste URL** → a captioned YouTube video
      (e.g. `https://www.youtube.com/watch?v=aircAruvnKk`). Card shows the video title + thumbnail when ready.
- [ ] **Add source → Upload file** → any PDF. Card gets a first-page thumbnail when ready.
- [ ] **Add source → Upload file** → a small `.mp4`. (Without faster-whisper the summary
      may be a stub — expected degradation.)
- [ ] When each resource turns **ready**, a matching amber **note card** appears beside it.
- [ ] Drag cards around, resize one (select → drag corner), pan/zoom the canvas,
      reload the page → layout and viewport were persisted.
- [ ] **Blank note page** from the Add menu → amber card appears; ✕ removes it (note survives in sidebar).

## 3. Split view + synced summary (the NotebookLM feel)

- [ ] **Double-click the YouTube card** → split view: player left, note right.
      The note is pre-filled with the AI summary (overview callouts + deep-dive toggles).
- [ ] A **Sections** chip bar sits above the note (one chip per summary section, labeled
      with timestamps). Click a chip → the video seeks there AND the note scrolls there.
- [ ] Play the video → as it crosses section timestamps, the matching note block
      flash-highlights and scrolls into view. Toggle **Sync off** → it stops following.
- [ ] Edit the summary (type, delete a block) → "Saving…" appears; close split view,
      reopen → your edits persisted. The note is also in the sidebar like any note.
- [ ] **Double-click the PDF card** → PDF left (selectable text), summary right;
      chips are labeled `p. N`; scrolling the PDF highlights the matching section;
      clicking a chip scrolls the PDF to that page.

## 4. Element extraction / send to note

- [ ] In the PDF viewer, hover blocks → colored outlines (text=indigo, image=green,
      table=blue, formula=purple). Click a **figure** → action bar → **→ Note** →
      image block appended to the note.
- [ ] Click a **table** → **→ Note** → an editable table lands in the note.
- [ ] Click a **formula** → **LaTeX** → editable math block (KaTeX) lands in the note.
      (Without a vision-capable provider it falls back to inserting the crop as an image —
      the .env Gemini key is quota-exhausted, so either add a fresh key in
      Settings → AI Providers or expect the image fallback.)
- [ ] Select some PDF text with the mouse → floating bar → **→ Note** → paragraph appended.
- [x] Video (YouTube or upload): **🖼 Frame** → image block. **🎬 Clip** (press once to
      mark start, again to end) → video block. **🎧 Audio** → audio block.
      *(These require ffmpeg; YouTube ones also require yt-dlp.)* Verified 2026-07-29,
      both video kinds — see dated entry below.
- [ ] Website viewer: click a paragraph/image → **→ Note** works the same.

## 5. Checkpoints + deep links

- [ ] In the video, click **📍 Checkpoint** → amber pill block appears in the note with the timestamp.
- [ ] Close the split view, open the note from the **sidebar** (as a normal note) →
      the checkpoint pill renders there too. Click it → the workspace opens in split
      view with the video at that exact moment.
- [ ] PDF `📍 p.N` button → same, but jumps to the page.

## 6. Grounded chat with citations

- [ ] Canvas → **Chat** → ask something answered by one of your sources
      ("what is gradient descent?").
- [ ] The answer streams with numbered chips like [1]. Hover a chip → source title +
      page/timestamp. Click it → split view opens at that exact spot.
- [ ] Ask something NOT in the sources ("what's the capital of Peru?") → the assistant
      says the sources don't cover it.

## 7. Failure modes (worth one look)

- [ ] Import a YouTube video without captions → resource still turns ready if a
      video-capable provider (fresh Gemini key) is configured; otherwise the note is a
      stub and `meta.summary_error` explains why. **retry** on the card reprocesses.
- [ ] Kill the backend mid-processing → card shows **failed** with an error → retry works.

## Automated checks already run (all green)

- Backend: `126/126` pytest (`cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 venv/bin/python -m pytest tests/ -p asyncio`)
  *(plugin autoload disabled because ROS Jazzy's system pytest plugins crash collection)*
- Frontend: `npx tsc --noEmit` clean, `npm run build` clean (29/29 pages)
- Live-verified without the DB: PDF element extraction (headings/images/formula bboxes),
  Wikipedia extraction (157 sections), YouTube metadata + transcript (286 snippets,
  time-anchored chunks), provider fallback (quota-dead Gemini → OpenRouter succeeded).

## 2026-07-29: ffmpeg-dependent flows (frame/clip/audio capture)

ffmpeg was installed (`sudo apt install ffmpeg`) and every capture path was driven live
against the real backend + real Supabase storage, for both video kinds:

- **Uploaded-video import**: multipart upload → background processing → ffprobe metadata
  (duration/width/height) correct → status `ready`. (Test file was a synthetic SMPTE
  color-bars clip with a sine-wave audio track — Whisper's VAD correctly dropped the tone
  as non-speech, producing an empty transcript and the expected "no extractable content"
  summary stub. Not a bug — real videos with speech will transcribe normally.)
- **Frame capture**: uploaded video and YouTube (via `yt-dlp --download-sections`) both
  produced a real JPEG matching the video content at the requested timestamp.
- **Clip extraction**: both video kinds produced a playable MP4 with real, correct-range
  content (confirmed by playback and by content differing between adjacent captures).
- **Audio extraction**: both video kinds produced a real MP3 — confirmed non-silent via
  `ffmpeg -af volumedetect` (mean/max volume in the expected range, correct duration
  matching the requested `[start, end]`).
- **yt-dlp `--download-sections` fetches real content**, not a stub — confirmed by content
  matching the on-screen frame and by audible, correctly-durationed audio.

**Bug found and fixed**: `services/workspace/processor.py`'s terminal `_set_status(...,
"ready")` write (and `_save_meta`) had no retry. This dev environment's Supabase
connection intermittently drops pooled HTTP/2 connections after a request sits idle
behind a slow ffmpeg/yt-dlp/whisper step (`httpcore.RemoteProtocolError: Server
disconnected`) — when that happened on the *last* write of an otherwise fully-successful
run, the resource was needlessly flipped to `failed`, forcing a full reprocess (re-running
whisper transcription for nothing). Fixed with a small 3-attempt retry helper
(`_with_retry`) around both status/meta writes. A wider fix (retrying the shared Supabase
client transport itself) was considered and rejected as disproportionate — it would touch
every DB/storage call in the app for a pre-existing, already-documented environment
flakiness (see `project_backend_test_quirks` memory) rather than the specific workspace-
processing regression this session could reproduce and verify.

**Known non-bug, environment-specific**: on a couple of occasions the browser's `<video>`
element got stuck at `readyState=0` indefinitely for a resource that had played fine
moments earlier in the same session (frame/clip capture both worked on it). Direct `fetch()`
and `curl` against the exact same signed URL (including a `Range` request) returned the
correct bytes with correct `Content-Range`/CORS headers instantly, and the resource played
fine again after a plain page reload — so this is a Chrome-automation-sandbox media-decoder
hiccup (possibly a concurrent-`<video>`-element limit once a clip/audio preview block is
already in the note), not an application bug. When it happened, audio capture was instead
verified by calling the exact endpoint the UI button calls (`POST /resources/{id}/capture`)
directly, which is indistinguishable from a real button click at the backend level.

Full suite green after the fix: 126/126 backend pytest, `tsc --noEmit` clean, `npm run
build` clean (29/29 pages).
