# Send to Notion — Robustness, tests, ADRs

> Acceptance criteria for the whole design (prompt §7b + push-only addendum). Written 2026-10-07.
> Numbers marked *est.* are estimates from documented limits; the plan measures them (M5, M9).

## 1. Small frozen core, everything else pluggable

**Frozen core** (expected to change only for a bug): `engine/` (queue, phases, dependency
resolution, CAS state machine, reconcile, kill switch), `notion_mappings`/`notion_runs` schema,
the IR envelope (`Obj`, `Block`, `Inline`, `Value`, `Loss`), the adapter's transport
(auth header, version pin, token bucket, retry policy).

**Pluggable** (expected to grow): readers (one per source block/object type), writers (one per
IR node/property/view type), the chunker's limits table, the language/colour/format tables.

### 1.1 The one interface each mapper implements
```python
class Reader(Protocol):                      # ours → IR
    handles: ClassVar[str]                   # e.g. "blocknote:callout"
    version: ClassVar[int]                   # bump = deliberate re-sync (ADR-08)
    def read(self, src: dict, ctx: ReadCtx) -> list[ir.Block]: ...   # never raises; unknown → opaque

class Writer(Protocol):                      # IR → Notion payload (pure, no I/O)
    handles: ClassVar[str]                   # e.g. "ir:callout"
    version: ClassVar[int]
    def write(self, node: ir.Block, ctx: WriteCtx) -> WriteResult: ...
    # WriteResult = payload dicts + refs to resolve (mentions/files) + losses[]
```
Registry: `registry.READERS[handles]`, `registry.WRITERS[handles]`; the engine looks up by
type string. **Missing reader → `UnknownReader` (opaque). Missing writer → `OpaqueWriter`
(paragraph + marker + raw JSON toggle).** So a missing mapper degrades and never crashes.
`mapper_set_version` = hash of all `(handles, version)` pairs, stored per mapping.

### 1.2 Worked example: you add a **Flashcard** block next year
BlockNote block `flashcard {front, back}`.
1. Add `readers/blocknote/flashcard.py`: `read()` returns `ir.Block(type="toggle", inline=front,
   children=[paragraph(back)], attrs={"variant": "flashcard"})`, with no loss (a toggle *is*
   the faithful Notion form of a flashcard).
2. Register it: one line in `registry.py`.
3. Add `tests/notion_sync/golden/flashcard.json` (input) + `.notion.json` (expected payload).
   The generic golden test picks it up.
**Engine changes: zero. Writer changes: zero** (the IR toggle writer already exists). Before
step 1, the same block would already have synced as `opaque` with a marker. Nothing is ever
lost while the mapper is missing.
If the new type is a genuinely new *concept* (say a "quiz" with scoring), you add an IR node
`quiz` plus a writer that produces the fallback. That's two files, still zero engine changes.

## 2. Anti-corruption layer
- `notion/` is the only package that knows Notion's URL, headers, JSON shapes, limits, error
  codes. A lint test (`test_no_notion_shapes_outside_adapter`) fails if any module outside
  `services/notion_sync/notion/` contains Notion block-type strings or `api.notion.com`.
- `readers/` never import from `notion/`; `notion/` never imports BlockNote prop names. The IR
  is the only shared vocabulary. A BlockNote upgrade touches readers only; a Notion API
  upgrade touches writers/adapter only.

## 3. Pin and version everything
| Thing | Pinned where | Changed how |
|---|---|---|
| Notion API version | `notion/version.py` `NOTION_VERSION = "2026-03-11"` + stored per connection | ADR-02 process (§7.3): new version → contract tests on recordings + canary → bump in one commit |
| Mapper set | `mapper_set_version` per mapping | bump → planner shows "Improved mapping available" (opt-in re-send, never automatic) |
| IR | `ir_version` | migration function `ir_v1_to_v2` (the backup archive uses it too) |
| Mapping schema | migration numbers | additive only; never drop a column the reconcile uses |
| Limits table | `notion/limits.py` | canary detects drift (§7) |

## 4. Never lose, never crash, never duplicate (crash and idempotency rules)

**State machine per mapping:** `∅ → creating → synced ⇄ (failed) → archived | detached | orphaned`.
**Create protocol (exactly-once effect without Notion idempotency keys):**
1. INSERT mapping `state='creating'`, `create_token = uuid4()` (CAS on the unique key, so a
   second worker loses).
2. Call create. For rows (D1-D): the payload carries `SB ID = <our id>` (hidden property). For
   plain pages (collections, archive): the title plus an invisible-to-reader marker can't be set,
   so we record `parent_id + created_after`.
3. On success → UPDATE `notion_id`, `state='synced'` (CAS from `creating`).
4. **On crash / timeout / 5xx between 2 and 3** → item goes to `reconcile`:
   rows: query the data source `SB ID = <our id>` → 0 hits → create again; 1 → adopt;
   >1 → adopt the oldest, move the others to the archive page, and log it (never delete).
   pages: list the parent's children created since `created_after` with that title →
   same 0/1/>1 rule.
**Update protocol:** before any write, GET the page (cheap edit check, §DESIGN 7.5). Block
operations are chunked; after each chunk the item's `cursor` (`{"phase":"blocks","done":[ids]}`)
is saved, so a restart continues where it stopped and never re-appends (re-appending would
duplicate blocks: append isn't idempotent). If T1 shows append can half-apply, the chunk
is re-read before retry to see what landed.
**Idempotency acceptance:** a second push of unchanged content makes **zero API writes** (and at
most one GET per item for the cheap edit check, which can be turned off for manual "I know
nothing changed" sends). Test: `test_second_push_zero_writes`.
**Unknown inputs:** every reader/writer is wrapped: an exception becomes an `opaque` node +
`Loss(code="mapper_error")` and a logged bug, never a failed item. Fuzz-tested (§6).

## 5. Never destructive on the Notion side
- No `DELETE /blocks` on pages we didn't create, ever. Block deletes are limited to ids found in
  our own `block_index` for that page; `test_never_deletes_foreign_blocks`.
- Pages/databases are never put `in_trash` (Notion purges trash after 30 days); deletes =
  move to `🗄 Deleted in Second Brain`.
- Blocks a human added in Notion inside a mirrored page: detected (they're not in our index) →
  the page is "edited in Notion" → your choice. Overwrite removes them only after the second click.
- Kill switch: `status='paused'` checked by the worker before **every** request (not just per item).
- Per-item pause respected by planner and worker.

## 6. Test pyramid (built to last)
| Layer | What | Where / tool | Touches real data? |
|---|---|---|---|
| Unit per mapper | every reader/writer, including losses declared | pytest, `tests/notion_sync/mappers/` | no |
| Golden files | one fixture per block type, inline style, property type, view type, object kind → expected IR → expected Notion payload | `tests/notion_sync/golden/*.json`; a test fails if a registered type has no golden | no |
| **Coverage guard** | every key in BlockNote schema, `REGISTRY` (24), view types (11) has a reader; every IR node has a writer; every L/X declares a `Loss` | introspection test | no |
| Chunker property tests | random IR trees (Hypothesis): depth 0–8, 0–5,000 blocks, texts 0–50k chars, emoji/RTL → every request ≤100 children, ≤2 levels, ≤500 KB, ≤2,000 chars/text, ≤1,000 eq.; concatenated output == input text | `hypothesis` | no |
| Engine state machine | crash at every step (fault injection between each request), resume → same final state, no duplicates | fake adapter with scripted failures | no |
| 429 / 5xx simulation | Retry-After honoured, backoff, no create retried blindly, `public_api_request_blocked` stops | fake adapter | no |
| Idempotency | push twice → second push 0 writes; push, change one block → exactly the expected PATCH | fake adapter recording calls | no |
| Notion-side edit | simulate `last_edited_by` ≠ bot; assert planner → needs-you; Overwrite / Skip / Copy each produce exactly their calls; Skip makes 0 writes | fake adapter | no |
| Privacy | private note never reaches the adapter (assert at the adapter boundary), released id goes once, deny-list tables unreadable | pytest | no |
| **Contract tests** | recorded real Notion responses (cassettes) replayed: shapes we parse, error bodies, limits | `tests/notion_sync/contract/` + `vcrpy` | recorded once from the **test** workspace |
| Round-trip fidelity | fixture brain → push to TEST workspace → read back (blocks API) → map Notion→IR with `notionBlocks.ts`-equivalent reverse table → diff vs original IR; allowed diffs = declared losses only | `evals/notion_roundtrip.py`, manual or nightly | **test workspace only** (token `NOTION_TEST_TOKEN`; refuses to run if the root page title isn't `SB-TEST-*`) |
| Live canary | §7 | scheduled | test workspace only |
| e2e browser | Send dialog on a **fixture note created by the spec and deleted in `finally`** (memory: tests touch real notes); connection pointed at the test workspace | Playwright `e2e/notion-sync.spec.ts` | creates/deletes its own note; never edits existing ones |

Guard rails for your real data: all sync tests use the fake adapter unless `NOTION_TEST_TOKEN`
is set; that token's root must be named `SB-TEST-…` or the harness aborts. No test ever reads
your real connection row.

## 7. Change detection for the outside world
### 7.1 Live canary (daily, 03:05, test workspace only)
Pushes a tiny fixture (one page with every block type, one DB with every property type + 2 views
+ 1 relation pair + 1 rollup, one 4 MB file), reads it back, diffs against the golden IR. Then
pushes again, expecting zero writes, and archives the run's pages. Failure → Health card red + bell
notification "Notion's API behaviour changed: syncing still works for unchanged types; see
details". Costs ~60 requests/day *est.*

### 7.2 Recorded-fixture contract tests
Run in CI on every commit, no network. They catch *our* regressions. The canary catches *theirs*.

### 7.3 Process for Notion changes (documented in `docs/notion-sync/NOTION_CHANGES.md`, M10)
Monthly: read https://developers.notion.com/page/changelog from the last-reviewed date (stored
in that file). For each entry: tag *irrelevant / opportunity / breaking-in-next-version*. A new
API version: branch → bump `NOTION_VERSION` → re-record cassettes from the test workspace →
run contract + round-trip + canary → merge. Deprecation notices go to STATUS.md.

## 8. Independent of Notion: the local backup archive
Notion is a *mirror*, not the backup of record. The backup of record is a **local, versioned,
self-describing archive** produced from the same IR:
```
second-brain-backup-2026-10-07T03-00Z.sbz   (zip)
  manifest.json      {format:"sbz", format_version:1, ir_version:1, app_version, created_at,
                      counts, sha256 of every file, reader versions}
  README.md          how to read this without the app (plain words)
  notes/<id>.json    raw BlockNote JSON (lossless, the original)
  notes/<id>.ir.json IR (portable)
  notes/<id>.md      human-readable markdown
  databases/<id>/{schema.json, views.json, rows.jsonl, rows.csv}
  collections.json   tree
  files/<sha256>     every stored file (dedup)
  threads/<id>.json  skills/<name>/…   (if included)
```
- Lossless for our data (raw JSON included). The IR + markdown exist so it's readable in 20
  years without the app.
- Produced by a scheduled job (daily, keep 7 daily + 4 weekly + 12 monthly), written to a
  configurable folder (default `~/SecondBrainBackups`) and optionally uploaded *as a file* to the
  Notion root page (one attachment, subject to the plan cap). That way Notion holds a restorable
  copy too, but nothing depends on Notion.
- Restore tool: `python -m tools.restore <archive> --dry-run` (M11). An untested backup is not
  a backup, so the round-trip test restores into a scratch user in CI.
- Secrets (`ai_providers`, `mcp_*`) are excluded; privacy-level `private` notes ARE included
  (the archive stays on your machine) unless you upload it to Notion, in which case private
  notes are left out of that copy.

## 9. Scale and failure budget
| Scenario | Behaviour | Numbers (*est.* at 2.5 req/s) |
|---|---|---|
| First push, 10,000 notes, avg 60 blocks, 0.3 files/note | phases; resumable; progress in Settings; can pause and resume across days | ~6 req/note → 60k req → **≈ 6.7 h** (Business plan, 8 req/s: ≈ 2 h) |
| Daily incremental (20 changed notes) | hash diff; only changed blocks patched | ~5 req/note → ~100 req → **≈ 40 s** |
| Planner over 10,000 notes | reads + hashes locally, one SQL pass; cheap edit check only for changed items | < 30 s *est.*; measured in M5 |
| Huge page (5,000 blocks, nested) | chunks of 100 / 2 levels / 500 KB | ≈ 80 req → ≈ 32 s |
| Huge database (2,000 rows, 20 props) | rows in batches, relations in phase 5 | ≈ 2,000–6,000 req → 15–40 min |
| Slow network | 30 s timeout per request; retry GET/PATCH | — |
| Notion outage | after 6 retries the item → `retryable` failure; run `partial`; auto-retry next tick with backoff up to 1 h | nothing lost |
| Partial failure | only dependents blocked; summary shows N failed + "Retry failed" | — |
| Workspace-level throttling by other tools | Retry-After honoured; bucket adapts down 20% after each 429 for 10 min | — |

### Error taxonomy
| Class | Examples (Notion code) | Message (plain words) | Recovery |
|---|---|---|---|
| retryable | `rate_limited`, 500/502/503/504, 529, timeout, `conflict_error` | "Notion is busy; we'll keep trying." | automatic backoff → next tick |
| permanent | `validation_error` (a mapper bug), `invalid_json`, file type rejected | "Notion refused part of ‘X’: <field>. Reported as a bug; the rest was sent." | marker in page; item `synced_with_losses` or failed; fix mapper → "Improved mapping" |
| needs_user | `unauthorized` (token revoked) → kill switch; `restricted_resource` / `object_not_found` (unshared/deleted); edited in Notion; over plan cap; private; `public_api_request_blocked` | each has its own sentence (DESIGN §7.6) | one button per case |

## 10. ADRs (decision · alternatives · reason)
- **ADR-01 Push only.** Alt: two-way sync. *Reason:* your decision; single source of truth; removes merge semantics entirely.
- **ADR-02 Direct REST API, not Notion MCP.** Alt: MCP through our client. *Reason:* headless auth, block ids, file uploads, version pinning (RESEARCH §1.5).
- **ADR-03 Own thin `httpx` adapter, no SDK.** Alt: community Python SDK. *Reason:* no official Python SDK; one place for shapes; no third-party version drift.
- **ADR-04 Internal connection token, one shared root page.** Alt: PAT, public OAuth. *Reason:* least privilege; bot identity makes edit detection possible; no expiry. OAuth only if multi-user.
- **ADR-05 Mapping table is the identity, written before the create.** Alt: ids in Notion only / frontmatter. *Reason:* prior-art duplicates (obsidian-to-notion #52, #69); crash reconcile needs local intent.
- **ADR-06 Block-level diff with a rebuild threshold.** Alt: always replace (markdown `replace_content` or delete-all + append). *Reason:* zero-write idempotency, preserves Notion block ids (comments/links people add), far fewer requests.
- **ADR-07 A portable IR between BlockNote and Notion, shared with the backup.** Alt: direct BlockNote→Notion. *Reason:* each side changes independently; one definition of "a note" for mirror and backup.
- **ADR-08 Mapper versions in the hash, re-sync is opt-in.** Alt: silent re-sync on upgrade. *Reason:* never surprise-rewrite 10k pages; you see "Improved mapping available".
- **ADR-09 Never `in_trash`; archive page instead.** Alt: Notion trash. *Reason:* trash purges after 30 days, a delayed hard delete.
- **ADR-10 Notion is a mirror; the `.sbz` archive is the backup of record.** Alt: Notion as the backup. *Reason:* Notion can change, go down, or cap files at 5 MiB.
- **ADR-11 Own tables, borrowed patterns, not `ai_jobs`.** Alt: reuse ai_jobs. *Reason:* ai_jobs is skill-shaped; coupling two features' state machines invites the class of lifecycle bugs the Workspaces review found.
- **ADR-12 Serial worker per connection.** Alt: parallel. *Reason:* rate limit is per connection; ordering for references; simpler crash reasoning.
- **ADR-13 Dry run before every manual send; auto-sync never overwrites or sends private.** *Reason:* your requirement "told before sending".
- **ADR-14 Losses are data.** Every mapper returns `Loss[]`; the dry run, the page marker and the status all come from it. *Reason:* "silent loss = 0" becomes testable.

## 11. Top 10 ways this breaks in the next 2 years, and what prevents each
| # | Failure | Prevention |
|---|---|---|
| 1 | Notion ships a breaking API version / changes a payload shape | Pinned `Notion-Version`; ACL confines changes to `notion/`; contract cassettes + daily canary detect it; documented upgrade process (§7.3) |
| 2 | You add a block/property type and the sync crashes or drops it | Unknown → `opaque` + marker; coverage-guard test fails CI until a mapper exists; worked example §1.2 |
| 3 | **Duplicate pages after a crash or a lost mapping** | Mapping written before create; reconcile by `SB ID` / parent+time; >1 found → archive extras, never delete |
| 4 | **Silent overwrite of edits made in Notion** | Bot identity + `last_edited_*` + block-index check; needs-you with 3 choices; dismissal = skip; auto-sync never overwrites |
| 5 | **Stale mirror** (you think Notion is current, it isn't) | Badges + header chip show "changed since last send"; daily sweep rule; Health shows last success; canary |
| 6 | **Orphaned Notion pages after deletes or moves** | Deletes → archive page (visible, restorable); moves via Move API; mapping state `orphaned` listed in Activity; "Forget/relink" tools |
| 7 | Rate limits / workspace throttling stall big pushes | Token bucket + Retry-After + adaptive slowdown; resumable cursors; runs can span days |
| 8 | Token revoked or expired | 401 → kill switch auto-on, banner, one-click reconnect; internal tokens don't expire |
| 9 | Private data leaks to Notion | Privacy gate at plan AND adapter boundary (defence in depth), fail-closed lookups, deny-list tables, tests assert nothing private reaches the adapter |
| 10 | Mapper upgrade silently rewrites everything / burns quota | Mapper version in hash; "Improved mapping available" is opt-in and shows request estimate |
| (+) | Files: free-plan 5 MiB cap, 1-h upload expiry, signed URLs | Size check in the dry run; upload→attach in one item; dedup by sha256; always upload from storage, never link signed URLs |
| (+) | Notion disappears / account lost | `.sbz` archive is the backup of record (§8) |

## 12. Push-only risks (addendum)
| Risk | Design element |
|---|---|
| Stale mirror | §11 #5: visible state everywhere + scheduled sweep + Health |
| Silent overwrite of Notion-side edits | §11 #4 and test `test_notion_side_edit_three_choices` |
| Orphaned pages after deletes/moves | §11 #6 |
| Duplicates after a lost mapping (e.g. DB restored from backup, mapping rows gone) | "Relink" mode: planner matches by `SB ID` (rows) / path+title (pages) under the root before creating; shows "Found existing page, link it?"; never auto-creates when a candidate exists |
| Partial-push recovery | per-item cursors + dependency-blocking only (§4); `test_crash_at_every_request` |
| Idempotency | `test_second_push_zero_writes` |
