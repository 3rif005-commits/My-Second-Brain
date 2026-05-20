# AI Experience Redesign — Design Spec

> Status: **Draft for review**
> Date: 2026-05-17
> Scope: cross-cutting — backend, frontend (web + Android via WebView)
> Replaces: `/brain/chat` page, `/brain/ingest` page, `/api/interactive/generate`, the hand-rolled markdown parser in `MessageBubble.tsx`, the static prompt in `prompts/tutor.py`

---

## 1. Context

The current AI experience has seven concrete problems that, taken together, define this redesign:

1. **Static placement.** AI lives only at `/brain/chat` (tutor) and `/brain/ingest` (PDF→note). It cannot be called from anywhere else in the app.
2. **No streaming consistency.** Chat streams; the interactive-block generator does not; ingest waits for the full mastery guide before showing anything. The user sees frozen spinners.
3. **Broken rendering.** `MessageBubble.tsx` uses a hand-rolled mini-parser that handles bold/italic/headers/links but mis-renders nested lists, code blocks, tables, math, and anything beyond trivial markdown. Chat output also doesn't visually match the block editor.
4. **No app awareness.** The tutor only has a static `<knowledge_context>` XML block injected at request time. It cannot search, fetch, create, or edit notes. It cannot take action.
5. **No user customization.** Agent behavior is fixed in `prompts/tutor.py`. The user cannot define "modes", rules, or formatting preferences.
6. **MCP is one-way.** External AI (Claude Desktop) can query *into* the brain via MCP. The internal AI cannot query *out* to other MCP servers (web, calendar, etc.).
7. **Slow.** Cold-start OpenRouter free tier is 3–5 min. Tablet generation is ~10 tok/s. There is no caching strategy.

The redesign addresses all seven in one coherent substrate. It is not a UI polish.

---

## 2. Decisions (locked during brainstorm)

| # | Decision | Choice |
|---|---|---|
| D1 | **AI surface** | Three doors → one shared currently-active thread: side panel, ⌘K floating launcher, inline `/ai` in editor |
| D2 | **AI reach** | L4 — full agent loop with brain tools + external MCP client |
| D3 | **Customization model** | Composable skills (Claude Code-style `.md` files with frontmatter), loaded on demand by description match |
| D4 | **Output rendering** | Chat: markdown + custom fences for `:::callout` / `:::interactive`. Editor inline: BlockNote `xl-ai` block-level streaming |
| D5 | **Model strategy** | User toggle: **Local** (Gemma 4 E2B on tablet NPU) or **API** (OpenRouter / Anthropic / OpenAI). Switchable mid-conversation. |
| D6 | **Permission tiers** | Three tiers — External MCP (read-only), Internal API (writes allowed, `local_only` notes excluded), Internal Local (full access) |
| D7 | **Streaming** | SSE everywhere. Tool calls and skill activation are visible events in the stream, not invisible work. Ingest streams block-by-block into the note. |
| D8 | **Conversation persistence** | ChatGPT/Gemini-style: fresh thread by default, history sidebar to resume any past thread. All three doors write to the currently-active thread. Inline `/ai` is one-shot by default. |
| D9 | **Scope** | Web + Android in parallel — same architecture, Android inherits via the WebView already planned in Phase 4. |
| D10 | **Replacements** | New system fully replaces `/brain/chat`, `/brain/ingest`, `/api/interactive/generate`. No coexistence. |

---

## 3. Architecture

```
                ┌───────────────────────────────────────────────────────┐
                │                  FRONTEND · SURFACES                   │
                │                                                       │
                │  ┌──────────┐  ┌──────────┐  ┌─────────────────────┐  │
                │  │ Side     │  │   ⌘K     │  │  Inline /ai         │  │
                │  │ Panel    │  │ Launcher │  │  (BlockNote xl-ai)  │  │
                │  └─────┬────┘  └─────┬────┘  └──────────┬──────────┘  │
                │        │              │                  │             │
                │        └──────────────┴──────────────────┘             │
                │                       │                                │
                │           current thread (one at a time)               │
                └───────────────────────┼────────────────────────────────┘
                                        │ SSE
                ┌───────────────────────▼────────────────────────────────┐
                │              BACKEND · AGENT ENGINE                     │
                │                                                        │
                │  ┌─────────────────────────────────────────────────┐  │
                │  │  Agent loop                                      │  │
                │  │    1. classify intent → activate matching skills │  │
                │  │    2. system prompt = base + skill bodies        │  │
                │  │    3. loop: stream → tool_call → execute → cont. │  │
                │  │    4. emit visible events (tool_use, skill, etc.)│  │
                │  └─────────────────┬─────────────────┬───────────────┘  │
                │                    │                 │                  │
                │           ┌────────▼─────┐   ┌──────▼───────┐          │
                │           │ Skill loader │   │ Tool router  │          │
                │           │ (.md files)  │   │              │          │
                │           └──────────────┘   └──┬───────┬───┘          │
                │                                 │       │              │
                │              ┌──────────────────▼┐    ┌▼─────────────┐ │
                │              │ Brain Tools       │    │ MCP Client   │ │
                │              │ (Supabase, local) │    │ (external)   │ │
                │              └───────────────────┘    └──────────────┘ │
                └───────────────────────┬────────────────────────────────┘
                                        │
                ┌───────────────────────▼────────────────────────────────┐
                │          MODEL ROUTER · USER-TOGGLED MODE              │
                │                                                        │
                │     ┌─────────────────┐         ┌─────────────────┐    │
                │     │  Local          │   OR    │  API            │    │
                │     │  LiteRT tablet  │ ◀────▶  │  OpenRouter     │    │
                │     │  Gemma 4 E2B    │         │  Anthropic      │    │
                │     │  :8082          │         │  OpenAI / etc.  │    │
                │     └─────────────────┘         └─────────────────┘    │
                └────────────────────────────────────────────────────────┘
```

### 3.1 Components

| Layer | Component | Path | Purpose |
|---|---|---|---|
| Frontend | Side Panel | `frontend/components/ai/SidePanel.tsx` | Persistent collapsible chat dock |
| Frontend | ⌘K Launcher | `frontend/components/ai/CommandK.tsx` | Floating modal, ⌘K hotkey, mobile floating button |
| Frontend | Inline `/ai` | extends `BlockEditor.tsx` with BlockNote `xl-ai` extension | Block-level streaming inside notes |
| Frontend | Thread history | `frontend/components/ai/ThreadHistory.tsx` | List/pin/rename/delete past threads |
| Frontend | Markdown renderer | `frontend/lib/markdown/render.tsx` | `react-markdown` + GFM + KaTeX + Prism + custom fence handlers |
| Frontend | Mode toggle | `frontend/components/ai/ModeToggle.tsx` | Status-bar pill: 📱 Local / ☁️ API |
| Backend | Agent Engine | `backend/services/agent/engine.py` | Loop, skill activation, tool dispatch, SSE emission |
| Backend | Skill Loader | `backend/services/agent/skills.py` | Scan two dirs, parse frontmatter, name-based selection |
| Backend | Tool Router | `backend/services/agent/tools.py` | Single dispatch surface for brain tools + MCP tools |
| Backend | MCP Client | `backend/services/agent/mcp_client.py` | Connects to user-configured external MCP servers |
| Backend | Model Router | `backend/services/agent/model.py` | Two modes (Local/API); per-request override available |
| Backend | Permission gate | `backend/services/agent/permissions.py` | Enforces D6 tiers before any tool call |

### 3.2 Surfaces (D1)

**Side panel.** A right-docked column, ~360px on desktop, collapsible to an icon strip. Shows the current thread's messages, the input box, and the model-mode pill. A "history" tab swaps the messages view for the past-threads list.

**⌘K launcher.** Pressed anywhere in the app, a modal floats over the page with a single input. On submit, the modal expands into a full chat view (still floating). Pressing Esc collapses but does NOT lose the thread — it becomes the currently-active thread. Mobile: floating action button bottom-right.

**Inline `/ai`.** Typing `/ai` in any block opens a one-line prompt input where the slash command was. Submitting streams the answer **into the note** as new blocks via BlockNote's `xl-ai` extension. The action is **one-shot** — it doesn't append to the currently-active thread. Right-click on the result block → "Open in chat" creates a new thread seeded with the action.

Selection-based action: highlight text + ⌘J → small popover with prompt input. "Rewrite", "Explain", "Continue", "Make a table" are quick-action buttons.

### 3.3 Agent Engine (D2, D7)

Per request, the engine:

1. **Receives**: `{thread_id, messages, surface, current_note_id?, user_id, mode}`.
2. **Loads minimal context**: thread history (last N messages), skill index (names + descriptions only — bodies not loaded yet), retrieved knowledge chunks from `match_chunks` RPC.
3. **Activates skills**: one fast classification call (small model or local) returns the skill names whose descriptions match the request. Their bodies are loaded into the system prompt.
4. **Constructs system prompt**:
   - Base persona ("You are the Second Brain assistant. You can call tools.")
   - Skill bodies (concatenated, capped at ~6K tokens)
   - `<knowledge_context>` XML (top-K retrieved chunks)
   - Tool schemas (filtered by permission tier)
5. **Streams the agent loop**:
   - Stream tokens out via SSE as `{type: "text", content: "…"}` chunks.
   - When the model emits a tool call: pause text stream, emit `{type: "tool_call", tool, args}` (rendered as "🔍 Searching brain for …"), execute the tool, emit `{type: "tool_result", summary}`, resume generation.
   - Skill activation emits `{type: "skill_active", name}` before generation starts.
   - End-of-stream: `{type: "done", thread_id, message_id}`.

The loop has a hard cap (max 10 tool calls per turn) and a per-turn token budget enforced server-side.

### 3.4 Skills (D3)

**File location:**
- `backend/skills/` — bundled defaults shipped with the app (version-controlled). The Agent Engine (backend) loads them at startup. Examples below.
- `~/.secondbrain/skills/` — user-created. Never committed. User folder overrides bundled when names collide. Watched for changes so edits take effect without restart.

**File shape:**

```markdown
---
name: exam-prep-coach
description: Use when the user is reviewing for an exam, preparing for a test, or asking to be quizzed. Prioritizes active recall, formula drills, and sample questions over passive explanation.
tools: [search_brain, get_note, create_note]   # optional whitelist; default = all permitted by tier
priority: 5                                    # tiebreak when multiple skills match
---

When invoked, prefer the Socratic method: ask the user one question at a time,
wait for their answer, then correct or expand. Cite the user's own notes when
possible — they will recognize their own language.

Output format:
- Each question in a **bold** line, prefixed with "Q:".
- Wrong answers: explain WHY in one sentence, then immediately offer a related
  drill question.
- After 5 correct answers in a row, suggest moving to the next concept.
```

**Bundled skills (Phase 1+2):**

| Skill | When to use | What it does |
|---|---|---|
| `note-author` | When AI writes into a note (ingest, inline `/ai`, "save to note") | Formatting rules for mastery-guide-style notes — H2 importance scale, callout colors, deep-dive toggles. Mirrors `prompts/mastery_guide.py`. |
| `interactive-block-author` | Generating a `:::interactive` HTML block | Vanilla-JS-only constraints, sandbox rules, visual polish, ~300px height target. Mirrors `/api/interactive/generate`. |
| `cite-everything` | Every answer that uses retrieved context | Forces `[Note Title](deep_link)` citations, max 1 per claim, never invent IDs |
| `exam-prep-coach` | Active recall / quizzing mode | Socratic method, drill loops, formula focus |
| `socratic-questioning` | "Help me think through X" requests | One question at a time, build to insight |
| `mastery-tracker` | After teaching a concept | Suggests setting mastery on related notes, surfaces "learning" notes the user might revisit |

**Activation:** the engine sees only name+description of all skills. A classifier picks up to N (default 3) matching skills. Their bodies are loaded into the system prompt for that turn only.

### 3.5 Tools (D2, D6, D10)

Tools are namespaced (`brain.*`, `editor.*`, `mcp.<server>.*`) and gated by permission tier.

**Brain tools** (shared with external MCP):

| Tool | Args | Read/Write | External MCP | Internal API | Internal Local |
|---|---|---|---|---|---|
| `brain.search_brain` | `query, limit?` | R | ✓ | ✓ (chunks only) | ✓ |
| `brain.get_note` | `id` | R | ✓ (deny if `local_only`) | ✓ (deny if `local_only`) | ✓ |
| `brain.list_notes` | `collection_id?, mastery?` | R | ✓ (exclude `local_only`) | ✓ (exclude `local_only`) | ✓ |
| `brain.get_backlinks` | `note_id` | R | ✓ | ✓ | ✓ |
| `brain.create_note` | `title, blocks, collection_id?` | W | ✗ | ✓ | ✓ |
| `brain.update_note` | `id, blocks` | W | ✗ | ✓ (deny if `local_only`) | ✓ |
| `brain.patch_note` | `id, ops` | W | ✗ | ✓ (deny if `local_only`) | ✓ |
| `brain.link_notes` | `from_id, to_id, type` | W | ✗ | ✓ | ✓ |
| `brain.set_mastery` | `id, status` | W | ✗ | ✓ | ✓ |
| `brain.move_note` | `id, collection_id` | W | ✗ | ✓ | ✓ |
| `brain.delete_note` | `id` | W | ✗ | ✓ (confirm flag required) | ✓ (confirm flag required) |

**Editor tools** (used only by inline `/ai`):

| Tool | Args | Notes |
|---|---|---|
| `editor.insert_block` | `after_block_id, block` | Adds a block after the given id |
| `editor.replace_block` | `block_id, block` | Replaces in place |
| `editor.delete_block` | `block_id` | Removes a block |
| `editor.generate_interactive` | `spec, target_block_id?` | Produces a streamed interactive HTML block, replaces or inserts |

**External MCP tools** — discovered at runtime from each connected server. Namespaced as `mcp.<server-name>.<tool>`. Permission tier always elevates the *connection* — the user explicitly trusts each MCP server in settings — but the per-tool permission still applies.

**`local_only` flag** lives in `notes.local_only BOOLEAN NOT NULL DEFAULT FALSE`. Toggled in the note properties panel. The permission gate enforces it.

### 3.6 Model router (D5)

Two modes, exposed in the UI as a status-bar pill the user clicks to toggle:

- **📱 Local** — all calls go to `litert_url` (tablet, port 8082) or `llamacpp_url` (laptop, port 8080) per existing SmartRouter fallback.
- **☁️ API** — all calls go to the user's configured cloud provider. User chooses provider in Settings (OpenRouter / Anthropic / OpenAI / Google) and supplies their own API key.

The toggle is **global per user**, but **conversations remember which mode they were created in** (for the audit log). Switching mid-conversation is allowed; a system-level event is inserted into the thread: `Mode switched to ☁️ API`.

**No automatic routing.** SmartRouter's fallback (tablet → cloud when offline) remains as a *failure recovery* mechanism, not a primary strategy. If Local is selected but the tablet is unreachable, the user sees an error toast offering "Switch to API?" with a one-click action.

### 3.7 Permission tiers (D6) — enforcement

Implemented in `backend/services/agent/permissions.py`. Every tool call passes through `check(tool, tier, args, user)` before execution. Denials return `{type: "tool_denied", reason}` in the SSE stream, visible to the user.

**External MCP** tier is determined by the calling MCP transport. The existing `backend/mcp_server.py` and `backend/routers/internal.py` are updated to declare tier="external" on all calls.

**Internal API** tier is determined by the active model mode at request time.

**Internal Local** tier is determined by the active model mode at request time.

### 3.8 Streaming (D7) — wire format

All AI responses use SSE with typed events:

```
data: {"type":"skill_active","name":"exam-prep-coach"}\n\n
data: {"type":"context","notes":[…]}\n\n
data: {"type":"tool_call","id":"call_1","tool":"brain.search_brain","args":{"query":"chain rule"}}\n\n
data: {"type":"tool_result","id":"call_1","summary":"4 notes matched"}\n\n
data: {"type":"text","content":"The chain rule "}\n\n
data: {"type":"text","content":"is "}\n\n
…
data: {"type":"done","thread_id":"…","message_id":"…"}\n\n
data: [DONE]\n\n
```

The chat renderer treats `tool_call`/`tool_result`/`skill_active` as inline italic lines styled like Claude's tool-use indicators. They're collapsible — click to see args/result detail.

The ingest flow uses the same SSE format with `editor.insert_block` tool calls so blocks appear in the note as they're emitted.

### 3.9 Conversation persistence (D8)

**Data model change** — rename `chat_sessions` → `chat_threads`, add fields:

```sql
ALTER TABLE chat_sessions RENAME TO chat_threads;
ALTER TABLE chat_threads ADD COLUMN title TEXT;            -- nullable, auto-generated
ALTER TABLE chat_threads ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_threads ADD COLUMN model_mode TEXT;       -- 'local' or 'api' at creation
ALTER TABLE chat_threads ADD COLUMN archived_at TIMESTAMPTZ;
-- existing: id, user_id, messages JSONB, context_note_ids, created_at, updated_at
```

**Title auto-generation**: after the first assistant message, a cheap LLM call generates a ≤6-word title from the user's first message. User can rename.

**Thread switcher**: in the side panel, a dropdown at the top lists recent threads (last 20 by `updated_at`). "View all" opens the full history tab.

**Inline `/ai`**: one-shot. Does NOT append to any thread. Right-click → "Open in chat" creates a new thread seeded with `{role: user, content: "<original prompt>"}` and `{role: assistant, content: "<the result>"}`.

### 3.10 Markdown rendering (D4) — chat side

`frontend/lib/markdown/render.tsx` exports `<Markdown>` that:

- Uses `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-prism-plus`.
- Registers a custom `remark` plugin handling fenced directives:
  - ` ```callout color=blue icon=📋 ` — renders as a `<Callout>` component matching note callout styles (same CSS as BlockNote callouts).
  - ` ```interactive title="…" ` — renders as an `<iframe sandbox="allow-scripts" srcDoc=…>` block, identical to the editor's interactive block. The interactive block component is **extracted to `frontend/components/interactive/InteractiveFrame.tsx`** and shared between chat and editor.
  - ` ```note-ref id=… ` — renders as a small inline note-card preview with the note's title, icon, and a deep link.
- During streaming, `<Markdown>` re-parses on every chunk, debounced at 50ms. Partial-fence detection prevents jank: if a code fence is unterminated, render it as a literal until it closes.

The hand-rolled parser in `MessageBubble.tsx` is **deleted**.

### 3.11 Inline `/ai` (D1, D4) — editor side

Wires BlockNote's `xl-ai` extension to our Agent Engine. The wire protocol is the BlockNote tool-call stream (`add_paragraph`, `update_block`, `delete_block`), produced by an `/api/ai/blocknote` route that:

1. Receives `{messages, toolDefinitions, document_html}` from BlockNote client.
2. Calls our Agent Engine with `surface="inline"`, which restricts tool calls to `editor.*` and the brain read tools.
3. Translates the Engine's `editor.insert_block` into BlockNote `add_paragraph` tool-call events.

The Agent Engine in `inline` mode loads the `note-author` skill automatically and skips skill-classification overhead.

---

## 4. Replacements (D10)

| Old | Replacement |
|---|---|
| `/brain/chat` page | Side panel (D1) — old route 301s to the side-panel-open homepage state |
| `frontend/components/chat/MessageBubble.tsx` markdown parser | `frontend/lib/markdown/render.tsx` |
| `/brain/ingest` page | Drag-drop anywhere in the app → triggers an `ingest` agent call. New blocks stream into a freshly-created note. URL paste = ⌘K with a special "summarize this URL" intent. |
| `frontend/app/api/interactive/generate/route.ts` | Agent Engine call with `interactive-block-author` skill, streaming |
| `backend/prompts/tutor.py` | `backend/skills/cite-everything.md` + `backend/services/agent/engine.py` base persona |
| `backend/prompts/mastery_guide.py` | `backend/skills/note-author.md` |
| `backend/routers/chat.py` | `backend/routers/agent.py` (new) |
| `chat_sessions` table | `chat_threads` (rename + new columns) |

---

## 5. Data model summary

```sql
-- D9: local-only privacy flag on notes
ALTER TABLE notes ADD COLUMN local_only BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX notes_local_only_idx ON notes(local_only) WHERE local_only = TRUE;

-- D8: rename chat_sessions and extend
ALTER TABLE chat_sessions RENAME TO chat_threads;
ALTER TABLE chat_threads ADD COLUMN title TEXT;
ALTER TABLE chat_threads ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_threads ADD COLUMN model_mode TEXT;
ALTER TABLE chat_threads ADD COLUMN archived_at TIMESTAMPTZ;

-- New: MCP server registry per user
CREATE TABLE mcp_servers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  transport   TEXT        NOT NULL CHECK (transport IN ('stdio','http','sse')),
  command     TEXT,                          -- for stdio
  url         TEXT,                          -- for http/sse
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  trust_level TEXT        NOT NULL DEFAULT 'read_only' CHECK (trust_level IN ('read_only','full')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration filename: supabase/migrations/009_ai_substrate.sql
```

Skills are filesystem-only; not in the database. Rationale: version-controlled defaults, user-editable in `~/.secondbrain/skills/`, no migration overhead, easy to share via Git.

---

## 6. Phasing

### Phase 1 — Substrate + new chat surface (≈2 weeks)

**Backend**
- `backend/services/agent/{engine,skills,tools,permissions,model,mcp_client}.py`
- `backend/routers/agent.py` — `POST /agent` (replaces `POST /chat`)
- Brain tools implemented as a service module callable by both the Engine and the existing MCP server
- Migration `009_ai_substrate.sql`
- Bundled skills: `cite-everything`, `note-author`, `interactive-block-author`

**Frontend**
- `frontend/lib/markdown/render.tsx` (replaces hand-rolled parser)
- `frontend/components/ai/Chat.tsx` — new full-screen chat view that **replaces `/brain/chat`**
- `frontend/components/ai/ThreadHistory.tsx`, `ModeToggle.tsx`, `LocalOnlyBadge.tsx`
- `frontend/components/interactive/InteractiveFrame.tsx` — shared with editor

**Android**
- WebView config validated to load new chat correctly
- Status-bar pill works on touch

**Done when**: a user can ask the new chat anything, see streaming tokens, tool-calls appearing inline ("🔍 Searching brain…"), skill activation indicators, and `local_only` notes are correctly excluded in API mode.

### Phase 2 — The three doors (≈2 weeks)

**Frontend**
- `SidePanel.tsx` — collapsible right dock, replaces the full-page chat. The Phase 1 chat route redirects to "open the side panel".
- `CommandK.tsx` — global ⌘K hotkey (and ⌘J for selection), modal launcher, mobile floating button.
- Inline `/ai` — BlockNote `xl-ai` extension wired to `POST /agent` with `surface="inline"`.
- Note properties panel gets the `local_only` toggle.

**Backend**
- `editor.*` tools for block-level operations
- `surface="inline"` mode: shorter system prompt, auto-loaded `note-author`, no chat history (one-shot)

**Android**
- Bottom sheet for side panel
- Floating action button for ⌘K
- Two-finger long-press = selection ⌘J equivalent

**Done when**: ⌘K works from any page, side panel collapses to icon strip, inline `/ai` streams blocks into the current note, selection + ⌘J rewrites highlighted text.

### Phase 3 — Agentic ingest + skills UI + MCP (≈2–3 weeks)

**Replacements**
- `/brain/ingest` page deleted. Drag-drop a PDF anywhere in the app → triggers `POST /agent` with `surface="ingest"` and the PDF as an attachment. The agent uses `extract_pdf` (new internal tool) + `note-author` skill + `editor.insert_block` to stream a new note.
- URL paste in ⌘K with auto-detection of "summarize this URL" intent.
- `/api/interactive/generate` route deleted. Interactive block panel in the editor sends prompts through the Agent Engine with the `interactive-block-author` skill.

**Configuration UI**
- `frontend/app/(brain)/brain/settings/skills/page.tsx` — list, view, edit user skills; cannot edit bundled ones (clone-to-customize button).
- `frontend/app/(brain)/brain/settings/mcp/page.tsx` — add/remove MCP servers, trust toggles, per-tool permission audit.

**MCP client**
- `backend/services/agent/mcp_client.py` — connects to user-configured servers, discovers tools, namespaces them, surfaces them to the tool router.
- Permission audit log persists every tool call with tier, args summary, result code.

**Android**
- Drag-drop from Files app → same ingest flow
- Skills directory accessed via the host laptop's backend (current Phase 4 model). Native Kotlin port of the skill loader is out of scope for this spec — tracked separately when the in-process Android agent is built.

**Done when**: every static AI flow is gone, skills are user-editable from the UI, and at least one external MCP server (web search) is demonstrably working.

---

## 7. Open risks

1. **Local model tool-use reliability.** Gemma 4 E2B is small and may fail at structured tool calls. Mitigations:
   - Strict JSON-schema validation; retry with corrective prompt up to 2 times before falling back to text mode.
   - Provide a "no tools" toggle per skill — some skills can opt out of tool-use entirely on Local mode.
   - Encourage cloud API mode for agent-heavy tasks; UI nudges when retries happen.
2. **BlockNote `xl-ai` + our agent loop.** `xl-ai` is built on the Vercel AI SDK and expects a `streamText`-shaped response. Our Engine needs an adapter route that translates internal SSE events into the AI SDK protocol. Risk: protocol drift. Mitigation: pin `@blocknote/xl-ai` and `ai` versions; small adapter module isolates the translation.
3. **License of `@blocknote/xl-ai`.** GPL-3.0. Confirm commercial path or build a custom block-streaming layer if needed. (Not in scope for the spec — decision documented.)
4. **Android in-process agent.** Phase 3 ships Skills via host-sync; for fully-offline Android with no laptop, a native Kotlin port of the Agent Engine is needed. Out of this spec; tracked separately.
5. **Conversation context cap.** Long threads + skill bodies + retrieved context could exceed Local model context. Hard cap at 16K tokens with a summarization step when exceeded; user-visible event when summarization happens.
6. **Stream multiplexing.** A single thread accessed via two doors simultaneously could race. Lock at the thread level; second writer gets a "thread busy" error.

---

## 8. Out of scope

- Knowledge graph view changes (Phase 5 web polish, separate plan)
- Native Kotlin port of the Agent Engine for fully-offline Android (separate plan after Phase 3)
- Voice input / speech-to-text
- Image inputs to the agent (vision)
- Multi-user collaboration on threads
- Fine-tuning custom models

---

## 9. Success criteria

A user can:

- Press ⌘K from anywhere, ask "what does the chain rule have to do with neural networks?", see "🧩 Loaded skill: cite-everything", watch tokens stream in, see `🔍 Searched brain → 3 notes`, get an answer that cites two of their own notes correctly, and the rendered markdown looks identical (callouts, code, tables) to the block editor.
- Drag a PDF onto the sidebar, watch a new note write itself block-by-block in real time, with section headers, callouts, and an interactive block at the end — all streaming, no full-document wait.
- Type `/ai give me a worked example` in any note block, watch a new block appear with the example, accept it.
- Mark a note "local-only" → switch to ☁️ API mode → ask about that note → the agent says "I don't have access to that note in this mode" and offers to switch to 📱 Local.
- Edit `~/.secondbrain/skills/my-style.md`, save, ask a question, see "🧩 Loaded skill: my-style" activate and the response respects the new rules.
- Connect a web-search MCP server in Settings, ask "what's the latest on [topic]" → agent uses both `brain.search_brain` and `mcp.websearch.search` and stitches the answer.

If all six work, the redesign is done.
