# Local Brain — Switchboard Routing (design, for approval)

**Status:** approved with the proposed defaults (§11) · P0 + P1 built 2026-10-04, P2 brain plug-in built (rules_only default) · see §12
**Decisions so far (user):** Switchboard (A) first, orchestrator (B) later · design the app
architecture independent of today's hardware; the device solution may be temporary and
must be easy to remove · **privacy is a goal** — the app will hold a whole digital life ·
UI/UX, layout, and editable routing instructions are part of this design.

---

## 1. The idea in one paragraph

Every request (chat first, then every other AI call site) passes through a **switchboard**
before any model sees it. The switchboard decides **where** the request runs (on-device or
which cloud model) and **what context is allowed to travel there**. The decision is made by
editable rules first, then by a **brain** — a small model, ideally local — for the cases the
rules leave open. Privacy is enforced in code, never left to a model's judgment. Every
decision is shown to the user and can be overridden, and every override is logged so the
routing gets better.

## 2. Today vs. this design

| Today | This design |
|---|---|
| `services/ai/router.py`: fixed job → capability chain, cloud first, local is fallback | Policy + brain decide per request; local can be first |
| `ModeToggle` (Local / API) chosen by hand per thread | `Auto` by default; manual pick still possible |
| Any retrieved note can be sent to any provider | Sensitivity labels; a gate strips Private content from cloud payloads |
| Routing is invisible | Each answer shows where it ran, why, and what was withheld |
| Editor AI sends the open note to its provider whatever the note's level | Editor AI refuses a note above its provider's ceiling |

## 3. Core concepts

**Slots.** The policy never names a model. It names roles, and Settings maps each role to
a configured provider/model:

| Slot | Meaning | Example mapping |
|---|---|---|
| `local` | On-device, nothing leaves the machine | llama.cpp on laptop (temporary) |
| `fast` | Cheap cloud, quick answers | Haiku 4.5 |
| `strong` | Hard reasoning, long synthesis | Sonnet / Opus |
| `vision` | Images, PDFs with figures | any vision provider |
| `long` | Very large context | Gemini / Claude long-context |

Swapping hardware or models = changing one mapping. That's what makes the temporary
device solution removable.

**Brain.** A pluggable *decider* with one contract. Three implementations ship:
- `RulesOnly` — deterministic, always available, fully private (the safe default).
- `LocalBrain` — a small on-device model behind any OpenAI-compatible endpoint.
- `CloudBrain` — a cheap cloud model. **Off by default**, because the brain reads the
  query; with privacy as a goal, the user must opt in.

**Sensitivity.** Every note, source and database carries a level:
- `open` — fine to send anywhere.
- `personal` (default) — fine for cloud providers the user marked as trusted.
- `private` — never leaves the device.

**Provider trust.** Each cloud provider gets a "trusted for Personal" toggle (e.g. a
zero-data-retention contract). Untrusted providers only ever receive `open` content.

## 4. The pipeline (per request)

```
 user message
     │
 1 SIGNALS     (no model, <5 ms)  surface · attachments · est. tokens · skill tier ·
     │                           sensitivity of retrieved items · manual pick · budget left
     │
 2 RULES       (policy, deterministic)  can FORCE a slot, FORBID slots, or pass
     │          e.g. image → vision · private item needed → local · budget spent → local
     │
 3 BRAIN       (only if rules passed)  small input, JSON out, hard timeout
     │          timeout / error → policy's default slot
     │
 4 PRIVACY     (code, not model)  filter context for the chosen slot's trust level;
   GATE         if something needed was withheld → per policy: answer local / ask / drop
     │
 5 EXECUTE     existing gateway: services/ai client + agent_stream, with fallback
     │
 6 RECORD      routing_decisions row + SSE "route" event → badge in the UI
```

Rules run before the brain on purpose: they are cheap, predictable, and cannot be talked
out of a decision by text inside a PDF.

### Brain contract

Input (kept small — prefill is the cost on weak hardware):
- the user's message (truncated to ~1K chars), a one-line thread summary
- the signals list from step 1
- the slot catalogue (one line each) and the user's routing instructions (§6)

Output, constrained to this JSON schema:

```json
{ "slot": "fast", "reason": "short factual question", "confidence": 0.8 }
```

The brain gets **no tools and no note bodies** in the switchboard phase. It decides; the
harness packs context for the chosen model the normal way. (Full access belongs to phase B
and only after the agent permission gate is fixed — see §9.)

## 5. UI / UX

### 5.1 Composer — model chip replaces ModeToggle

```
┌──────────────────────────────────────────────────────────────┐
│  Ask your second brain…                                      │
│                                                              │
│  [📎]                                   [ Auto ▾ ]  [ Send ] │
└──────────────────────────────────────────────────────────────┘
                                         ┌─────────────────────┐
                                         │ ● Auto (recommended)│
                                         │ ○ Local only   🔒   │
                                         │ ○ Fast  · Haiku     │
                                         │ ○ Strong· Sonnet    │
                                         │ ○ Vision· Gemini    │
                                         │ ─────────────────── │
                                         │ Routing settings →  │
                                         └─────────────────────┘
```
The chosen value is per thread (same as Mode today).

### 5.2 Route badge on every answer

```
 ┌ assistant ────────────────────────────────────────────────┐
 │ …answer text…                                             │
 │                                                           │
 │ ☁ Strong · Sonnet  ·  "multi-step derivation"  · $0.012 ⓘ│
 └───────────────────────────────────────────────────────────┘
   🔒 Local · 0.6 s · nothing left this device              ⓘ
```

Clicking ⓘ opens:

```
┌ Why this route ─────────────────────────────────┐
│ Decided by   brain (local, 340 ms)              │
│ Reason       multi-step derivation              │
│ Signals      12 notes · 9.4K tokens · no files  │
│ Sent         10 notes   Withheld  2 private 🔒   │
│                                                 │
│ Rerun on:  [Local] [Fast] [Strong]              │
│ [ Always route questions like this to… ▾ ]      │
└─────────────────────────────────────────────────┘
```
"Rerun on" re-asks with another slot and logs an override. "Always route like this"
turns the override into a rule, which the user confirms before it is saved.

### 5.3 Privacy prompt (when the policy is "ask")

```
┌ This answer needs 2 Private notes ───────────────────────┐
│ "Health log — Sept", "Bank notes"                        │
│                                                          │
│ [ Answer on device ]  [ Send without them ]  [ Send once ]│
└──────────────────────────────────────────────────────────┘
```
"Send once" never changes the note's level and is recorded in the decision log.

### 5.4 Sensitivity on content

A lock control in the note header and source rows: `Open · Personal · Private`. Private
items show 🔒 in lists and search. Databases can set a default level for new rows.

### 5.5 Settings → Routing (new page next to AI providers)

```
Settings
 ├ AI providers
 ├ Routing            ← new
 │   [Targets] [Rules] [Instructions] [Privacy] [Activity]
 ├ Skills
 ├ Background jobs
 ├ MCP
 └ Connected apps
```

- **Targets** — the slot table: slot → provider/model dropdown, test-ping button, latency.
  The `local` row says which endpoint backs it; replacing the device is a change here.
- **Rules** — an ordered list of `When … → …` rows with a form editor (no code):
  ```
  1  When  message has image or PDF       → use  Vision
  2  When  needs a Private item           → use  Local  (or: ask me)
  3  When  estimated context > 30K tokens → use  Long
  4  When  today's spend ≥ $1.00          → use  Local
  5  Otherwise                            → ask the brain   (default if brain down: Fast)
  ```
  Drag to reorder; first match wins; toggle each row on/off.
- **Instructions** — the editable pre-instructions the brain reads (§6). A markdown editor
  on the left, a **test bench** on the right: type a sample question, see slot + reason +
  which rule or brain decided, without running the answer. Versions are kept; "Restore
  default" is always available.
- **Privacy** — default sensitivity for new content, per-provider trust toggles, what to do
  when Private content is needed (answer local / ask / drop), and the CloudBrain opt-in.
- **Activity** — the decision log: filter by slot, decided-by, overrides; headline numbers
  (% handled locally, override rate, spend, items withheld).

## 6. Routing instructions (editable)

Plain markdown the brain reads on every decision. Shipped default (user edits it freely):

```markdown
You decide where a request runs. Pick exactly one slot.

- local: greetings, short factual lookups over my notes, rewording, tagging,
  anything that mentions health, money, family or passwords.
- fast: normal questions that need a capable model but not deep reasoning.
- strong: proofs, multi-step derivations, planning across many notes,
  writing study guides, anything I say is important.
- When unsure between two slots, pick the cheaper one.
- Never pick a slot the rules forbid.
```

Rules (§5.5) are hard guarantees; instructions are guidance. The UI says so next to each,
so nobody relies on an instruction for privacy.

## 7. Infrastructure

### Backend — new package `services/routing/`

| File | Job |
|---|---|
| `signals.py` | build the signal set from the request (pure, testable) |
| `policy.py` | load / validate / version the user's policy; default policy |
| `rules.py` | evaluate ordered rules → force / forbid / pass |
| `brain.py` | `Decider` protocol + `RulesOnly`, `LocalBrain`, `CloudBrain` |
| `privacy.py` | the gate: filter context by slot trust, report withheld items |
| `switchboard.py` | `route(request, user) -> Route` — runs steps 1–4 |
| `log.py` | write `routing_decisions`, emit the SSE `route` event |

Integration point: `services/agent/model.py:get_provider(mode)` becomes
`switchboard.route(...)`, which returns a `Route` (slot, provider, context filter). The
existing gateway (`services/ai/client.py`, `agent_stream.py`, fallback, budget, pricing)
executes unchanged. `Mode` gains `auto`; `local`/`api` stay working for old threads.

### Database — migration `029_routing.sql`

- `routing_policies` — user_id, version, slots jsonb, rules jsonb, instructions text,
  privacy jsonb, active, created_at.
- `routing_decisions` — id, user_id, thread_id, message_id, surface, slot, provider, model,
  decided_by (`rule|brain|user|fallback`), rule_id, reason, confidence, latency_ms,
  signals jsonb, sent_count, withheld_count, override_of, created_at.
- `sensitivity` column (`open|personal|private`, default `personal`) on notes, sources and
  database rows (or the shared parent table, whichever the schema has).

### API

- `GET/PUT /routing/policy` · `GET /routing/policy/versions` · `POST /routing/policy/restore`
- `POST /routing/test` — run steps 1–4 only, return the decision (powers the test bench)
- `GET /routing/decisions` — the Activity log
- `PATCH /notes/{id}/sensitivity` (and the same for sources / rows)
- SSE event on agent turns: `{"type": "route", slot, model, decided_by, reason, withheld}`

### Call sites, in order

1. Chat (`run_turn`) — first.
2. Inline editor AI and BlockNote AI — both already go through the backend; they now refuse
   a note above their provider's ceiling (they are not routed: one fixed provider each).
3. Ingest, workspace synthesis, background jobs, MCP-server tool calls.

Until a call site goes through the switchboard, it is labelled "not routed" in Activity, so
the privacy promise is never broader than what is actually enforced.

## 8. The temporary device solution

The architecture doesn't depend on it. To get going with daily use:
- `brain = RulesOnly` on day one — private, instant, no hardware needed.
- `local` slot → the existing llama.cpp endpoint when it's running; when it isn't, rules
  that point to `local` fall back per policy (ask or answer without Private items).
- Add `LocalBrain` once a model on hand passes the 50-query check (agreement ≥ ~80%,
  ≤ ~1 s per decision). Removing it later = switching the brain back in Settings.

## 9. Security preconditions

- The agent confirm-flag hole was already fixed (approvals come from the client). New: a
  turn with private notes in reach needs approval for any MCP call (they leave the device).
- The privacy gate filters by labels in code. A model — brain or answering model — can
  never raise its own access.
- The decision log stores reasons and counts, not note content.

## 10. Rollout — each phase ships on its own

| Phase | Goal | Done when |
|---|---|---|
| P0 Privacy foundation | sensitivity labels + lock UI, privacy gate, provider trust, confirm-flag fix, BlockNote AI behind backend | a Private note never appears in a cloud payload (test asserts on the wire) |
| P1 Switchboard, rules only | slots, rules, `Auto` chip, route badge, decision log, Settings → Routing (Targets/Rules/Privacy/Activity) | chat routes by rules; every answer shows its route |
| P2 Brain | `LocalBrain` + instructions editor + test bench + overrides → suggested rules | brain passes the 50-query check on the chosen model |
| P3 Everywhere | remaining call sites routed; Activity shows none "not routed" | — |
| P4 Orchestrator (B) | brain gets tools + `delegate()` | after P0's permission fix, separately designed |

## 11. Open decisions for approval

1. **Default sensitivity** for existing and new content: `personal` (proposed) or `private`?
2. **When a Private item is needed** and the target is cloud: default *ask* (proposed),
   *answer local*, or *drop silently*?
3. **CloudBrain** off by default (proposed)?
4. **Slot set**: are `local / fast / strong / vision / long` the right five?
5. **Badge detail**: always show cost on the badge, or only in the ⓘ popover?
6. **Order**: P0 (privacy) before P1 (switchboard), as proposed?

## 12. As built (2026-10-04)

- **Defaults taken:** Personal for content, *ask* when a private note is needed, cloud brain
  off, the five slots, privacy first.
- **Backend:** `services/privacy.py` (gate, fail-closed), `services/routing/` (policy,
  rules, brain, switchboard, log), `routers/routing.py`, migration `029_privacy_routing.sql`.
  `local_only` only blocked tool calls before; retrieved local-only notes went into cloud
  prompts. Now retrieval, workspace sources and every read tool pass the gate.
- **Ask flow:** the turn stops before any model call and emits `privacy_needed`; the
  client re-sends with `slot=local`, `withheld_ok`, or `release=[ids]` (client-only, like
  approvals). Answers written from private notes are stored with `private: true` and a
  cloud turn sees a placeholder instead.
- **Frontend:** `Auto ▾` chip, route badge + "why" popover with Ask again on, privacy
  prompt, note Privacy selector (replaces Local-only), Settings → Routing (5 tabs).
- **Not yet routed:** ingest, workspace synthesis, background jobs (Activity / Privacy tab
  say so). Rule → spec deviation: rules reorder with up/down buttons, not drag.
