# What Second Brain learns from NemoClaw, OpenShell, Hermes Agent and OpenClaw

Date: 2026-10-27. Decision (user): **learn from these tools, keep our own code.** Nothing of
theirs is vendored, installed or run. Their source was read at these commits (shallow clones,
read only): hermes-agent `69f73ec5`, OpenShell `e5adf6f`, NemoClaw `87cc4c8` — all 2026-10-27.

## Method

For each idea: what the tool does (in its code, not its marketing), what our app does today
(in our code), and what community reports say went wrong. An idea is taken only when it closes a
real gap in our app; the failures of these tools are lessons too.

## What our app already does as well or better — no work

| Idea | Theirs | Ours |
|---|---|---|
| Approval on a separate channel | OpenShell: policy changes wait for human review | `services/agent/permissions.py`: approval keys come from the client, never from tool args; deletes, edits after untrusted text, and MCP calls with private notes in reach all need a click |
| "Lethal trifecta" awareness | NemoClaw docs: prompt injection still arrives through approved channels | `untrusted_context` turns on after retrieved notes or any MCP result; mutations and MCP calls then need approval |
| Scheduled jobs never run twice | Hermes cron: advance `next_run_at` before dispatch | `services/jobs/schedule.py::fire_one` claims (`_claim`) before creating the job; catch-up runs only the latest missed occurrence |
| Secrets at rest | OpenShell providers keep keys out of the agent | `services/secrets.py` (Fernet, fail closed) — used for Notion; `ai_providers.api_key` is still plaintext (known ledger item B5, not in scope here) |
| Privacy by level | OpenShell routes inference by policy | `services/privacy.py` ceilings per provider, enforced in code, fail closed |
| No shell for the agent | OpenShell sandboxes a shell | our agent has no shell or file tools; stdio MCP is refused where `RENDER` is set |
| Third-party code (OpenClaw's ClawHub lesson) | malicious skills in a marketplace | plugins: an approved list, a warning before anything else, server-side fetch with SSRF checks (`lib/plugins/fetchPlugin.ts`), code stored at install and changed only by the user |

## Gaps, ranked — what we build

### 1. Insecure default for the internal API key — from OpenClaw's failure
OpenClaw shipped listening on all interfaces with weak defaults; tens of thousands of instances
were exposed. Ours: `settings.internal_api_key` defaults to the public string
`changeme-internal-key`, and `/internal/*` takes `user_id` in the body — any deployment that
forgets the variable hands out every user's notes. Render generates the value, so the live site is
safe; the code is not. Fix: refuse every internal call while the key is unset or the default;
compare in constant time.

### 2. Outbound requests to private addresses (SSRF) — from OpenShell's egress policy
OpenShell blocks private, loopback, link-local and the cloud metadata address by default, and
checks every connection. Ours: sign-up is open, and the server fetches user-supplied URLs with no
check — website/article import (`trafilatura.fetch_url`, follows redirects), MCP server URLs
(probe returns the error text, an oracle), and custom AI provider `base_url` (create and patch).
A signed-in stranger can make our server call `169.254.169.254` or anything on Render's private
network. Fix: one `services/egress.py` guard — http(s) only, resolve the host, refuse
non-public addresses, re-check every redirect hop; private addresses allowed only when running on
your own machine (same rule as stdio MCP).

### 3. MCP tools that change after you trusted them — from OpenShell's per-tool MCP rules
OpenShell lets a policy allow `tools/list` and specific `tools/call` names, and makes new access
wait for review. Ours: every tool a server lists goes to the model, and the list is re-read every
5 minutes. A server can add a tool or rewrite a description at any time ("rug pull" / tool
poisoning) and the model sees it at once. Fix: remember the tools the user saw when adding the
server (a fingerprint of name + description + input schema). A new or changed tool is held back
from the model until the user approves it in Settings → MCP servers.

### 4. Invisible characters and injection text from sources — from Hermes `threat_patterns.py`
Hermes strips/flags zero-width and bidi characters and scans memory, context files and tool
results for injection phrases. Its CVEs (CVE-2026-9353, CVE-2026-9366) are bypasses of exactly
these regex scanners: **a scanner is hygiene, never a boundary.** Ours has the boundary
(permissions) but no hygiene: invisible characters in a PDF or an MCP description reach the model
unseen. Fix: remove invisible/bidi characters from untrusted text before it reaches the model
(retrieved notes, MCP results and descriptions); detect classic injection phrases and tell the
user — never rely on it to allow or block an action.

### 5. The assistant remembers your notes but not *you* — from Hermes `USER.md`/`MEMORY.md`
Hermes keeps a short, bounded profile of the user, loaded into every session as a frozen
snapshot; a `memory` tool adds/replaces/removes entries; writes are scanned with the strictest
patterns because memory is persistent (the CSA note: memory is where an injection survives a
restart). Ours: nothing about the user persists between chats. Fix: "About you" — a short,
bounded list of facts and preferences, shown and editable in Settings; loaded into the system
prompt; the agent may propose an entry with a `memory.remember` tool, which needs approval after
untrusted text, rejects invisible characters and injection phrases, and is capped in size.
Privacy: the profile is `personal` — never sent to a provider marked untrusted.

## Not taken, and why

- **Agent-written skills (Hermes `skill_manage` + curator).** Valuable, but a skill is persistent
  prompt text — the same attack surface as memory, larger. Revisit after "About you" has run for a
  while; if built: drafts only, a human saves them, archive never delete (Hermes curator rule).
- **Skill marketplaces / remote skill install.** OpenClaw's ClawHub had hundreds of malicious
  skills (Koi "ClawHavoc", Unit 42). Our skills stay in the repo or are written by the user.
- **Kernel sandboxing (OpenShell).** Our agent runs no code and has no shell; there is nothing for
  a sandbox to contain. Revisit if the agent ever gets code execution.
- **Messaging gateways, heartbeats (OpenClaw/Hermes).** Product features, not lessons; out of
  scope for this pass.
- **Hermes "YOLO mode" (all checks off).** The lesson is to never offer one.

## Build order

1 → 2 → 4 need no migration and go first. 3 and 5 share migration
`supabase/migrations/032_mcp_pins_user_memory.sql`, which the user runs in Supabase before the
code that uses it is pushed. Each step: code + tests + its own commit.

## Status (2026-10-27)

| # | Gap | Commit | Tests |
|---|---|---|---|
| 1 | Public internal key works only from this machine | `f1f60872` | `tests/test_internal_key_defaults.py` |
| 2 | One SSRF guard (`services/egress.py`) on 5 places | `c520105d` | `tests/test_egress.py` |
| 4 | Hidden characters removed, wrappers defused, injection flagged | `cecf6e40` | `tests/test_text_hygiene.py` |
| 3 | MCP tools pinned; changes wait for approval | `dd03b9d9` | `tests/test_mcp_pins.py`, settings/mcp page test |
| 5 | About you (memory) | `85bf9e6b` + cache | `tests/test_memory.py`, settings/about-you page test |

Whole suites after the last step: backend 3,006 passed (local pgtest running), frontend
1,517 passed, `tsc` clean. **Before pushing 3 and 5: run migration 032 in Supabase.** Without it
both degrade safely (tools unpinned as before; About you absent, its page says "needs migration 032").

Residual risk, stated: the SSRF guard checks the connected address after the request is sent, so a
DNS-rebinding attacker can still make one blind request; reading the answer is refused. Pinning the
resolved IP per connection would close it and is not done.
