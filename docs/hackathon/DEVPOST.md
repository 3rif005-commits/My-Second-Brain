# Devpost submission text

Paste each section into the matching Devpost field.

## Tagline

One home for everything you know, with an AI that works on it, and NVIDIA Nemotron on Nebius
deciding what runs where.

## Inspiration

What I know is scattered: lecture PDFs, YouTube videos, links, plans, half-written notes. AI can
help me use all of it, but most tools want everything sent to one cloud model. I wanted a
notebook that understands what I put in it, where a small model decides what each request needs
and private notes never leave for the cloud.

## What it does

Second Brain is a Notion-style block editor with an AI workspace:

- **Notes are blocks**: headings, to-dos, callouts, toggles, math, tables, code, databases and
  interactive blocks.
- **Workspace**: open a note beside its sources (PDFs, web pages, YouTube lectures). Nemotron reads
  the transcript or the document and writes a study guide into the note. The transcript follows
  the video; one click puts a **frame** or a **clip** of the lecture into the note.
- **Interactive blocks**: ask, and Nemotron Super writes a small app (HTML/JS) that runs inside the
  note, e.g. a gradient-descent playground.
- **Web research with Tavily**: when your notes aren't enough, it searches the web. You approve the
  exact words that leave before anything is sent.
- **Databases**: notes live as rows (with properties and board/table views) and stay full notes.
- **Routing you can see**: every answer shows which model ran and why; Settings → Routing logs
  every call, and rules let you pin topics to a model. Notes marked Private are held back from
  cloud models.

## How we built it

- Next.js + BlockNote frontend (Vercel), FastAPI backend (Render), Supabase (Postgres + pgvector).
- **Nebius Token Factory** serves every AI call of the demo account:
  - `NVIDIA-Nemotron-3-Nano-30B-A3B` is the **brain** (it reads each request and picks where it
    runs) and the fast model for everyday answers;
  - `nemotron-3-super-120b-a12b` does the heavy work: study guides, derivations, interactive blocks.
- A switchboard runs on every model call: fixed rules first (e.g. private notes → local only),
  then the brain, then a slot. The design keeps a small Nemotron on the user's own machine as the
  only model allowed to read private notes.
- **Tavily** for web search, behind an approve-first step.
- The demo video is made from screen recordings of the real app, edited with Remotion.

## Challenges we ran into

- YouTube refuses caption and media requests from cloud servers (Render), so on the hosted backend
  a YouTube source has no transcript. A subtitle file in the session now stands in, and frame/clip
  capture works when the app runs on a home connection.
- Nemotron writes some things differently from the models we had tuned for (links in 【】
  brackets, double-escaped newlines, formulas mid-stream); each one got a small fix and a test.

## Accomplishments that we're proud of

- Every AI call of the demo account really runs on Nemotron on Nebius, and the app shows it.
- Private notes stay private by rule, not by prompt.
- From an empty note to a study guide with frames, clips and a working interactive block, in one
  session.

## What we learned

A small model is a good switchboard: it decides in about a second, and the big model is only paid
for when the work needs it.

## What's next

- Run the brain and the private model on the user's own machine by default.
- Add existing notes to a database in one click.
- A proxy for YouTube on the hosted backend.

## What changed since 26 August (rule: work before the hackathon must be disclosed)

The block editor, workspace and ingestion pipeline existed before. Since 26 Aug 2026 (589 commits):

- **Nebius / Nemotron integration** (`backend/services/nebius.py`): Token Factory provider, the
  Nano brain, Super for heavy work, a Nemotron-only lock for the demo account.
- **Routing switchboard** with rules, the brain, a privacy gate and an activity log.
- **Tavily web research** with approve-first queries.
- **Workspaces redesign**: AI panel with chat tabs, capture rail (frame, clip, audio), transcript
  that follows the video, study-guide checks.
- **Databases** (Notion-style rows, properties, views, automations), Notion sync, MCP client,
  skills (including AI-drafted skills you review before saving), and many fixes.

## Built with

nebius, nvidia-nemotron, tavily, next.js, react, blocknote, fastapi, python, supabase, postgresql,
pgvector, vercel, render, remotion
