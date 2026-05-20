# Phase 2 — The Three Doors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Phase 1's Agent Engine to three user-facing surfaces — a right-edge SidePanel, a ⌘K floating launcher, and inline `/ai` in the BlockNote editor — and migrate notes search from ⌘K to ⌘P.

**Architecture:** `BrainLayoutClient` gains a SidePanel overlay and CommandK component sharing a `AIThreadContext` (shared active-thread state). The Phase 1 `Chat` component is reused inside both surfaces. Inline `/ai` uses the already-imported `@blocknote/xl-ai` `AIExtension`, configured with `ClientSideTransport` pointing at a new `/api/ai/blocknote` Next.js auth-proxy route; the backend exposes a new `/agent/inline` OpenAI-compatible streaming endpoint that injects the `note-author` skill.

**Tech Stack:** Next.js 16, React 19, BlockNote 0.48.0, `@blocknote/xl-ai` 0.48.0, `@ai-sdk/openai` (new), FastAPI, Python 3.11, httpx, pytest.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `frontend/context/AIThreadContext.tsx` | Shared active-thread state (provider + hook) |
| `frontend/components/ai/SidePanel.tsx` | Right-edge AI panel overlay shell |
| `frontend/components/ai/CommandK.tsx` | ⌘K two-stage floating launcher + mobile FAB |
| `frontend/app/api/ai/blocknote/route.ts` | Auth proxy: xl-ai → backend `/agent/inline` |
| `backend/routers/agent_inline.py` | OpenAI-compatible inline completions endpoint |
| `backend/tests/test_agent_inline.py` | Unit tests for inline endpoint |
| `frontend/e2e/phase2-sidepanel.spec.ts` | E2E: side panel open/close, shared thread |
| `frontend/e2e/phase2-commandk.spec.ts` | E2E: ⌘K two-stage, ⌘P search |

### Modified files
| File | Change |
|---|---|
| `frontend/components/ai/Chat.tsx` | Accept controlled `threadId` + `onThreadIdChange` props |
| `frontend/components/sidebar/BrainLayoutClient.tsx` | Add SidePanel + CommandK; bind ⌘K→CommandK, ⌘P→search; read `?ai=open` |
| `frontend/app/(brain)/brain/chat/page.tsx` | Redirect to `/?ai=open` |
| `frontend/components/editor/BlockEditor.tsx` | Configure `AIExtension` with `ClientSideTransport` + `AIMenuController` |
| `backend/main.py` | Register `agent_inline` router |

---

## Task 1 — Create `AIThreadContext`

**Files:**
- Create: `frontend/context/AIThreadContext.tsx`

- [ ] **Step 1: Write the file**

```tsx
// frontend/context/AIThreadContext.tsx
"use client";

import { createContext, useContext, useState } from "react";

interface AIThreadContextValue {
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
}

const AIThreadContext = createContext<AIThreadContextValue>({
  activeThreadId: null,
  setActiveThreadId: () => {},
});

export function AIThreadProvider({ children }: { children: React.ReactNode }) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  return (
    <AIThreadContext.Provider value={{ activeThreadId, setActiveThreadId }}>
      {children}
    </AIThreadContext.Provider>
  );
}

export function useAIThread() {
  return useContext(AIThreadContext);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/ayoub/projects/second_brain/frontend
npx tsc --noEmit 2>&1 | grep -i "AIThreadContext\|error" | head -20
```
Expected: no errors mentioning `AIThreadContext.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/context/AIThreadContext.tsx
git commit -m "feat: add AIThreadContext for shared panel/launcher thread state"
```

---

## Task 2 — Refactor `Chat.tsx` to accept controlled thread props

**Files:**
- Modify: `frontend/components/ai/Chat.tsx`

The current `Chat.tsx` manages `threadId` in local state. SidePanel and CommandK must share the same thread via context. We add optional controlled props; when absent, the component falls back to its current internal state.

- [ ] **Step 1: Read current Chat.tsx signature**

Confirm the current props interface at the top of the file — it accepts no props today. Verify `threadId` and `setThreadId` are internal state.

- [ ] **Step 2: Add controlled thread props**

Replace the component definition line and add prop types. At the top of `Chat.tsx`, after the imports, add:

```tsx
interface ChatProps {
  /** Controlled active thread. Pass null to start a fresh thread. */
  threadId?: string | null;
  /** Called when a new thread is created from inside Chat. */
  onThreadIdChange?: (id: string) => void;
}
```

Replace:
```tsx
export function Chat() {
  ...
  const [threadId, setThreadId] = useState<string | null>(null);
```
with:
```tsx
export function Chat({ threadId: controlledThreadId, onThreadIdChange }: ChatProps = {}) {
  const [internalThreadId, setInternalThreadId] = useState<string | null>(null);
  const threadId = controlledThreadId !== undefined ? controlledThreadId : internalThreadId;
  function setThreadId(id: string | null) {
    setInternalThreadId(id);
    if (id) onThreadIdChange?.(id);
  }
```

- [ ] **Step 3: Update the `done` SSE event handler**

Find the existing `ev.type === "done"` branch inside `send()`:
```tsx
} else if (ev.type === "done") {
  if (ev.thread_id && !threadId) setThreadId(ev.thread_id as string);
}
```

Change to:
```tsx
} else if (ev.type === "done") {
  if (ev.thread_id) setThreadId(ev.thread_id as string);
}
```

This ensures the thread ID is always propagated outward via `onThreadIdChange`.

- [ ] **Step 4: Type-check**

```bash
cd /home/ayoub/projects/second_brain/frontend
npx tsc --noEmit 2>&1 | grep "Chat.tsx\|error" | head -20
```
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ai/Chat.tsx
git commit -m "feat: Chat accepts controlled threadId + onThreadIdChange props"
```

---

## Task 3 — Create `SidePanel.tsx`

**Files:**
- Create: `frontend/components/ai/SidePanel.tsx`

The panel is a fixed overlay on the right edge. On desktop: 360px wide, no backdrop. On mobile: full-screen with black/40 backdrop. Both use `z-40` (above content, below the notes sidebar's `z-30`... wait: notes sidebar is `z-30` and the panel should be on top of content but below the sidebar backdrop at `z-20`. Use `z-30` for desktop, full-screen `z-40` for mobile).

**z-index ordering (existing):**
- Mobile backdrop: `z-20`
- Notes sidebar: `z-30`
- SidePanel: `z-40` (above notes sidebar on mobile when AI panel is open)
- CommandK FAB: `z-50`

- [ ] **Step 1: Write `SidePanel.tsx`**

```tsx
// frontend/components/ai/SidePanel.tsx
"use client";

import { Bot, X } from "lucide-react";
import { Chat } from "./Chat";
import { useAIThread } from "@/context/AIThreadContext";

interface SidePanelProps {
  open: boolean;
  onToggle: () => void;
}

export function SidePanel({ open, onToggle }: SidePanelProps) {
  const { activeThreadId, setActiveThreadId } = useAIThread();

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={onToggle}
          aria-hidden
        />
      )}

      {/* Panel */}
      <div
        className={[
          "fixed inset-y-0 right-0 z-40 flex flex-col",
          "bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800",
          "transition-transform duration-200 ease-in-out",
          "w-full md:w-[360px]",
          open ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
        aria-label="AI assistant panel"
        role="complementary"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-indigo-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">AI Assistant</span>
          </div>
          <button
            onClick={onToggle}
            aria-label="Close AI panel"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Chat — mounts lazily so we don't incur its cost until opened */}
        {open && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <Chat
              threadId={activeThreadId}
              onThreadIdChange={setActiveThreadId}
            />
          </div>
        )}
      </div>
    </>
  );
}

/** Floating reopen button shown when panel is collapsed */
export function SidePanelToggleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open AI panel"
      className="fixed top-3 right-3 z-30 hidden md:flex items-center justify-center w-8 h-8 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-gray-700 shadow-sm transition-colors"
    >
      <Bot size={16} />
    </button>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/ayoub/projects/second_brain/frontend
npx tsc --noEmit 2>&1 | grep "SidePanel\|error" | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ai/SidePanel.tsx
git commit -m "feat: SidePanel — right-edge AI overlay with mobile backdrop"
```

---

## Task 4 — Wire SidePanel + migrate ⌘K→⌘P into `BrainLayoutClient`

**Files:**
- Modify: `frontend/components/sidebar/BrainLayoutClient.tsx`

This is the most impactful change to existing code. Read the current file before editing.

- [ ] **Step 1: Read the current file**

```bash
cat /home/ayoub/projects/second_brain/frontend/components/sidebar/BrainLayoutClient.tsx
```

- [ ] **Step 2: Rewrite `BrainLayoutClient.tsx`**

Replace the entire file with the version below. Key changes vs current:
- Wrap with `AIThreadProvider`
- Add `aiOpen` state (persisted to `localStorage("ai-panel-open")`)
- ⌘K now opens the side panel (not search)
- ⌘P opens search
- On mount read `?ai=open` URL param → open panel, strip param
- Add `SidePanel` and `SidePanelToggleButton`

```tsx
// frontend/components/sidebar/BrainLayoutClient.tsx
"use client";

import { useState, useEffect } from "react";
import { Menu, PanelLeftOpen } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { SearchModal } from "@/components/search/SearchModal";
import { SidePanel, SidePanelToggleButton } from "@/components/ai/SidePanel";
import { AIThreadProvider } from "@/context/AIThreadContext";

export function BrainLayoutClient({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [aiOpen, setAiOpen] = useState<boolean | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-open");
    setOpen(stored !== null ? stored === "true" : window.innerWidth >= 768);

    const aiStored = localStorage.getItem("ai-panel-open");
    let aiInitial = aiStored !== null ? aiStored === "true" : false;

    // ?ai=open in URL → auto-open AI panel and strip the param
    const params = new URLSearchParams(window.location.search);
    if (params.get("ai") === "open") {
      aiInitial = true;
      params.delete("ai");
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname;
      window.history.replaceState(null, "", newUrl);
    }
    setAiOpen(aiInitial);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") {
        e.preventDefault();
        toggleAi();
      }
      if (mod && e.key === "p") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });  // no deps — toggleAi closure must stay fresh

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-open", String(next));
      return next;
    });
  }

  function toggleAi() {
    setAiOpen((prev) => {
      const next = !prev;
      localStorage.setItem("ai-panel-open", String(next));
      return next;
    });
  }

  const isOpen = open ?? true;
  const isAiOpen = aiOpen ?? false;

  return (
    <AIThreadProvider>
      <div className="print-layout flex h-screen overflow-hidden bg-white dark:bg-gray-900">

        {/* Mobile backdrop for notes sidebar */}
        {isOpen && (
          <div
            className="no-print fixed inset-0 z-20 bg-black/40 md:hidden"
            onClick={toggle}
          />
        )}

        {/* Notes sidebar */}
        <div
          className={[
            "no-print transition-all duration-200 ease-in-out flex-shrink-0",
            "fixed inset-y-0 left-0 z-30",
            "md:relative md:inset-auto md:z-auto",
            isOpen
              ? "translate-x-0 md:w-[260px]"
              : "-translate-x-full md:translate-x-0 md:w-0",
          ].join(" ")}
          style={{ overflow: isOpen ? "visible" : "hidden" }}
        >
          <Sidebar onToggle={toggle} onSearchOpen={() => setSearchOpen(true)} />
        </div>

        {/* Desktop: floating reopen button for notes sidebar */}
        {!isOpen && (
          <button
            onClick={toggle}
            aria-label="Open sidebar"
            className="no-print hidden md:flex fixed top-3 left-3 z-10 items-center justify-center w-8 h-8 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm transition-colors"
          >
            <PanelLeftOpen size={16} />
          </button>
        )}

        {/* Main area */}
        <main className="print-main flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile-only top bar */}
          <div className="no-print md:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
            <button
              onClick={toggle}
              aria-label="Open menu"
              className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Menu size={20} />
            </button>
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Second Brain</span>
          </div>

          {children}
        </main>

        {/* AI side panel */}
        <SidePanel open={isAiOpen} onToggle={toggleAi} />

        {/* Floating reopen button for AI panel (desktop, when closed) */}
        {!isAiOpen && <SidePanelToggleButton onClick={toggleAi} />}

        <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      </div>
    </AIThreadProvider>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd /home/ayoub/projects/second_brain/frontend
npx tsc --noEmit 2>&1 | grep "BrainLayoutClient\|SidePanel\|error" | head -20
```
Expected: no errors.

- [ ] **Step 4: Start dev server and manually verify**

```bash
cd /home/ayoub/projects/second_brain/frontend
npm run dev
```

Open `http://localhost:3000/brain`. Verify:
- AI panel toggle button appears top-right
- Clicking it opens the panel from the right
- Panel closes on X button or mobile backdrop tap
- ⌘P (or Ctrl+P) opens search modal
- ⌘K (or Ctrl+K) toggles the AI panel
- Panel state persists across page reloads

- [ ] **Step 5: Commit**

```bash
git add frontend/components/sidebar/BrainLayoutClient.tsx
git commit -m "feat: wire SidePanel into BrainLayoutClient; ⌘K→AI, ⌘P→search"
```

---

## Task 5 — Redirect `/brain/chat` to `?ai=open`

**Files:**
- Modify: `frontend/app/(brain)/brain/chat/page.tsx`

- [ ] **Step 1: Replace the chat page with a redirect**

```tsx
// frontend/app/(brain)/brain/chat/page.tsx
import { redirect } from "next/navigation";

export default function ChatPage() {
  redirect("/brain?ai=open");
}
```

- [ ] **Step 2: Verify the redirect works**

With the dev server running, navigate to `http://localhost:3000/brain/chat`. Verify it redirects to `/brain` with the AI panel open.

- [ ] **Step 3: Commit**

```bash
git add "frontend/app/(brain)/brain/chat/page.tsx"
git commit -m "feat: redirect /brain/chat → /brain?ai=open (side panel)"
```

---

## Task 6 — Create `CommandK.tsx` (two-stage launcher + mobile FAB)

**Files:**
- Create: `frontend/components/ai/CommandK.tsx`

The component has two stages:
- **Stage 1** (`mode = "compact"`): centered modal, ~480px wide, single text input.
- **Stage 2** (`mode = "expanded"`): same modal grows to 480×600px, renders `<Chat />`.

Esc in Stage 2 → Stage 1. Esc in Stage 1 → closed. Thread is NOT cleared on Esc.

The mobile FAB (Bot icon, bottom-right) toggles between closed and expanded full-screen.

- [ ] **Step 1: Write `CommandK.tsx`**

```tsx
// frontend/components/ai/CommandK.tsx
"use client";

import { useRef, useState } from "react";
import { Bot, ArrowRight } from "lucide-react";
import { Chat } from "./Chat";
import { useAIThread } from "@/context/AIThreadContext";

type Stage = "closed" | "compact" | "expanded";

interface CommandKProps {
  open: Stage;
  onOpen: (stage: Stage) => void;
}

export function CommandK({ open, onOpen }: CommandKProps) {
  const { activeThreadId, setActiveThreadId } = useAIThread();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // When compact stage becomes visible, focus the input
  function handleBackdropClick() {
    if (open === "compact") onOpen("closed");
  }

  function handleCompactSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    // Transition to expanded — Chat will pick up the query from shared thread
    onOpen("expanded");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (open === "expanded") onOpen("compact");
      else if (open === "compact") onOpen("closed");
    }
  }

  if (open === "closed") return null;

  const isMobileFullScreen = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={handleBackdropClick}
        aria-hidden
      />

      {/* Modal */}
      <div
        className={[
          "fixed z-50 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-900",
          "border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl",
          "flex flex-col overflow-hidden",
          "transition-all duration-200 ease-out",
          isMobileFullScreen
            ? "inset-x-0 inset-y-0 rounded-none border-0"
            : open === "expanded"
              ? "top-[10vh] w-[480px] h-[600px]"
              : "top-1/3 w-[480px]",
        ].join(" ")}
        role="dialog"
        aria-label="AI assistant"
        onKeyDown={handleKeyDown}
      >
        {open === "compact" && (
          <form onSubmit={handleCompactSubmit} className="flex items-center gap-3 px-4 py-4">
            <Bot size={18} className="text-indigo-500 shrink-0" />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything…"
              className="flex-1 text-sm bg-transparent outline-none placeholder-gray-400 text-gray-900 dark:text-gray-100"
              aria-label="AI query"
            />
            <button
              type="submit"
              disabled={!query.trim()}
              className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-500 transition-colors"
              aria-label="Send"
            >
              <ArrowRight size={14} />
            </button>
          </form>
        )}

        {open === "expanded" && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <Chat
              threadId={activeThreadId}
              onThreadIdChange={setActiveThreadId}
              initialQuery={query || undefined}
            />
          </div>
        )}
      </div>
    </>
  );
}

/** Mobile floating action button — shown when CommandK is closed */
export function CommandKFAB({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open AI"
      className="md:hidden fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-indigo-600 text-white shadow-lg flex items-center justify-center hover:bg-indigo-500 active:scale-95 transition-all"
    >
      <Bot size={24} />
    </button>
  );
}
```

- [ ] **Step 2: Add `initialQuery` prop to `Chat.tsx`**

`CommandK` passes the compact-stage query to Chat so it auto-sends on expand. Open `frontend/components/ai/Chat.tsx` and add `initialQuery` to `ChatProps`:

```tsx
interface ChatProps {
  threadId?: string | null;
  onThreadIdChange?: (id: string) => void;
  /** If provided and no existing thread, auto-sends this message on mount. */
  initialQuery?: string;
}
```

Inside `Chat`, after the `useEffect` that loads thread history, add:

```tsx
// Auto-send initialQuery if provided (CommandK expand flow)
const didAutoSend = useRef(false);
useEffect(() => {
  if (initialQuery && !threadId && !didAutoSend.current) {
    didAutoSend.current = true;
    setInput(initialQuery);
    // Short delay so the component finishes rendering before sending
    setTimeout(() => send(), 50);
  }
}, [initialQuery]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Type-check**

```bash
cd /home/ayoub/projects/second_brain/frontend
npx tsc --noEmit 2>&1 | grep "CommandK\|Chat\|error" | head -20
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ai/CommandK.tsx frontend/components/ai/Chat.tsx
git commit -m "feat: CommandK two-stage launcher + mobile FAB; Chat initialQuery prop"
```

---

## Task 7 — Wire `CommandK` into `BrainLayoutClient`

**Files:**
- Modify: `frontend/components/sidebar/BrainLayoutClient.tsx`

- [ ] **Step 1: Add CommandK state and imports**

At the top of `BrainLayoutClient.tsx`, add the import:
```tsx
import { CommandK, CommandKFAB } from "@/components/ai/CommandK";
```

Add `commandKStage` state inside the component:
```tsx
const [commandKStage, setCommandKStage] = useState<"closed" | "compact" | "expanded">("closed");
```

- [ ] **Step 2: Update ⌘K keyboard handler**

Change the ⌘K branch from `toggleAi()` to open CommandK in compact mode:
```tsx
if (mod && e.key === "k") {
  e.preventDefault();
  setCommandKStage((s) => s === "closed" ? "compact" : "closed");
}
```

- [ ] **Step 3: Render CommandK and FAB inside the layout**

Inside `<AIThreadProvider>` JSX, before `<SearchModal>`, add:
```tsx
<CommandK open={commandKStage} onOpen={setCommandKStage} />
{commandKStage === "closed" && <CommandKFAB onClick={() => setCommandKStage("compact")} />}
```

- [ ] **Step 4: Type-check + manual test**

```bash
cd /home/ayoub/projects/second_brain/frontend
npx tsc --noEmit 2>&1 | grep "error" | head -10
```

With dev server running, verify:
- ⌘K opens compact modal (single input)
- Enter in compact → expanded with Chat (sends the query)
- Esc in expanded → back to compact (thread preserved)
- Esc in compact → closed
- On mobile (resize to < 768px), FAB appears and opens full-screen modal
- SidePanel and CommandK show the SAME thread (switch between them)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/sidebar/BrainLayoutClient.tsx
git commit -m "feat: wire CommandK into BrainLayoutClient; ⌘K opens launcher"
```

---

## Task 8 — Backend: `/agent/inline` OpenAI-proxy endpoint

**Files:**
- Create: `backend/routers/agent_inline.py`
- Create: `backend/tests/test_agent_inline.py`
- Modify: `backend/main.py`

This endpoint accepts an OpenAI-format chat completions request (which is what `ClientSideTransport` sends via `createOpenAI`). It:
1. Injects the `note-author` skill into the system message
2. Forwards to the configured model (via model router)
3. Streams the model's response back unchanged

**Design note:** xl-ai's `ClientSideTransport` calls `streamText({model, messages, tools, ...})` via the AI SDK. This makes a POST to our proxy in OpenAI chat completions format: `{model, messages, tools, stream, ...}`. Our proxy adds the skill system message and forwards to the real model.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_agent_inline.py
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_inline_injects_skill_into_system():
    """Inline endpoint prepends the note-author skill body to system messages."""
    from routers.agent_inline import _build_inline_messages

    original_messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain recursion."},
    ]
    skill_body = "SKILL: always write in bullet points"

    result = _build_inline_messages(original_messages, skill_body)

    assert result[0]["role"] == "system"
    assert "SKILL: always write in bullet points" in result[0]["content"]
    assert result[-1]["role"] == "user"
    assert result[-1]["content"] == "Explain recursion."


@pytest.mark.asyncio
async def test_inline_adds_system_if_none():
    """If no system message exists, one is created with the skill body."""
    from routers.agent_inline import _build_inline_messages

    original_messages = [
        {"role": "user", "content": "Hello"},
    ]
    skill_body = "Formatting rules"

    result = _build_inline_messages(original_messages, skill_body)

    assert result[0]["role"] == "system"
    assert "Formatting rules" in result[0]["content"]
    assert len(result) == 2  # system + user
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/ayoub/projects/second_brain/backend
source .venv/bin/activate
pytest tests/test_agent_inline.py -v 2>&1 | tail -10
```
Expected: `ModuleNotFoundError` or `ImportError` — the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```python
# backend/routers/agent_inline.py
"""POST /agent/inline — OpenAI-compatible streaming proxy for inline /ai.

Receives an OpenAI chat-completions request from @blocknote/xl-ai's
ClientSideTransport, injects the note-author skill into the system message,
then proxies to the configured model endpoint and streams back the response.

No agent loop — xl-ai handles the tool loop client-side (add_paragraph etc.).
"""
from __future__ import annotations

from pathlib import Path

import httpx
from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse

from routers.ingest import get_user_id  # JWT helper
from services.agent.model import get_endpoint
from services.agent.skills import SkillRegistry
from models.agent import Mode

router = APIRouter(prefix="/agent", tags=["agent"])

_BUNDLED_SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
_USER_SKILLS_DIR = Path.home() / ".secondbrain" / "skills"


def _get_note_author_body() -> str:
    registry = SkillRegistry.load([_BUNDLED_SKILLS_DIR, _USER_SKILLS_DIR])
    skill = registry.get("note-author")
    return skill.body if skill else ""


def _build_inline_messages(
    original: list[dict], skill_body: str
) -> list[dict]:
    """Prepend skill_body to the system message (create one if absent)."""
    messages = list(original)
    if messages and messages[0].get("role") == "system":
        messages[0] = {
            **messages[0],
            "content": f"{skill_body}\n\n{messages[0]['content']}",
        }
    else:
        messages.insert(0, {"role": "system", "content": skill_body})
    return messages


@router.post("/inline")
async def agent_inline(
    body: dict,
    authorization: str = Header(),
):
    """OpenAI-compatible streaming endpoint for xl-ai inline /ai."""
    get_user_id(authorization)  # validate JWT; raises HTTPException on failure

    # Inject note-author skill
    skill_body = _get_note_author_body()
    messages = _build_inline_messages(body.get("messages", []), skill_body)

    # Get model endpoint (API mode for inline)
    endpoint = get_endpoint(Mode.API, task="chat")

    payload = {
        **body,
        "messages": messages,
        "model": endpoint["model"],
        "stream": True,
    }

    # Proxy to model, stream back response
    async def stream():
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                endpoint["url"],
                headers=endpoint["headers"],
                json=payload,
            ) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
```

- [ ] **Step 4: Add `get` method to `SkillRegistry`**

Open `backend/services/agent/skills.py` and add after the existing `all()` method:

```python
def get(self, name: str) -> "Skill | None":
    return self._skills.get(name)
```

- [ ] **Step 5: Register router in `main.py`**

Open `backend/main.py`. Change the import line from:
```python
from routers import notes, ingest, retrieval, internal, agent
```
to:
```python
from routers import notes, ingest, retrieval, internal, agent, agent_inline
```

Add after `app.include_router(agent.router)`:
```python
app.include_router(agent_inline.router)
```

- [ ] **Step 6: Run tests**

```bash
cd /home/ayoub/projects/second_brain/backend
source .venv/bin/activate
pytest tests/test_agent_inline.py tests/ -v 2>&1 | tail -15
```
Expected: `test_inline_injects_skill_into_system` PASS, `test_inline_adds_system_if_none` PASS, all 41 original tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/routers/agent_inline.py backend/tests/test_agent_inline.py backend/services/agent/skills.py backend/main.py
git commit -m "feat: /agent/inline — OpenAI-proxy for xl-ai with note-author injection"
```

---

## Task 9 — Frontend: `/api/ai/blocknote` auth-proxy route

**Files:**
- Create: `frontend/app/api/ai/blocknote/route.ts`

This route receives OpenAI-format requests from `ClientSideTransport` (via `fetchViaProxy`), adds the Supabase auth token, and proxies to `backend/agent/inline`.

The `noteId` is passed as a URL query param: `/api/ai/blocknote?noteId=<uuid>`.

- [ ] **Step 1: Create the route**

```typescript
// frontend/app/api/ai/blocknote/route.ts
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fastApiUrl = process.env.FASTAPI_URL ?? "http://localhost:8000";

  let res: Response;
  try {
    res = await fetch(`${fastApiUrl}/agent/inline`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: req.body,
      // @ts-expect-error — Node 18+ streaming bodies
      duplex: "half",
    });
  } catch (e) {
    const refused = e instanceof Error && e.message.includes("ECONNREFUSED");
    return new Response(
      JSON.stringify({
        error: refused
          ? "Backend not running. Start it: cd backend && uvicorn main:app --reload"
          : `Backend unreachable: ${e instanceof Error ? e.message : String(e)}`,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/ayoub/projects/second_brain/frontend
npx tsc --noEmit 2>&1 | grep "blocknote\|error" | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "frontend/app/api/ai/blocknote/route.ts"
git commit -m "feat: /api/ai/blocknote auth proxy to backend /agent/inline"
```

---

## Task 10 — Configure `AIExtension` in `BlockEditor`

**Files:**
- Modify: `frontend/components/editor/BlockEditor.tsx`

`AIExtension()` is already imported and in the extensions array but has no transport configured. We configure it with `ClientSideTransport` using `createOpenAI` + `fetchViaProxy` so it routes through `/api/ai/blocknote`. We also add `AIMenuController` to the `BlockNoteView` children so the AI menu UI appears.

- [ ] **Step 1: Install `@ai-sdk/openai`**

```bash
cd /home/ayoub/projects/second_brain/frontend
npm install @ai-sdk/openai
```

- [ ] **Step 2: Add imports to `BlockEditor.tsx`**

After the existing `import { AIExtension } from "@blocknote/xl-ai";` line, add:

```tsx
import { AIMenuController, ClientSideTransport, fetchViaProxy } from "@blocknote/xl-ai";
import { createOpenAI } from "@ai-sdk/openai";
```

- [ ] **Step 3: Replace the `AIExtension()` call**

Inside `BlockEditorComponent`, before `useCreateBlockNote`, create the transport using the component's `_noteId` prop:

```tsx
// Inline /ai transport — routes to /api/ai/blocknote with note context
const inlineTransport = useMemo(
  () =>
    new ClientSideTransport({
      model: createOpenAI({
        apiKey: "x",  // placeholder; the route validates via Supabase session
        fetch: fetchViaProxy(
          (_url) => `/api/ai/blocknote?noteId=${encodeURIComponent(_noteId)}`
        ),
      })("gpt-4o"),  // model name is overridden by backend to its configured model
    }),
  [_noteId]
);
```

Change `extensions: [AIExtension()],` to:
```tsx
extensions: [AIExtension({ transport: inlineTransport })],
```

- [ ] **Step 4: Add `AIMenuController` to `BlockNoteView` children**

Inside the `<BlockNoteView>` JSX (after the existing `<SuggestionMenuController>` blocks), add:

```tsx
{/* AI menu — shown when user types /ai or selects text + ⌘J */}
<AIMenuController />
```

Add the `useMemo` import if not already present. Check the existing imports at the top — if `useMemo` is not there, add it:
```tsx
import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useMemo } from "react";
```

- [ ] **Step 5: Type-check**

```bash
cd /home/ayoub/projects/second_brain/frontend
npx tsc --noEmit 2>&1 | grep "BlockEditor\|error" | head -20
```
Expected: no errors related to our changes (pre-existing `@ts-ignore` on line 7 is fine).

- [ ] **Step 6: Manual test (requires both servers running)**

Start backend and frontend:
```bash
# Terminal 1
cd /home/ayoub/projects/second_brain/backend && source .venv/bin/activate && uvicorn main:app --reload

# Terminal 2
cd /home/ayoub/projects/second_brain/frontend && npm run dev
```

1. Open `http://localhost:3000/brain` and open a note.
2. Type `/ai` in an empty block — the xl-ai slash menu item should appear.
3. Select it, type "Write a short paragraph about recursion", press Enter.
4. Verify that text streams into the note as new blocks.
5. Select existing text in the note, press ⌘J — verify the xl-ai popover appears with Rewrite/Explain/Continue options.

If the AI menu appears but content doesn't stream, check the browser console for errors on `/api/ai/blocknote`.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/editor/BlockEditor.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat: configure AIExtension with ClientSideTransport + AIMenuController"
```

---

## Task 11 — Write E2E tests

**Files:**
- Create: `frontend/e2e/phase2-sidepanel.spec.ts`
- Create: `frontend/e2e/phase2-commandk.spec.ts`

- [ ] **Step 1: Write SidePanel E2E test**

```typescript
// frontend/e2e/phase2-sidepanel.spec.ts
import { test, expect } from "@playwright/test";

test.describe("AI SidePanel", () => {
  test.beforeEach(async ({ page }) => {
    // Log in (mirrors existing auth helper)
    await page.goto("/login");
    await page.fill('input[type="email"]', process.env.TEST_USER_EMAIL ?? "aubrif005@gmail.com");
    await page.fill('input[type="password"]', process.env.TEST_USER_PASSWORD ?? "SecondBrain2026!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/brain**");
  });

  test("opens AI panel via toggle button", async ({ page }) => {
    const toggleBtn = page.getByRole("button", { name: "Open AI panel" });
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();
    await expect(page.getByRole("complementary", { name: "AI assistant panel" })).toBeVisible();
  });

  test("opens via ?ai=open URL param", async ({ page }) => {
    await page.goto("/brain?ai=open");
    await expect(page.getByRole("complementary", { name: "AI assistant panel" })).toBeVisible();
    // param should be stripped from URL
    await expect(page).not.toHaveURL(/ai=open/);
  });

  test("closes with X button", async ({ page }) => {
    await page.goto("/brain?ai=open");
    await page.getByRole("button", { name: "Close AI panel" }).click();
    await expect(page.getByRole("complementary", { name: "AI assistant panel" })).not.toBeVisible();
  });

  test("⌘P opens search, ⌘K toggles AI panel", async ({ page }) => {
    await page.goto("/brain");
    await page.keyboard.press("Meta+p");
    await expect(page.getByRole("dialog")).toBeVisible();  // search modal
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("complementary", { name: "AI assistant panel" })).toBeVisible();
  });
});
```

- [ ] **Step 2: Write CommandK E2E test**

```typescript
// frontend/e2e/phase2-commandk.spec.ts
import { test, expect } from "@playwright/test";

test.describe("CommandK launcher", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', process.env.TEST_USER_EMAIL ?? "aubrif005@gmail.com");
    await page.fill('input[type="password"]', process.env.TEST_USER_PASSWORD ?? "SecondBrain2026!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/brain**");
  });

  test("⌘K opens compact modal", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog", { name: "AI assistant" })).toBeVisible();
    await expect(page.getByLabel("AI query")).toBeFocused();
  });

  test("Esc closes compact modal", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("submit expands to full chat", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await page.getByLabel("AI query").fill("Hello");
    await page.keyboard.press("Enter");
    // After expansion, Chat component is visible (has the Send button)
    await expect(page.getByLabel("Send")).toBeVisible({ timeout: 3000 });
  });

  test("Esc in expanded goes back to compact", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await page.getByLabel("AI query").fill("Hello");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Send")).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("Escape");
    // Back to compact — Send is gone, AI query input is back
    await expect(page.getByLabel("AI query")).toBeVisible();
    await expect(page.getByLabel("Send")).not.toBeVisible();
  });

  test("/brain/chat redirects to /brain with panel open", async ({ page }) => {
    await page.goto("/brain/chat");
    await page.waitForURL("**/brain**");
    await expect(page).not.toHaveURL("/brain/chat");
    await expect(page.getByRole("complementary", { name: "AI assistant panel" })).toBeVisible();
  });
});
```

- [ ] **Step 3: Run E2E tests (requires both servers)**

```bash
cd /home/ayoub/projects/second_brain/frontend
npx playwright test e2e/phase2-sidepanel.spec.ts e2e/phase2-commandk.spec.ts --reporter=list 2>&1 | tail -20
```
Expected: all tests pass (some may be flaky depending on LLM availability — focus on UI behaviour tests, skip stream-dependent ones if needed).

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/phase2-sidepanel.spec.ts frontend/e2e/phase2-commandk.spec.ts
git commit -m "test(e2e): SidePanel + CommandK phase 2 specs"
```

---

## Task 12 — Final verification

- [ ] **Step 1: Run all backend tests**

```bash
cd /home/ayoub/projects/second_brain/backend
source .venv/bin/activate
pytest tests/ -q
```
Expected: 43 passed (41 original + 2 new inline tests).

- [ ] **Step 2: Full TypeScript check**

```bash
cd /home/ayoub/projects/second_brain/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "app/api/auth/login" | head -20
```
Expected: 0 new errors (the `login/route.ts` pre-existing error is unrelated).

- [ ] **Step 3: Done-criteria checklist**

Check each criterion from the Phase 2 spec:

| Criterion | How to verify |
|---|---|
| AI icon → SidePanel with streaming chat | Open `/brain`, click Bot icon, ask a question |
| ⌘K compact → expands → Esc to compact | Keyboard flow as described |
| ⌘P opens search | `Meta+p` key in browser |
| `/ai` in editor streams blocks | Type `/ai` in note, submit prompt |
| ⌘J selection popover | Select text, `Meta+j`, verify popover |
| SidePanel + CommandK share thread | Open both, confirm same conversation |
| `/brain/chat` redirects | Navigate to `/brain/chat`, verify redirect |

---

## Self-Review Notes

**Spec coverage check:**
- D1 SidePanel overlay: Tasks 3–4 ✓
- D1 CommandK two-stage: Tasks 6–7 ✓  
- D1 Inline `/ai`: Tasks 8–10 ✓
- D2 ⌘K→AI / ⌘P→search: Task 4 ✓
- D3 CompactInput→Expanded: Task 6 ✓
- D4 xl-ai GPL accepted: Tasks 8–10 ✓
- D5 Android WebView-only: no Kotlin changes ✓
- Thread sharing: AIThreadContext Tasks 1–2 ✓
- `/brain/chat` redirect: Task 5 ✓
- Backend inline endpoint: Task 8 ✓
- Auth proxy route: Task 9 ✓

**Potential issues to watch for:**
1. `useMemo` needed for `inlineTransport` in `BlockEditorComponent` — confirmed in Task 10.
2. `AIMenuController` requires `AIExtension` to be configured with a transport — both added in Task 10.
3. The `initialQuery` auto-send in `Chat` uses `setTimeout(() => send(), 50)` — if the component is not fully mounted, `send()` may fire before state is ready. If this causes issues, use a ref flag guard (already included in the `didAutoSend` ref).
4. xl-ai ⌘J shortcut may conflict with macOS emoji picker. If so, the shortcut can be changed in `AIMenuController` via its `shortcut` prop.
5. The backend `/agent/inline` passes `body.tools` (xl-ai tool definitions) through to the model unchanged. Verify the model supports function calling — OpenRouter's free models vary.
