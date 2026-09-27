# Remote MCP server (5.4) — your Second Brain for other apps

User decisions (2026-09-27): runs on the laptop behind a free tunnel; full
access, with every edit/delete confirmed by the user in the app.

## Phase 1 — done (this commit)
- `backend/mcp_remote/` — a SEPARATE process (`uvicorn mcp_remote.server:app
  --port 8765`, started by `./app.sh`). Only this port will go through the
  tunnel; the main backend is never exposed.
- MCP over Streamable HTTP at `/mcp`; OAuth 2.1 from the MCP SDK (dynamic
  client registration, PKCE S256, refresh rotation, revocation, .well-known
  metadata). `SecondBrainOAuth` decides: `/authorize` parks the request and
  sends the browser to the app's **Allow page** (`/mcp-connect`, needs the
  Second Brain login); Allow → a one-time code for THAT user; tokens act only
  as that user (1 h access, 30-day refresh, rotated).
- Codes and tokens stored only as SHA-256 hashes — migration **023** (user
  applies): `mcp_clients`, `mcp_auth_requests`, `mcp_grants`, RLS on, no
  policies (service role only).
- Tools: `search_notes` (the hybrid search), `list_notes`, `get_note`,
  `create_note` (Markdown → note blocks). No edit/delete yet.
- Login returns to the page you came from (`/login?next=`, same-site only).
- Found on the way: notes written by the AI's tools had no plain text, so
  search and the index sweep never saw them — fixed for create and update.
- Tests: the full flow in-process (register → authorize → Allow → code →
  token → tools), wrong PKCE refused, code single-use, refresh rotation, Deny,
  no token → 401, the Allow endpoints need a Second Brain login.

- **Live** (`e2e/mcp-remote-live.spec.ts`, project `mcp-remote`, free):
  against the running app — a test app registers, the real Allow page is
  clicked, code + PKCE → token, then list / create / read / search as the
  user (the note is deleted), then revoke → the token answers 401.
- Found live: the MCP SDK's `/revoke` required a `client_secret` field that
  public clients (chat apps) never send — 400, and the token kept working.
  Our own `/revoke` now disconnects the app for that user (access and refresh
  tokens), checking a secret only when the app has one.

## Phase 2 — edit and delete, confirmed in the app — done
`update_note` / `delete_note` only ask (migration 024); the reply says NOT
DONE YET; `check_change` reports the decision. Settings → Connected apps shows
each waiting change (app, note, reason, text now vs after) with Approve /
Reject, and each connected app with Disconnect. An approved delete goes to the
Trash. Live (`mcp-remote`, 3 tests): an edit waits, Approve applies it; a
delete is rejected and the note stays; Disconnect → the token answers 401.
Leftover connections from runs before the /revoke fix were disconnected.

## Phase 3 — the tunnel
`./app.sh tunnel`: install `cloudflared` (asks first), start a tunnel to
port 8765, save its HTTPS address (`~/.secondbrain/mcp-public-url`), restart
the MCP server with it, and print what to paste into claude.ai / ChatGPT.
A free quick tunnel's address changes each start; a fixed one needs a
Cloudflare account + domain.
