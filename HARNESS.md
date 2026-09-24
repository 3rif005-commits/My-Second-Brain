# HARNESS.md — rules the AI layer earned

One line per rule. Each names the failure that bought it. If a line cannot name
one, delete it. Keep this under ~60 lines: it is a pilot's checklist, not a
style guide.

Method: `docs/superpowers/plans/2026-09-22-harness-experiment-plan.md`
Progress: `docs/superpowers/plans/HARNESS_PROGRESS.md`

## Spending

- Never generate on a drop. Index, then offer a priced action. (Auto-synthesis
  sent up to ~45K tokens for a note the user may only have wanted indexed, and
  charged it again on every re-synthesis.)
- Price a run before offering it, from stored data — never by asking a model.
  (`GET /notes/{id}/synthesis/estimate` reads chunk lengths.)
- One place derives dollars: `services/ai/pricing.py`. (An estimate and a
  recorded cost that disagree are worse than neither.)
- An unpriced model reports `None`, never `0.0`. ("Unknown" is not "free".)

## Trust

- Approval never arrives in tool arguments. The model writes those, and its
  context holds text ingested from PDFs, web pages and MCP servers.
  (`brain.delete_note` was guarded by `args["confirm"]`, which an injected
  sentence could satisfy.)
- Approvals are scoped to one target (`<tool>:<id>`), so approving one deletion
  cannot be replayed onto another note.
- A turn that has read untrusted text may not edit existing data or call an MCP
  server without a human. Additive tools stay open. (Private data + untrusted
  content + the ability to act is the shape of every published injection.)
- Retrieved material is announced to the model as data, not instructions — the
  cheap half of the pair whose expensive half is the gate.
- A held action is reported to the model as NOT done, in so many words.
  "Waiting for the user to confirm" read as success: 3 turns in 4, Claude told
  the user a delete the gate had held was "Done!". A gate that holds while the
  assistant claims it acted still leaves the user believing something false.

## Measuring

- Run the backend suite with `env -u PYTHONPATH`. (The ROS install on this
  machine puts `/opt/ros/jazzy` on `PYTHONPATH`; its pytest plugins crash
  collection with `unknown hook 'pytest_launch_collect_makemodule'`.)
- The ~448 database tests need Postgres on `127.0.0.1:55432`; without it they
  error at setup. That is the environment, not a regression.
- A note cut off at the output cap says so, in the note (a WARNING callout)
  and in the eval (`truncated`). The first real two-document case hit the 16K cap
  on every run and the note simply ended mid-section, unmarked. The cap is
  now 32K (E13: guides from two long real documents ran 14.7K–25.6K tokens).
- A result on one kind of source is not a result on another. Markdown matched
  HTML on long AI-generated study guides (E6b) and lost half the tables on real
  slides (E6c) — the default was flipped overnight and reverted by morning.
- A pass-rate guardrail cannot see a note that got shorter. Check a token
  saving against content density (text, anchors, callouts) before calling it a
  saving. (E6 on Claude: −68% output tokens at an equal pass rate was mostly
  the model writing 44% less and citing the source 42% less.)

## The loop

- Tool names are translated per dialect. Anthropic accepts only
  `[a-zA-Z0-9_-]`, every tool here is dotted, and the API refused every
  tool-using request — Claude had never run the loop while the suite was green.
- A tool's schema is read from `parameters` OR `input_schema`. Reading one key
  sent every brain tool with no arguments, and the model guessed them.
- Test fixtures use the shape the real code declares. Both defects above
  passed because the fixtures were written in the shape the converter expected.
- An eval scores a provider error as an error, quoting it — never as a model
  that chose to do nothing.
- Every `tool_call` gets exactly one `tool` reply — success, denial, error, or
  waiting-on-approval. (An unanswered `tool_call_id` is a 400 from the provider,
  and a refusal the model cannot see is one it repeats.)
- An approval-pending reply tells the model to stop and say what it would do.
  (Otherwise it spends every remaining round retrying the same blocked call.)
- Tool results are capped, with the truncation notice written as an instruction.
  (A result is re-sent on every later round of the same turn; a silent stump
  teaches the model nothing about narrowing its next call.)
- One provider chain for every surface. (The agent had its own
  `settings.api_provider`, whose `anthropic` branch returned the Messages API
  URL for an OpenAI-shaped payload — broken on the first request.)
- Work that would exceed its cost ceiling is refused before it is sent, with the
  estimate and the ceiling in the message. An agent turn is checked between
  rounds, never during one — a call already paid for is left to finish.
- An unpriced model never trips the cap. (Refusing work because our price list
  is incomplete would be the wrong failure.)
- The engine keeps ONE history format (OpenAI-shaped) and the stream adapter
  translates per provider. (Two history formats in the loop would mean every
  tool-handling branch existed twice.)
- Discovery results are cached for minutes, failures never. (A server that was
  down a minute ago may be up now; caching the empty list hides its tools.)
- Tests never reach the real Supabase project (autouse guard in
  `tests/conftest.py`). The run log writes from inside `usage.track` and is
  failure-tolerant by design, so the suite quietly wrote 21 rows into
  production `ai_runs` before anyone looked.
- The Supabase client talks HTTP/1.1. Its one long-lived HTTP/2 connection is
  ended by the server after ~700 streams and httpx does not retry the request
  on it — the first live compare-sources run lost a source mid-processing and
  then the skill run itself to `ConnectionTerminated`, before any model call.
- A migration is not live when the SQL succeeds: PostgREST caches the schema,
  and inserts fail for a while with an error naming the new table. Re-check
  before concluding the code is wrong.
- A provider with no balance is not a fallback: it is a guaranteed failure on
  every call. `AI_DISABLED_PROVIDERS` takes it out of the chain. The local model
  is never dropped — it is the floor.
- An OpenAI-compatible gateway can answer 200 and put the failure inside the
  stream. Raise on `error` in a chunk. (Reading only `delta.content` turned an
  overloaded provider into an empty string and a successful-looking call, and an
  eval blamed the model for it.)
- Tests never read provider configuration from the developer's `.env` either.
  (`AI_DISABLED_PROVIDERS=anthropic` was legitimate local config and it broke
  three routing tests — a test isolation bug, not a routing bug.)
- A skill may not be auto-selected unless it says `auto: true`. (Same rule
  Notion settles on, and the reason the workspace stopped generating unasked.)
- Progressive disclosure buys nothing until the bodies or the catalogue are
  large: with two 30-character skills the index costs MORE than the bodies it
  replaces. Measure before switching `AGENT_SKILL_DISCLOSURE` to "index".
  (Measured on Claude: index loads the right skill 5/5, but with four skills a
  turn that needs one costs +46%. Inline stays default until the catalogue grows.)
- An eval that cannot see an engine-handled tool records the event it emits.
  (`skill.load` never reaches the eval's fake brain; "0 loads" was a blind spot,
  not a result.)
- `ai_runs.user_id` and `note_id` are uuid columns: anything else is dropped
  before the insert. (The eval runner passed the literal "eval"; Postgres
  rejected every row with an error that never said "ai_runs", it was logged at
  debug, and a full day of runs went unrecorded while the table looked empty.)
- A rejected telemetry row warns once per distinct error. Silent failure is how
  the above stayed hidden.
- An agent eval case must carry the approvals the UI would replay. A turn that
  reads retrieved note text cannot edit an existing note unasked — the harness
  surfaced that the first time a case tried to.
- Surfaces whose client parses the upstream bytes (BlockNote's xl-ai, the AI
  SDK) get `services/ai/passthrough`: forward untouched, tee the stream. They
  are logged and budgeted without anyone owning a wire contract only a browser
  can verify.
- The editor's xl-ai transport is `createOpenAI(...).chat(model)`. Calling the
  provider directly selects the Responses API, `/agent/inline` forwards to
  chat/completions, and every editor AI edit got a 400 the user never saw —
  found only when a live pass ran stock "Improve Writing".
- The AI menu keeps the selection it was opened on. Going read-only sometimes
  collapsed it, and the menu silently offered "continue writing" instead of
  acting on the selected text. Remember on press, restore after open and
  before a run, and only onto the same document.
- A selection skill must ASK for the selection surface. "No surfaces means
  anywhere" is right for agent instructions and wrong for a button that
  edits the user's text.
- A passthrough logs upstream errors on the server as well as sending them to
  the client. (The editor's 400 left no trace anywhere.)
- Don't tell a model not to copy something — don't show it. "Never write the
  source's ID labels (DEF-01, INS-06)" changed nothing (1/5 leaked before and
  after); stripping the ID column from skill sources made it 0/5 (E14).
- A prompt is edited in its skill folder, not in a Python string. The study
  guide's two prompts moved to `skills/study-guide/` byte-for-byte (hash-checked).
- Chat only pastes skills declared for chat (or for no surface). A workspace-
  or selection-only skill in a chat prompt is instructions for a job chat
  cannot do.
- A skill reaches the workspace action bar only if it declares an `output`. No
  output means there is nowhere to put the result — those are agent
  instructions (cite-everything), not jobs.
- The UI shows the estimate before a run and the real cost after it, and says
  "estimated" when the numbers are ours rather than the provider's. A promise
  and a receipt are different claims.
- A free-tier model is priced at exactly zero, and "≈$0.000" reads as broken.
  Say "free", and still say the token count — free of price is not free of time.
  (Caught by the first live pass, not by any unit test.)
- Stop only the processes you started, by the pid you recorded. Stopping
  "whatever listens on :3000" killed the user's own app.sh frontend. And
  `npm run start|dev` spawns a `next-server` that outlives its parent: stop
  the children (`pkill -P <pid>`) before the pid, then check the port.
- Never `pkill -f <pattern>` where the pattern appears in your own command line:
  it kills the shell running it. Use `pgrep -f "[l]lama-server"` or kill by pid.
  (Cost three dead shells before it was written down.)
- This machine has 3.8GB RAM. Playwright needs the generation server stopped,
  the frontend on `npm run start` rather than `next dev`, and nothing else big
  open. `app.sh` starts the dev server, which is too heavy to test against here.
