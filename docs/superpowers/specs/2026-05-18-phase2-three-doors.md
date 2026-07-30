# Phase 2 — The Three Doors

> Status: **Approved**
> Date: 2026-05-18
> Parent spec: `2026-05-17-ai-experience-redesign.md` (Phase 2 section)
> Builds on: AI Substrate Phase 1 (code complete, in working tree)

---

## 1. Scope

Phase 2 wires Phase 1's Agent Engine to three user-facing surfaces:

| Surface | Hotkey | Notes |
|---|---|---|
| **SidePanel** | icon button top-right | Persistent right-edge overlay |
| **CommandK** | ⌘K | Floating launcher → expands to full chat |
| **Inline `/ai`** | `/ai` in BlockNote | One-shot; streams blocks into note |

Also: move notes search from ⌘K → ⌘P. Android WebView validation (no native UI changes).

**Build order:** SidePanel → CommandK → Inline `/ai`

**Out of scope:** native Android Kotlin UI (WebView validation only), agentic ingest replacement (Phase 3), MCP client (Phase 3).

---

## 2. Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | AI panel layout | Right-edge overlay (not a third column) | Avoids editor layout issues; note remains visible behind panel on desktop |
| D2 | ⌘K assignment | ⌘K = AI launcher, ⌘P = search | Move `SearchModal` binding; ⌘K is the AI-launcher convention |
| D3 | CommandK UX | Two-stage: compact input → expands on submit | Minimal footprint until needed; matches Spotlight/VS Code feel |
| D4 | xl-ai license | Use `@blocknote/xl-ai` (GPL-3.0 accepted) | Personal tool; revisit before commercializing |
| D5 | Android scope | WebView validation only | Phase 4 native app not started; inherits via WebView |

---

## 3. Architecture

```
BrainLayoutClient (updated)
├── left sidebar (unchanged)
├── main content
│   └── SearchModal (now ⌘P)
├── CommandK modal (new, ⌘K)
│   └── Chat (Phase 1, reused)
└── SidePanel overlay (new, right edge)
    └── Chat (Phase 1, reused)
```

The Phase 1 `Chat.tsx` component is **reused unchanged** inside both the SidePanel and the CommandK modal. No chat logic duplication.

---

## 4. SidePanel

**File:** `frontend/components/ai/SidePanel.tsx`

**Behavior:**
- Fixed overlay at the right edge; `z-40` (above content, below mobile sidebar backdrop)
- Width: 360px on desktop, full-screen on mobile (≤767px)
- Mobile: full-screen with backdrop (`bg-black/40`) + close on backdrop tap (same as left sidebar)
- Desktop: no backdrop; the note is at full width beneath the panel (overlay, not column)
- State: `aiOpen` boolean, persisted in `localStorage("ai-panel-open")`
- Toggle: icon button in the top-right of the app chrome (visible at all times)
- When collapsed: a floating icon button appears at the right edge (same pattern as left sidebar's reopen button)

**Integration:**
- Added to `BrainLayoutClient.tsx` alongside the existing left sidebar state
- `/brain/chat` route → `redirect("/brain?ai=open")`. `BrainLayoutClient` reads `?ai=open` on mount, sets `aiOpen=true`, strips the param from the URL

**Content:** renders `<Chat />` directly (Phase 1 component — has thread history, mode toggle, input box)

---

## 5. CommandK Launcher

**File:** `frontend/components/ai/CommandK.tsx`

**Trigger:** `⌘K` (or `Ctrl+K` on non-Mac) — replaces the existing ⌘K binding in `BrainLayoutClient`. Mobile: FAB (bottom-right, `z-50`, 56×56px).

**Stage 1 — compact:**
- Centered modal, ~480px wide, ~72px tall
- Single text input with placeholder "Ask anything…"
- Esc closes; Enter submits and transitions to Stage 2

**Stage 2 — expanded:**
- Same modal grows to ~480px wide × 600px tall (or 80vh on small screens)
- Renders `<Chat />` in this expanded container
- Esc collapses back to Stage 1 (active thread is NOT cleared — it persists as the currently-active thread)
- Second Esc (from Stage 1) closes entirely

**Thread continuity:** CommandK and SidePanel share the same currently-active thread. Opening SidePanel after using ⌘K shows the same conversation and vice versa.

**Mobile FAB:**
- Floating action button: `fixed bottom-6 right-6 z-50`
- Opens a full-screen modal (same `<Chat />` wrapper, height = 100dvh)

**Search migration:** `BrainLayoutClient` moves `SearchModal` from ⌘K to ⌘P.

---

## 6. Inline `/ai`

### 6.1 Frontend — BlockNote xl-ai extension

**Trigger:** typing `/ai` in any block → one-line prompt input. Submitting streams new blocks into the note.

**Selection ⌘J:** highlight text → popover with quick actions (Rewrite, Explain, Continue, Make a table). Handled natively by `xl-ai`.

**Wire-up:**
- Install `@blocknote/xl-ai` + Vercel `ai` SDK
- In `BlockEditor.tsx`, add the xl-ai extension configured to call `/api/ai/blocknote`
- `/api/ai/blocknote` is a new Next.js route at `frontend/app/api/ai/blocknote/route.ts`

### 6.2 `/api/ai/blocknote` route

Receives BlockNote's AI SDK request `{messages, toolDefinitions, document_html}`. The note ID is passed as a custom HTTP header `X-Note-Id` set in the xl-ai `fetchOptions` when the extension is configured in `BlockEditor.tsx`. Calls the backend `POST /agent` with:

```json
{
  "surface": "inline",
  "messages": [...],
  "current_note_id": "<from headers or body>"
}
```

Translates the Agent Engine's SSE events into the Vercel AI SDK's streaming protocol (`streamText`-shaped). Specifically:
- Agent `{type:"text", content}` → AI SDK text deltas
- Agent `{type:"tool_call", tool:"editor.insert_block", ...}` → AI SDK tool-call events mapped to BlockNote's `add_paragraph` / `update_block` / `delete_block`

**Isolation:** the translation is entirely in this one route file. Neither the Agent Engine nor BlockNote need to know about each other's protocol.

### 6.3 Backend — `surface="inline"` mode

`POST /agent` gains a `surface: Literal["chat", "inline"] = "chat"` field.

When `surface="inline"`:
- Skip thread persistence (no `thread_id` required or returned)
- Auto-load `note-author` skill (skip classification overhead)
- Restrict available tools to `editor.*` + brain read-only tools (`brain.search_brain`, `brain.get_note`, `brain.list_notes`, `brain.get_backlinks`)
- Use a shorter base system prompt (no history context)

### 6.4 Backend — `editor.*` tools

Added to `backend/services/agent/brain_tools.py`:

| Tool | Args | What it does |
|---|---|---|
| `editor.insert_block` | `after_block_id, block` | Appended via SSE; BlockNote inserts it |
| `editor.replace_block` | `block_id, block` | Replaces block in place |
| `editor.delete_block` | `block_id` | Removes block |
| `editor.generate_interactive` | `spec, target_block_id?` | Streams an interactive HTML block |

These tools emit SSE events that the `/api/ai/blocknote` route translates. They do not hit the database directly — all mutations happen client-side via BlockNote.

---

## 7. Shared thread state

SidePanel and CommandK use the same currently-active thread. A `useAIThread` context (new) manages:

```ts
{
  activeThreadId: string | null
  setActiveThreadId: (id: string) => void
}
```

Provided at `BrainLayoutClient` level. Both `SidePanel` and `CommandK` read/write via this context. `Chat.tsx` already accepts `threadId` as a prop (or `null` for new thread).

---

## 8. File list

### New files
| File | Purpose |
|---|---|
| `frontend/components/ai/SidePanel.tsx` | Right-edge overlay shell |
| `frontend/components/ai/CommandK.tsx` | ⌘K floating launcher |
| `frontend/context/AIThreadContext.tsx` | Shared active-thread state |
| `frontend/app/api/ai/blocknote/route.ts` | xl-ai ↔ Agent Engine bridge |

### Modified files
| File | Change |
|---|---|
| `frontend/components/sidebar/BrainLayoutClient.tsx` | Add SidePanel + CommandK; move search to ⌘P; read `?ai=open` |
| `frontend/app/(brain)/brain/chat/page.tsx` | Replace with `redirect("/brain?ai=open")` |
| `frontend/components/editor/BlockEditor.tsx` | Wire xl-ai extension |
| `backend/services/agent/brain_tools.py` | Add `editor.*` tools |
| `backend/services/agent/engine.py` | Handle `surface` field; inline mode logic |
| `backend/routers/agent.py` | Expose `surface` in request model |
| `backend/models/agent.py` | Add `surface` to `AgentRequest` |

### Package additions
```bash
# frontend
npm install @blocknote/xl-ai ai
```

---

## 9. Routing changes

| Old | New |
|---|---|
| `/brain/chat` | `redirect("/brain?ai=open")` — opens the SidePanel |
| ⌘K → SearchModal | ⌘K → CommandK AI launcher |
| — | ⌘P → SearchModal (moved) |

---

## 10. Done criteria

Phase 2 is complete when:

1. Clicking the AI icon (or navigating to `/brain/chat`) opens the right-edge SidePanel with a working chat (Phase 1 streaming, tool events, skill badges)
2. ⌘K from any page opens the compact launcher → expands on submit → Esc collapses without losing the thread
3. ⌘P opens the notes search modal
4. Typing `/ai` in any note block streams new blocks into the note in real time
5. Selecting text + ⌘J opens the xl-ai popover with Rewrite/Explain/Continue working
6. The SidePanel and ⌘K chat share the same thread (one continues the other's conversation)
7. The Android WebView correctly renders the SidePanel and ⌘K modal over LAN
