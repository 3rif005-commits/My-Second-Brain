# PROMPT: Finish manual testing of the Workspaces feature (video/ffmpeg flows)

Copy everything below this line into a fresh Claude Code session in this repo.

---

I want you to finish manual end-to-end testing of the **Workspaces** feature I built
in prior sessions. Read your memory first — `project_workspaces_feature.md` and
`project_backend_test_quirks.md` have the full history: what shipped, what's already
verified working, and nine real bugs found and fixed across two rounds of live
browser testing (BlockNote schema factory-function bug, react-pdf SSR crash, llama.cpp
embed batch token-limit bug, native-dialog browser-automation freezes, a reasoning-model
content leak, a z-index click conflict, etc.). Don't re-derive that context — read it.

## What's already verified (don't redo)

Website, YouTube, and PDF resource imports all work end-to-end through the actual
browser: import → background processing → canvas cards → split view → forward/reverse
sync (section chips) → element send-to-note (text) → checkpoint insertion → grounded
chat with clickable citations. All 126 backend tests pass, `tsc --noEmit` and the
production build are both clean as of the last session.

## What's NOT tested yet — this is your job

Everything that depends on **ffmpeg**:
1. **Uploaded video resource** — the `video` kind has never been imported through the
   browser. Import a small `.mp4` (a few seconds is fine — generate one with ffmpeg
   itself if you don't have a sample: `ffmpeg -f lavfi -i testsrc=duration=8:size=640x360:rate=15 -f lavfi -i sine=frequency=440:duration=8 -pix_fmt yuv420p test_video.mp4`),
   confirm it processes to `ready` (with or without a transcript — faster-whisper is
   installed in `backend/.venv`, so it should attempt local transcription).
2. **Frame capture** — from both the uploaded video and the existing YouTube resource
   in the test workspace (see below): click "🖼 Frame", confirm a real image lands in
   the note.
3. **Clip extraction** — "🎬 Clip" (click to mark start, click again to mark end) on
   both video kinds; confirm a playable video block lands in the note.
4. **Audio extraction** — "🎧 Audio" similarly.
5. For YouTube specifically, clip/audio/frame capture routes through `yt-dlp
   --download-sections` — confirm `yt-dlp` (already installed in `backend/.venv`) can
   actually fetch a byte-range from a real video, not just that the endpoint doesn't
   crash.

## Prerequisite — check this FIRST

**ffmpeg must be installed.** Run `which ffmpeg ffprobe`. If missing, tell the user to
run `sudo apt install ffmpeg` themselves (you can't sudo) and wait for confirmation
before continuing — don't attempt any capture testing without it, it will just fail.

## Environment setup

Background processes and `/tmp` do **not** survive a session boundary in this
environment — assume everything is cold-started:

```bash
./llama.sh start                                                    # gen :8080, embed :8081
cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000
cd frontend && npm run dev                                          # :3000
```

Wait for `curl localhost:8000/health` → `{"status":"ok"}` and a 200/307 from
`localhost:3000` before touching the browser. The `/brain/workspaces/[workspaceId]`
route is heavy (react-pdf + BlockNote + React Flow) — its first Turbopack compile
after a cold start can genuinely take 30-60s+ on this hardware. That's not a hang.

Login: `aubrif005@gmail.com` / `SecondBrain2026!`. For any direct API verification
(curl), get a JWT via:
```bash
ANON=$(grep -oE "NEXT_PUBLIC_SUPABASE_ANON_KEY=.*" frontend/.env.local | cut -d= -f2)
TOKEN=$(curl -s "https://esfhsdukyhyrlgzflsad.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"aubrif005@gmail.com","password":"SecondBrain2026!"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
```

There is already a workspace called **"My First Workspace"** with 3 ready resources
(Wikipedia article, a 3Blue1Brown YouTube video, a small test PDF) — reuse it rather
than creating a new one, so the YouTube capture testing has a real resource to work
against immediately.

## Browser automation notes (learned the hard way — read before driving Chrome)

- Every `prompt()`/`confirm()`/`alert()` in the workspace UI was already replaced with
  in-page dialogs (`components/ui/PromptDialog.tsx`, `ConfirmDialog.tsx`) and a toast
  system (`useToast()` in `app/providers.tsx`) specifically because native dialogs
  freeze the automated tab. If you add any new user-facing error/confirm/prompt, use
  those, not the native browser APIs.
- `mcp__claude-in-chrome__file_upload` no longer accepts filesystem paths in this
  environment — it wants file contents passed a different way, or just isn't usable
  for local test files at all. Don't fight it: import files via a direct multipart
  `curl -F "file=@path"` POST to `/workspaces/{id}/resources` on the backend, same
  pattern used successfully for the PDF test, then observe the result in the browser.
- Don't fire overlapping curl requests and browser clicks against the same resource
  without waiting for each to settle — a `reprocess` curl call and a `delete` curl call
  fired close together caused a confusing race in the last session (not an app bug,
  just bad test sequencing). One action, confirm its result, then the next.
- Workspace canvas cards can overlap when auto-positioned; if a double-click doesn't
  open what you expect, drag the top card aside first rather than guessing coordinates.

## Definition of done

Frame/clip/audio capture confirmed working (or a specific, understood failure reason
if something's still broken) for both the uploaded video and the YouTube resource.
Fix any real bugs you find the same way the last two sessions did: reproduce, find
root cause, fix, verify live, run the full backend test suite + frontend typecheck
before calling it done, update `docs/workspace-manual-test-checklist.md` and your
memory with what you learned.
