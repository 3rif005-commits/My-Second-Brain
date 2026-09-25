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
- The study-guide instructions are the user's pre-harness text, byte for byte
  (restored 2026-09-24). Engine work does not rewrite them: tuning the prompt
  for the scoreboard made notes plainer, and the scoreboard did not see it.
  The experiment plan led there (E6 "a second prompt variant"); both plan docs
  now open with the incident. Only the user changes these instructions
  (Settings → Skills, or an explicit request). A change meant to improve notes
  is judged against the user-approved reference note, not structure counts —
  a higher score with plainer notes is a regression.
- A prompt is edited in its skill folder, not in a Python string. The study
  guide's two prompts moved to `skills/study-guide/` byte-for-byte (hash-checked).
- Chat only pastes skills declared for chat (or for no surface). A workspace-
  or selection-only skill in a chat prompt is instructions for a job chat
  cannot do.
- A section anchor is checked against the source pages, not trusted. The
  Markdown path sometimes pointed a whole lecture's sections at the other
  lecture; a deterministic word-overlap check moves them (E6e), and changes
  nothing on a correct note.
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
  `npm run start|dev` spawns a `next-server` GRANDCHILD that outlives its
  parent and `pkill -P`: start servers with `setsid` and stop the whole group
  (`kill -- -<pgid>`), then check the port is free.
- Never `pkill -f <pattern>` where the pattern appears in your own command line:
  it kills the shell running it. Use `pgrep -f "[l]lama-server"` or kill by pid.
  (Cost three dead shells before it was written down.)
- This machine has 3.8GB RAM. Playwright needs the generation server stopped,
  the frontend on `npm run start` rather than `next dev`, and nothing else big
  open. `app.sh` starts the dev server, which is too heavy to test against here.
- Supabase Storage also defaults to HTTP/2; source uploads died with
  `ConnectionTerminated error_code:9`, the source failed, and the AI panel had
  no jobs. `services/database.py` gives Storage an HTTP/1.1 session too.
- The side panel's thread-load effect replaced every item with the stored
  thread when a new thread got its id — wiping upload and job cards the store
  does not hold. A thread id adopted from the stream is never reloaded.
- A `/command` must not depend on one fetch of the skill list: a failed load
  silently turned `/study-guide` into a plain question (the model then ran
  the job itself and its result was dropped). The list is re-fetched on
  demand, and a model-picked job gets a card too.
- One AI panel, one component (user, 2026-09-24): the workspace renders the
  app's `Chat` bound to its note (`workspace` prop) — citation chips, priced
  jobs, per-note thread, the editor's "/" requests — and WorkspaceChat is
  gone. Results reach the workspace editor through the same draft events a
  note page answers, so a card behaves the same everywhere. Links attach like
  files (📎 → Add a link, or drop one).
- A free e2e typed "/flash" into a real note's title four times before anyone
  noticed. A test that types into a user's note must take it back out.
- One AI, one instance (user, 2026-09-24): the app layout mounts the only AI
  panel; the workspace binds it to its note through AIPanelContext instead of
  drawing a copy. ⌘K opens and focuses it everywhere; the ⌘K quick-ask box
  and its bubble are gone. The panel stays mounted while closed, so a running
  job and its cards survive closing it.
- No prices in the UI: the model can be any provider or a local one, so a
  dollar figure is meaningless. Cost stays in ai_runs for measurement only.
- An edited study guide said "Saved" but ran the old text until a restart:
  the prompt builders used constants read at import, and the user's copies
  live outside the reload watcher. They now read the skill at call time.
- A skills editor shows only what the runtime honours. `model_tier` and
  `confirm` are stored but unused, so they are not offered.
- A cache write is priced (1.25× input) even though Anthropic reports it
  outside `input_tokens`. The log charged reads and not writes, so the first
  cached call — the one that pays extra — looked cheaper than an uncached one.
- A prompt is cached by cutting it, never by rewording it: the study guide's
  fixed part is sent as its own marked block and the two parts join back
  byte for byte (E3). Judge a cache by its input tokens — output varies more
  between runs than the whole saving.
- What changes per message rides at the END of the latest user message, never
  in the system prompt. Retrieved notes inside the system prompt made every
  chat request new from its first line — uncacheable on every provider, not
  only on the one first measured (E3b; "the user can use any model").
- A cache mark ends where the next request still agrees. Marking the end of a
  message whose context is dropped on replay wrote a new entry every message
  and read none; marking the end of the QUESTION reads 64% of a chat back.
- Cached tokens are billed once. OpenAI-style `cached_tokens` and DeepSeek's
  `prompt_cache_hit_tokens` are inside `prompt_tokens`; they are split out,
  as Anthropic reports them.
- A retrieval eval needs questions its author did not write from the page.
  Hand-written questions reused the page's words and made word matching look
  like the winner (MRR 0.90 vs 0.81); questions written blind to those words
  reversed it (0.55 vs 0.69). Half-weight fusion was chosen as the best WORST
  case over both sets (E8).
- Search quality is first a coverage question: 54 of 80 notes with text had
  no descriptor, so no ranking change could ever surface them. Count what the
  index can see before tuning how it ranks.
- A model override goes to the provider that serves it: a bare `claude-…` id
  sent to OpenRouter was a 400 on every call, even with Anthropic configured.
- Index from the database, not from one screen. A note was indexed only by a
  timer in the note editor; everything the AI, imports and the workspace wrote
  stayed unsearchable. And decide "needs indexing" by content, not time:
  indexing itself bumps `updated_at`.
- A local-only note never reaches a cloud model — including for background
  work like its search descriptor.
- Measure what the model is shown before tuning a cut. The suspected
  300-character snippet cap hit 3% of blocks; the real loss was that half the
  blocks were under 40 characters (a heading, a bullet) and tables and
  formulas were never indexed. Hits with their neighbours: 15/20 -> 20/20
  correct answers, 23% cheaper (E8b).
- Find out whether a thin note is an input or an output problem before
  choosing the fix. Three lectures in one call came out at 55-80% depth each
  without touching the cap — the model wrote shorter, so reading each source
  separately would have changed nothing. Writing each chapter in its own call
  did (132-206%), at twice the cost (E9).
- An estimate follows the shape of the run it prices. The one-call estimate
  priced a chaptered guide at $0.11; it cost $0.25, and the per-run cap reads
  the estimate.
