# Skills: per user, AI-drafted, installable, plus a browser sandbox

Approved 2026-10-27. Follows DIAGNOSIS.md, which had set these three aside; the user asked for a
safe way to have them. Each step: code + tests + its own commit.

## Step 1 — skills per user (security fix, migration 033)

Found while planning: every account read and wrote one server folder (`~/.secondbrain/skills`),
so one user's edited skill became every user's instructions (sign-up is open), and Render wiped
the folder at each deploy. Now the database (`user_skills`, RLS) is the truth. Each user's rows are
written to a private per-user folder under the temp directory (`services/skill_store.py`), so
the file-based readers keep working unchanged. The current user rides a context variable set by
`get_user_id` and by every background entry point (job worker, source processing, synthesis).
**No user means built-ins only**, never another user's skills. Without migration 033: built-ins
only, and saving a skill says the migration is needed.

## Step 2 — origins and limited powers

Every skill carries an origin: built-in (repo, reviewed), yours, AI-drafted, installed. Loading a
non-built-in skill into a turn marks the turn untrusted (permissions.py then asks before edits and
MCP calls). Installed skills cannot request destructive tools or MCP tools the user did not allow.

## Step 3 — AI-drafted skills (Hermes's learning loop, human in the middle)

After a task, the chat can offer "Save this as a skill?" with the full text. Nothing is active
until the user saves it. Drafts are cleaned (hidden characters) and flagged (instruction-like
text). Unused skills are archived, never deleted (Hermes curator rule).

## Step 4 — skill store (OpenClaw's lesson applied)

Install from a GitHub repo or link through the SSRF guard; the full text is shown before install,
with warnings; pinned by hash, never auto-updated (an update shows the diff); a reviewed list like
approved plugins. Text only: no script from a skill ever runs on the server.

## Step 5 — browser sandbox (OpenShell's idea, our way)

Code runs in the user's browser in Pyodide inside a Web Worker: network APIs removed after
loading, no DOM, no session, only the data passed in, time and memory limits (the worker is
killed). The server never executes code.

## Status (2026-10-27)

| Step | Commit | Tests |
|---|---|---|
| 1 Per-user skills | `d7e55d8b` | `tests/test_skill_store.py` (one user's edit never reaches another) |
| 2 Origins and limits | `ff90f1a7` | `tests/test_skill_origins.py`, `SourceMark.test.tsx` |
| 3 AI-drafted skills + curator | `5b824548` | `tests/test_skill_drafts.py`, `SkillDraftCard.test.tsx`, `ArchivedSkills.test.tsx` |
| 4 Install from a link | `98a948bd` | `tests/test_skill_install.py`, `InstallSkill.test.tsx` |
| 5 Browser sandbox | (this commit) | `lib/sandbox/*.test.ts`, `RunnablePython.test.tsx` |

Step 5 was checked in Chrome against a local copy served with the same CSP: Pyodide 0.29.5, numpy
and a matplotlib chart run; fetch, XMLHttpRequest, importScripts, Worker, pyfetch, eval and new
Function are refused even through `__import__("js")`; an endless loop is killed. Code can forge
its own "done" message — harmless, the page reads only text and validated PNG data from it.

Decided in building: the sandbox runs on the user's click (Run on a Python block in a chat
answer), never as a tool the model calls by itself; an installed skill's scripts are skipped,
not run in the sandbox (a later step if wanted). **Migration 033 must run before pushing.**
