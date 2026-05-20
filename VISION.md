# Second Brain — Vision

---

## The Three Pillars

### 1. Analyse — Transform Raw Material into Understanding

You drop a PDF, paste a URL, or share a YouTube video.
Second Brain doesn't just save it — it **understands it**.

The AI decomposes the material into:
- A scannable overview you can absorb in 2 minutes
- Deep-dive sections for each concept
- **Interactive HTML/JS visualizations** for concepts that benefit from it — simulations, 3D diagrams, live calculators

### 2. Store — A Block Editor That Understands Its Content

Notes live in a **BlockNote block editor** — the same block-based paradigm as Notion, with full keyboard shortcuts, drag-to-reorder, nested blocks, and multi-column layout.

What makes it different:
- Every note has a **mastery status** (not_started → learning → reviewing → mastered)
- Every note is automatically **semantically indexed** into a vector space that captures meaning
- Notes have **sources** and **topics** — structured metadata the AI can reason about
- Notes can contain **interactive iframe blocks** — the Disco content lives inside the note itself

### 3. Link — Your Knowledge Base Travels With You

Any external AI can query your Second Brain via **MCP (Model Context Protocol)**:
- `search_brain("topic")` — semantic search across all your notes
- `get_note("id")` — fetch full note content
- `list_notes()` — browse your knowledge base

Every result includes a **deep link** (`/brain/note-id`) so the external AI can point you directly to the relevant note. Your context travels with you — whether you're in the Second Brain app, Claude Desktop, or any future AI assistant.

---

## The Google Disco Philosophy

Google's **Project Disco** explored what happens when AI replaces static content with generated, interactive experiences. Instead of reading about a concept, you interact with it.

Second Brain applies this during ingestion. The AI generates self-contained HTML/CSS/JS blocks, sandboxed inside iframes inside the BlockNote editor:

| Domain | Static (before) | Disco (after) |
|---|---|---|
| Sorting algorithms | A diagram | Animated comparison of merge sort vs quicksort |
| Orbital mechanics | A drawing | Live simulation with adjustable parameters |
| Electrical circuits | A schematic | A circuit you can wire and test yourself |
| Calculus | A static graph | A function plotter with the derivative shown in real time |
| Fourier transforms | A formula | A live signal decomposer you can interact with |

These are not embedded YouTube videos or iframes to external sites. The AI **generates** the visualization as part of the note — it lives in the editor, travels with the note, and works offline.

---

## The Hardware Philosophy

Most AI applications require an internet connection, a beefy server, or both. Second Brain is designed to run on hardware that most people actually have.

**The key insight:** the Adreno 710 GPU on a $200 Android tablet can run Gemma 4 E2B faster than a 10-year-old Intel laptop. With llama.cpp compiled for Vulkan and all layers offloaded to the GPU (`-ngl 99`), inference runs at 8–15 tokens/second — real, usable conversation speed.

| Hardware | Role |
|---|---|
| Laptop (i3-5005U, 4 GB RAM) | OpenRouter for heavy generation, llama.cpp for embeddings |
| Android tablet (Snapdragon 7s Gen 2, Adreno 710, 6–8 GB RAM) | Full local inference — Gemma 4 E2B via llama.cpp Vulkan |
| Cloud (OpenRouter) | Fallback — switchable in one env var, no lock-in |

This means Second Brain can work:
- **Fully offline** — classroom with no internet
- **Fully private** — sensitive research, medical notes, no data leaving the device
- **In constrained environments** — where cloud AI is restricted or unaffordable

The constraint is the feature. Running on cheap edge hardware is not a compromise — it is the honest proof that the system works where it needs to.
