# Inline AI — Problem Explanation & Fix Log

## What is "inline AI"?

The editor uses `@blocknote/xl-ai`'s `AIMenuController`. When triggered, it opens a prompt
bar attached to the current block. The user types a request ("write an intro", "fix this
sentence") and the AI edits the document directly in-place with tracked changes the user
can accept or reject.

---

## Problem 1 — Wrong shortcut key (Cmd+J)

### Root cause
`Cmd+J` is Chrome's built-in **Downloads** shortcut. It is intercepted at the **browser
process level**, before Chrome dispatches any DOM events. No JavaScript running on the page
can ever see a `keydown` event for `Cmd+J`. This is true regardless of whether the listener
uses `capture: true` — capture/bubble only affects DOM event propagation, not browser-level
hotkeys that never enter the DOM at all.

### Fix
Unified the shortcut with the existing `Cmd+K` using **text-selection context**:

| Situation | Result |
|---|---|
| `Cmd+K` with text selected inside the editor | Opens inline AI at current block |
| `Cmd+K` with no selection (or cursor outside editor) | Opens the CommandK chat modal |

**Implementation:** `AIKeyboardHandler` in `BlockEditor.tsx` runs in the DOM **capture phase**
(`{ capture: true }`). When it detects `Cmd+K` + a non-empty selection inside the editor DOM
element, it calls `stopPropagation()`, preventing the event from reaching `BrainLayoutClient`'s
bubble-phase handler. When no selection exists it does nothing, so the event bubbles normally
and `BrainLayoutClient` opens the CommandK modal.

---

## Problem 2 — Inline AI writes nothing (silent failure)

### Root cause
`@blocknote/xl-ai`'s `ClientSideTransport.streamText` hardcodes `toolChoice: "required"`,
forcing the model to call the `applyDocumentOperations` tool. The globally configured model
`nvidia/nemotron-3-super-120b-a12b:free` is a **free** OpenRouter model. Free-tier models
on OpenRouter do not support forced tool-calling.

When tool calling fails, OpenRouter returns a non-200 error. The original proxy in
`agent_inline.py` streamed raw bytes from the upstream regardless of HTTP status — so the
frontend received an unparseable JSON error body pretending to be an SSE stream. `xl-ai`
got no operations from it, wrote nothing, and showed no error.

**Secondary issue:** before the fix, the backend was also injecting the `note-author` skill
into the xl-ai system message. That skill instructs the model to use HTML callouts and
`data-importance` attributes — incompatible with xl-ai's Markdown block format. Even if
the model called the tool correctly, `validateBlock` would strip the non-standard content,
leaving empty blocks.

### Fix
1. **Separate inline model** — added `inline_model: str = "openai/gpt-4o-mini"` to
   `core/config.py`. The inline AI endpoint (`/agent/inline`) always uses this model, which
   reliably supports tool calling. Override via `INLINE_MODEL=...` in `.env`.

2. **Removed skill injection** — `agent_inline.py` no longer injects `note-author` into the
   xl-ai system prompt. xl-ai manages its own system prompt for document manipulation.

3. **Error surfacing** — the proxy now checks the upstream HTTP status. Non-200 responses are
   emitted as a proper SSE `{ type: "error", content: "..." }` event so xl-ai can display the
   error instead of silently doing nothing.

---

## Current shortcut map

| Shortcut | Context | Action |
|---|---|---|
| `Cmd+K` | Text selected in editor | Open inline AI at current block |
| `Cmd+K` | No selection / outside editor | Open CommandK chat modal |
| `Cmd+P` | Anywhere | Open note search |
| `/` in editor | Cursor in empty block | Open slash menu (includes "Ask AI") |

---

## Configuration

```env
# .env (backend)
INLINE_MODEL=openai/gpt-4o-mini   # any OpenAI-tool-call-capable model via OpenRouter
```

The main chat model (`API_MODEL_OPENROUTER`) and the inline AI model are independent.
Free models are fine for chat; inline AI requires a model with tool-calling support.
