# MCP Apps UI (SEP-1865) — a card for a pending change, inline in the host's chat

Closes the last item of harness 5.4. SEP-1865 ("MCP Apps") is a ratified MCP
extension (Final status, January 2026, co-developed by Anthropic and OpenAI):
a server can declare a `ui://` HTML resource and link it to a tool via
`_meta.ui.resourceUri`, so a supporting host (Claude web/desktop, ChatGPT)
renders that resource in a sandboxed iframe instead of the tool's plain text.
Researched from the actual spec (modelcontextprotocol.io/seps/1865 and the
ext-apps repo's `apps.mdx`), not from memory — this is recent enough, and
security-relevant enough (our server sits on a public tunnel), to get wrong.

## What it does

`update_note` and `delete_note` (the two tools that ask for the user's
approval before writing) now carry `_meta.ui.resourceUri` pointing at
`ui://second-brain/pending-change`. A host that understands MCP Apps renders
that resource — a small HTML+JS card — right in the chat instead of the
plain "NOT DONE YET" text. The card shows the note title, the action, the
reason given, and a Now/After preview; a "Review in Second Brain" button
opens `Settings → Connected apps?change=<id>`, which now scrolls to and
highlights the exact change.

**The card is read-only on purpose.** It does not approve or reject
anything itself. The sandboxed view has no Second Brain login and no way to
get one; the only channel it has is `postMessage` → host → our server's
`tools/call`, using the SAME OAuth token the connected app already holds.
SEP-1865's `visibility: ["app"]` field can ask a host not to let the MODEL
call a tool, but it is a host-side rendering hint, not something our server
enforces — a non-compliant host could ignore it. Building an `approve_change`
tool at all would mean the connected app's own token could approve its own
request, which is exactly the short-circuit `[[project_harness_direction]]`
flagged for the injection hole this whole approval flow exists to close. So
the actual decision stays exactly where it already was: `services.
connected_apps.decide`, called only from the authenticated Settings page,
unchanged.

## What was built

- `backend/mcp_remote/apps.py` — the resource: a ~150-line HTML/JS view. No
  external scripts/fonts/images, so the spec's own restrictive default CSP
  is enough (no `_meta.ui.csp` needed). Hand-rolls the `ui/initialize`
  handshake from the spec's appendix (~40 lines) rather than pulling in
  `@modelcontextprotocol/ext-apps` (a TS-only package; our server is Python,
  and the installed `mcp` SDK 1.27.1 has no support for this extension at
  all — confirmed by grepping the installed package for `ui://`/`mcp-app`).
- `backend/mcp_remote/server.py` — registers the resource via
  `@mcp.resource(...)`; `update_note`/`delete_note` get `meta={"ui": {...}}`
  and `structured_output=True` (needed for FastMCP to populate
  `structuredContent`, which is what `ui/notifications/tool-result` carries
  to the view — a bare `-> dict` annotation does NOT trigger this; needed
  `dict[str, Any]`). Neither tool's plain-text result changed, so a host
  with no MCP Apps support sees exactly what it saw before.
- `backend/services/connected_apps.py` — `propose()` now also returns
  `action`, `current_text_preview`, `new_text_preview` (280-char excerpts,
  "…" only when actually cut) — the same dict the model already sees, so the
  card needs no extra round trip. `update_note`/`delete_note` add
  `review_url` in `mcp_remote/server.py` itself (it needs `FRONTEND_URL`,
  which `connected_apps.py` has no business knowing).
- `frontend/app/(brain)/brain/settings/connected-apps/page.tsx` — reads
  `?change=<id>`, scrolls to and highlights that one card. Small, additive,
  the only frontend change this needed.

## Verified

- 4 new backend tests (`tests/test_mcp_remote.py`, 18 total, all passing):
  the UI meta appears on update_note/delete_note and nowhere else, the
  resource is real and correctly typed, an edit's structuredContent carries
  every field the card renders, a delete has no `new_text_preview`. Two
  mutations (dropping the meta, disabling truncation) confirmed to fail
  these tests before the fix.
- 2 new frontend tests for the `?change=` highlight; full suite 1209 green.
- **Live, against the real running server** (not the in-process test
  client): `e2e/mcp-apps-live.spec.ts`, reusing `mcp-remote-live.spec.ts`'s
  own real OAuth flow. Confirms over the actual wire: `tools/list`'s meta,
  a real `resources/read` for the `ui://` URI, a genuine `update_note` call's
  `structuredContent` (title, previews, review_url — all real, not mocked),
  the review link landing on and highlighting the right card, Approve
  actually applying the edit. Free (no model call). Green; its test note
  and pending change were cleaned up.
- **Not verified**: an actual AI host (Claude.ai, ChatGPT) rendering the
  card in a real chat. That needs the user's own connected session through
  the tunnel — the sandboxed iframe and postMessage bridge cannot be driven
  by Playwright, which is not itself an MCP Apps host. The plain-text
  fallback (what a host without MCP Apps support, or the user testing it,
  sees today) is unchanged and covered by the existing approval tests.

## What this does not do

- No other tool got a card. `check_change`, `search_notes`, etc. still
  return plain text — this was scoped to the one flow worth the protocol
  work, not a blanket rollout.
- No capability-negotiation check on the server side (whether the connected
  client actually declared `io.modelcontextprotocol/ui` at `initialize`).
  The spec's own fallback story — an unsupporting host just shows the text
  — means this is safe to skip: the `_meta` is harmless noise to a host that
  ignores it.
