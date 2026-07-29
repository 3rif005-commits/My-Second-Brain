# PROMPT: Build the "Workspace" feature for Second Brain

Copy everything below this line into a fresh Claude Code session in this repo.

---

I want you to research, plan, build, and test a major new feature for my Second Brain app: **Workspaces**. Follow the process rules at the bottom exactly.

## Context

This repo is my Second Brain project (FastAPI backend + Next.js frontend, Supabase, block-based note editor, inline AI, local Gemma LLM, MCP integration). Before doing anything else, explore the codebase to understand what already exists — especially: the note/block data model, the block editor, the AI agent engine (`backend/services/agent/`), the retriever, and how notes are stored and indexed. Read `PLAN.md` and `STATUS.md` if present.

History that motivates this feature: the app used to have an "Import Knowledge" tab. It was removed when AI was made available inline everywhere. That created a gap: there is no place to gather source materials, study them with AI, and produce notes from them. Workspaces fill that gap.

## The feature — full specification

A **Workspace** is a study/work area that holds two kinds of objects together: **input resources** (the materials I'm learning from) and **output note pages** (where results go). Note pages inside a workspace are ordinary Second Brain notes (same block editor, same database, searchable and linkable like any note) — the workspace just groups them with their sources.

### 1. Resource ingestion

A workspace accepts many resources at the same time (like NotebookLM). Source types for v1 — all of them:

- **Documents**: PDF, markdown, txt (extensible to more later)
- **YouTube videos**: paste a URL
- **Uploaded video files**: mp4 etc.
- **Websites**: paste any URL, imported as a readable source

Processing starts **automatically on import, in the background**, with visible per-resource status (queued / processing / ready / failed). Processing means: extract the content (text, layout elements, transcript), then generate the synced AI summary (below). When I open a resource, everything should already be ready — the NotebookLM feel.

### 2. The workspace surface (hybrid canvas)

- The workspace itself is a **freeform 2D canvas** — resources and note pages appear as cards/layers I can drag, resize, stack, and arrange freely, like real papers on a table (the Flexcil feel).
- **Opening a source** (e.g. double-click) switches to a **split view**: the source viewer on one side, and on the other side its **output note page** (which starts life as the AI-generated summary — see section 3) open in the normal block editor. Closing it returns to the canvas.
- Results I extract or write land on note pages that live on the canvas.

### 3. Synced AI summary — the summary IS the output note (the NotebookLM / video-notebook experience)

For every resource, the AI auto-generates a structured summary. Critical requirements:

- **The summary is not a separate side artifact — it IS the output note page for that source.** The AI-generated summary is the starting draft of the note; I edit it in real time (in the split view, while watching/reading the source) to shape it into my final output. There is one object, not two: no separate "summary panel" that later gets copied into a note.
- The summary/note is **made of normal editable note blocks** — I can edit, delete, extend it like any note. It is not a frozen AI output.
- **How to summarize is already defined in the app's core architecture**: `backend/prompts/mastery_guide.py` contains the system prompt that produces BlockNote-compatible notes (senior-student voice, follows the source's own structure, two-layer overview-callout + deep-dive-toggle per section). **Reuse and build on this prompt** for workspace summaries — do not invent a new summarization style. Extend it with what the workspace needs (per-section sync anchors: timestamps for video, page/position for documents) and adapt per source type where necessary.
- Source and summary are **synchronized**: while the video plays, the summary section for the current timestamp is highlighted/scrolled into view; while I scroll a PDF, the summary follows the current page/section — and the reverse: clicking a summary section jumps the source to that spot.
- Into the summary (or any note page) I can insert, with one easy action:
  - **From video**: a captured frame, a clip, an audio segment, or a **checkpoint** — a small block that deep-links to an exact timestamp; clicking it opens the video at that moment.
  - **From documents**: any element (see below), or a checkpoint deep-linking to an exact page/position.

### 4. Element-level content tools

Each resource type gets tools that understand its content:

- **PDF/documents**: the viewer must recognize **text blocks, images/figures, tables, and math formulas as separate selectable elements**. I select any element (e.g. a figure) and in one click copy it or send it to a note page. Formulas should arrive as editable math (LaTeX), not screenshots, when possible.
- **Video**: frame capture at current time, clip extraction (start–end), audio extraction, timestamp checkpoints — all sendable to a note page in one action.
- **Websites**: clean readable text + images, selectable and sendable the same way.

### 5. Grounded chat with citations

A chat panel scoped to the workspace: I ask questions, the AI answers **grounded only in the workspace's resources**, and every answer carries **citations** (page number / timestamp / section). Clicking a citation opens that source at that exact spot.

### 6. Provider-agnostic AI layer

The AI features must work with **any model provider via API**: the user configures API keys (Gemini, Anthropic, OpenAI, or any OpenAI-compatible endpoint), and the local Gemma model remains available. The system routes each job to the best available model for that job type (e.g. native video understanding → Gemini if configured; text summarization → whatever is available; fallback to local). Missing capability should degrade gracefully (e.g. no video-capable model → use transcript + extracted frames).

### 7. Scope limits for v1

- **Web only** (the Next.js app). Add the feature to the Android parity tracker (`ANDROID_PARITY.md`) but do not build Android.
- Tools named in this spec (NotebookLM, Flexcil, "video notebook") describe the **experience I want**, not the implementation. If your research finds a better technique or library than anything implied here, use the better one.

## Process — follow exactly, in this order

### Phase 1 — RESEARCH (no code)

Use web search to research and compare, at minimum:

- **PDF layout/element extraction**: Docling, Marker, MinerU, PyMuPDF, Surya, unstructured — which best yields selectable text blocks / figures / tables / formulas with bounding boxes?
- **Formula recognition** to LaTeX (e.g. Texify, pix2tex) if not covered above
- **YouTube**: transcript retrieval, metadata, and frame/clip access techniques
- **Uploaded video**: local pipeline (ffmpeg for frames/clips/audio, Whisper or faster-whisper for transcript) vs cloud video understanding
- **Website import**: readability-style extraction (e.g. trafilatura, readability, Firecrawl-style approaches)
- **Canvas library** for the freeform surface: tldraw vs React Flow vs Konva vs custom — must handle draggable/resizable/stackable cards containing live React components (PDF viewer, video player, block editor)
- **Source↔summary sync** patterns (timestamp-anchored and scroll-position-anchored block metadata)
- **Provider-agnostic LLM layer**: LiteLLM, Vercel AI SDK, or a thin custom adapter — including capability-based routing
- **Grounded RAG with citations** that map back to page/timestamp anchors

Deliverable: `docs/research/workspace-research.md` — findings, the chosen stack, and a short justification for each choice. Prefer solutions that fit the existing codebase.

### Phase 2 — PLAN (no code)

Write a complete implementation plan covering **everything** in this spec: data model + migrations, ingestion/processing pipeline, all backend endpoints, the AI layer and routing, all frontend components (canvas, split view, viewers, element selection, chat), and how workspace notes reuse the existing note/block system. Save it to `docs/plans/`.

### Phase 3 — BUILD everything

Implement the entire plan, completely. **Do not stop to test individual parts along the way** — build the whole feature first. Work autonomously; only stop for genuine blockers that require my input (e.g. a required API key).

### Phase 4 — TEST at the end

Only after everything is built:

1. Write and run backend tests for the new services and endpoints.
2. Run the frontend production build and typecheck; fix all errors.
3. Verify each user flow end-to-end: import each source type → auto-processing completes → open split view → synced summary works → extract elements/frames/checkpoints to a note page → deep links jump back correctly → grounded chat answers with clickable citations.
4. Fix everything that fails, re-run until green.
5. Finish with a **manual test checklist for me**: the exact CLI commands to start the app and a step-by-step list of what to click to verify each flow myself.
