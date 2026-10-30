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

The app stands on three pillars. Everything it does serves one of them:

| Pillar | What it means | What the app does today |
|---|---|---|
| **Store** | Keep what you learn, in a structure that lasts | Blocks and databases; sources (PDF, web, video, audio) kept beside the notes made from them; a privacy level on every note; search over all of it |
| **Link** | Connect each new thing to what you already know | Links and backlinks between notes; database relations; every AI claim cites the exact page or moment it came from; hover a link to see the passage |
| **Analyse** | Turn what is stored and linked into understanding and action | Nemotron study guides from your sources; answers grounded in your own notes; interactive blocks built on request; web research; a small model that reads each request and decides where it runs |

One rule runs under all three: **you decide what the AI may see**, and private things stay on
hardware you own. Capture is the door into the pillars: the more the brain can take in, the more
it can store, link and analyse.

The plan grows the three pillars in five phases:

| Phase | Name | What it adds | Status |
|---|---|---|---|
| 1 | **Foundation**: the knowledge substrate | Blocks and databases: one structure that can hold any kind of knowledge and link it (pages, rows, properties, relations, backlinks) | Built |
| 2 | **Agency**: the agent layer | An AI that works on that substrate: the routing switchboard and privacy rules, skills, MCP tools, web research, and a learning loop (after Hermes Agent) that drafts new skills you approve before they are kept | Built (this hackathon) |
| 3 | **Reach**: universal capture | Everything digital you take in, not only what you upload. PDFs, web pages, YouTube, video and audio work today; next come social media, newsletters, messages, podcasts and bookmarks, captured as you consume them | Started |
| 4 | **Ownership**: a dedicated device | A small, portable box that runs the small Nemotron and keeps your private memory on it. Your second brain becomes something you own and carry; the cloud only does the heavy work you allow | Idea |
| 5 | **Presence**: the physical world | Real-life input from smart glasses, wearables and sensors: what you see, hear and do becomes notes, processed on your own device under the same privacy rules | Idea |

Phases 1 and 2 build the brain: where knowledge lives, and the mind that works on it. Phases 3 to 5
widen its senses: from the files you give it, to your whole digital life, to the physical world.
Phase 4 comes before phase 5 on purpose: before the brain sees your real life, it has to run on
hardware you own.

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
