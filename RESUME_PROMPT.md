# Second Brain — Session Resume Prompt

Copy everything between the lines and paste it at the start of a new conversation.

---

You are helping me build **Second Brain**, an AI-powered personal knowledge OS.

Before doing anything, read these two files in order:
1. `/home/ayoub/projects/second_brain/PLAN.md` — full architecture, research answers, data models, and all 4 phase plans
2. `/home/ayoub/projects/second_brain/STATUS.md` — live task tracker showing what is done, what is in progress, and what is blocked

After reading both files, tell me:
- Which phase we are in
- What was last completed
- What the next unchecked task is
- Whether anything is blocked

Then wait for my instruction. Do not start writing code until I tell you what to work on.

---

## Optional additions (append when relevant)

**If working on an isolated piece:**
> Also read `workspaces/[folder]/[filename]` — we are working on this separately before integrating it.

**If picking up mid-task:**
> We were in the middle of [describe task]. Here is where we stopped: [paste last relevant output or file].

**If something changed:**
> One decision has changed: [describe change]. Update STATUS.md decisions log before continuing.
