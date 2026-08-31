# WebMCP — opportunity assessment

> Date: 2026-08-31 · Full report (artifact): https://claude.ai/code/artifact/fe53ec04-629d-4ba5-94b4-97ca13ae1afa

## What it is

W3C Web Machine Learning CG draft (Google + Microsoft). A page registers its own
client-side functions as agent tools via `document.modelContext.registerTool()`;
agents discover them with `getTools()` and run them with `executeTool()`. The page
is the MCP server. Status as of 2026-08: Chrome 149 origin trial, Edge 150 origin
trial, ChatGPT Desktop supports it, Brave Leo experimental; Firefox and Safari have
standards-position issues open, no commitment. Requires a secure context and an
origin-isolated document. Local testing: `chrome://flags/#enable-webmcp-testing`.
TS types: `webmcp-types` on npm.

## Why it matters here

We already have both backend MCP legs — `backend/mcp_server.py` (outbound, stdio,
3 read tools) and `services/agent/mcp_client.py` (inbound, external servers).
Neither can see or change browser state. That is the gap:

1. **Databases** — active view, filters, sorts, grouping and post-filter rows live
   only in `lib/database/useDatabaseView.ts`. The backend MCP server cannot read
   them and cannot move the user's screen.
2. **`editor.*` tools** — currently server-side (`permissions.py`, INTERNAL_API
   tier) actuating the editor over a round trip. As page tools they'd run against
   the live BlockNote instance: unsaved buffer, working undo, normal autosave.
3. **Auth** — stdio server needs `INTERNAL_API_KEY` + a hardcoded
   `SECOND_BRAIN_USER_ID`. Page tools ride the user's Supabase session.
4. **We have an in-page agent** (`components/ai/Chat.tsx`). `getTools()`/
   `executeTool()` are available to author-provided agents, so the payoff does not
   depend on browser rollout reaching our users.

## Recommended path

1. `lib/webmcp/registry.ts` — a `registerTool()` shim keeping a local Map and
   mirroring to `document.modelContext` when present. Feature-detect both
   `document.modelContext` and the older `navigator.modelContext` here. (~half a day)
2. Teach the in-page agent to call page tools. **Main engineering cost:**
   `engine.py` runs the tool loop server-side over SSE, so this needs a
   `page_tool_call` event + a client-executed result posted back to resume the turn.
   (1–2 days)
3. Write tools gated by the existing `permissions.py` tiers:
   EXTERNAL → register with `readOnlyHint`; INTERNAL_API → register behind
   `requestUserInteraction` confirm; destructive (delete_note, delete_row) →
   **do not register at all**. (~1 day)
4. Declarative `toolname`/`tooldescription`/`toolparamdescription` attributes on
   `app/forms/[viewId]`, plus a read-only tool on `/share/[noteId]`. Origin trial
   registration once there's an HTTPS deployment; may need
   `Origin-Agent-Cluster: ?1` in `next.config.ts`. (hours)

## Risks

- **Prompt injection (serious, specific to us).** The brain is ingested third-party
  text (PDFs, scraped sites, YouTube transcripts). Read tools feed that into an
  agent that also holds our write tools. Mitigate: no destructive tools registered,
  confirmation on every write, narrow typed tools, extend `mcp_audit_log` to page
  tool calls.
- Tools in a top-level document are exposed to the built-in browser agent by
  default. Put it behind a settings toggle (next to `/brain/settings/mcp`),
  default off.
- Spec is moving: namespace, `outputSchema`, elicitation, progress, streaming all
  open. Keep it all behind the phase-1 shim.
- Android app can't have it → add as ANDROID_PARITY item #22.
- **Do not retire `backend/mcp_server.py`.** WebMCP is complementary; the stdio
  server works headless with no tab open. The service-worker extension that would
  close that gap is only a proposal.
