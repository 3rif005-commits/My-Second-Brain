# Second Brain — 3-Minute Demo Script

**Kaggle "Gemma 4 Good" — Submission Demo**

---

## Setup (before recording)

- [ ] Backend running: `cd backend && uvicorn main:app --reload`
- [ ] Frontend running: `cd frontend && npm run dev`
- [ ] llama.cpp embed server: `./llama.sh start`
- [ ] Tablet app open, server started, status shows "Ready on :8082"
- [ ] `LITERT_URL=http://<tablet-ip>:8082` in `backend/.env`
- [ ] Browser open at `http://localhost:3000`, logged in as `aubrif005@gmail.com`

---

## 0:00 — Hook (15 s)

> "What if your notes could teach you back? This is Second Brain — a personal AI tutor
> that runs Gemma 4 entirely on-device: a $150 Android tablet handles inference,
> your laptop just serves the UI."

**Show:** Home page / sidebar with a few notes already present.

---

## 0:15 — Ingest a PDF (45 s)

1. Navigate to `/brain/ingest`
2. Drop a PDF (e.g. a short research paper or lecture slide deck — 5–10 pages)
3. Model auto-selected: **Nemotron 120B via OpenRouter**
4. Progress bar runs: Uploading → Extracting → Generating → Done
5. App navigates to the new note

> "In 30 seconds, Gemma turns a raw PDF into a structured study guide —
> with an Overview callout, expandable Deep Dive sections,
> and a colour-coded importance scale."

**Show:** the rendered note with callouts, toggle blocks, and the ⚡ Interactive Block card at the bottom.

---

## 1:00 — Disco Blocks — Interactive Knowledge Check (30 s)

1. Click the ⚡ Interactive Block card
2. Switch to **AI** tab
3. Type prompt: `"A multiple-choice quiz with 3 questions about the key concepts in this note"`
4. Click **Generate** — response streams from the tablet (⚡ source in server logs)
5. Switch back to **Preview** — the quiz renders in the sandboxed iframe
6. Interact with the quiz (click answer options)

> "The interactive block is a sandboxed HTML/JS/CSS playground.
> Ask AI to generate a quiz, a simulation, or a chart —
> or paste your own code. All generated on the tablet."

---

## 1:30 — AI Tutor Chat (30 s)

1. Navigate to `/brain/chat`
2. Ask: `"Explain the main argument of the paper I just ingested"`
3. Response streams token-by-token
4. Context panel (desktop) shows the retrieved note chunks with similarity scores
5. Point to the footer: **source: tablet** — inference is running on the Redmi Pad Pro

> "The tutor retrieves the most relevant chunks from your notes,
> injects them as context, and streams Gemma's answer directly from the tablet NPU."

---

## 2:00 — MCP + Claude Desktop Integration (30 s)

1. Switch to Claude Desktop
2. Type: `"What did I learn about [topic from the PDF]?"`
3. Claude calls `search_brain("topic")` — tool call shown in UI
4. Claude returns an answer with a link: `[Note Title](http://localhost:3000/brain/uuid)`
5. Click the link → browser opens to exactly that note

> "Through the MCP server, Claude Desktop can search your Second Brain,
> read full notes, and link you directly back to the source."

---

## 2:30 — Wrap-up (30 s)

> "Second Brain runs entirely on a $150 tablet + a laptop you already own.
> No cloud GPU. No API costs for inference.
> Gemma 4 E2B in LiteRT format runs on the Hexagon NPU — under 3 GB RAM total.
>
> It learns your notes, teaches them back, and stays in your pocket."

**Show:** tablet screen with the app notification: "⚡ Second Brain — Model ready — listening on :8082"

---

## Technical highlights for submission write-up

| Prize | How we qualify |
|-------|---------------|
| **LiteRT $10K** | MediaPipe LLM Inference on Android (Redmi Pad Pro), Gemma 4 E2B `.task` format, Hexagon NPU |
| **Cactus $10K** | PWA-installable, SmartRouter routes laptop → tablet → OpenRouter, MCP integration |
| **llama.cpp $10K** | llama.cpp embed server (nomic-embed-text), Gemma 4 E2B GGUF for offline chat on laptop |
| **Main Track** | Personal AI tutor: ingest PDF → structured note → chunk retrieval → streaming chat |

---

## Kaggle Submission Checklist

- [ ] GitHub repo link in submission
- [ ] Notebook (or `submission.ipynb`) explaining the project
- [ ] 3-minute video linked (YouTube unlisted or Loom)
- [ ] All prize track requirements documented in notebook
- [ ] Submitted before May 18, 2026 23:59 UTC
