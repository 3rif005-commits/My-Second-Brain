# Fidelity matrix — Second Brain → Notion

> Every block type, inline style, property type, view type and object the app stores, mapped
> to Notion API `2026-03-11`. Inventory source: `evidence/INVENTORY.md`. Platform facts:
> `RESEARCH.md` §1 (links there). Tags: **E** EXACT · **A** APPROXIMATED (how) · **L** LOSSY
> (what is lost) · **X** IMPOSSIBLE (why + fallback). `[T#]` = settled by live test T# in
> RESEARCH §7; until then the row is an ASSUMPTION.
>
> **Universal fallback rule (applies to every L and X row):** the item still syncs. The lost
> part becomes a visible **"Not fully represented" marker**: a gray callout (⚠️) saying
> what was lost. Where the original can't be shown at all, its source travels with it (code
> block or attached JSON). The item's status becomes `synced_with_losses`, and the dry run
> lists it before anything is sent.

## 1. Page-level objects

| Ours | Notion | Status | Notes / fallback |
|---|---|---|---|
| Note title | page `title` | E | ≤2,000 chars per text object; split if longer (never truncated). |
| Note icon (emoji text, default 📄) | `icon {type:"emoji"}` | E | Non-emoji text in `icon` (it's a free TEXT column) → Notion rejects (custom emoji validated since 2026-09-25) → **A**: dropped from icon, kept in the properties header. [T9] |
| Note cover (`cover_image_url`) | `cover` via `file_upload` | E | Download from our storage / URL → upload → attach. Never link a signed URL (it leaks a bearer token and expires). External public URL → `external` if it's https and not ours. |
| Note metadata: topics, mastery_status, source_type/url/filename, is_favorited, sensitivity, created_at, updated_at | depends on D1 (DESIGN §2) | E under D1-C/D; L under D1-A | D1-A (plain pages) gives Notion pages no properties → shown as a compact "Properties" block at the top. D1-C/D (notes are rows) → real properties, exact. |
| `created_at` / `updated_at` | Notion `created_time`/`last_edited_time` are Notion-owned | X → A | Can't set Notion's timestamps (read-only, set at push time). Fallback: date properties **"Created in Second Brain"** / **"Edited in Second Brain"** with the real values. |
| Collection (folder): name, icon, description | page (title, emoji icon, description as first paragraph) | E / A | `color` (hex, e.g. `#6366f1`) has no Notion page colour → **L**: written into the page's properties header. |
| Collection nesting (`parent_id`) | child pages | E | Hierarchy preserved. |
| Ordering (`position` of notes, collections) | child order in parent | A | Notion orders children by creation and lets you place new pages via `position` (2026-01-15). Reordering existing pages via API is not documented. **Order is exact on the first push.** Later reorders → **L** until a manual "Rebuild order" (move each child in order). ASSUMPTION, test with T3. |
| Sub-pages (note under note) | — | n/a | Don't exist in our app (no `parent` on notes). Nothing to map. |
| Favorites, last_viewed_at, is_public share link | — | not sent | Per-user UI state. Notion favorites are per-user too. Share links stay ours. |
| Trash (`deleted_at`) | moved to "🗄 Deleted in Second Brain" archive page | A | Never `in_trash`: Notion purges trash after 30 days (RESEARCH §1.4). See DESIGN §6.4. |
| Privacy `sensitivity` | not a Notion concept | gate | `private` notes never leave without per-send release (DESIGN §6.5). The level is written as a property so the mirror shows it. |

## 2. Blocks (BlockNote 0.48 default schema + our custom blocks)

| Ours | Notion | Status | Notes / fallback |
|---|---|---|---|
| paragraph | paragraph | E | Text > 2,000 chars → split into several rich-text objects in the SAME block (allowed up to 100 objects); beyond that → continuation paragraphs + marker. |
| heading level 1–3 | heading_1–3 | E | |
| heading level 4 | heading_4 (since 2026-03-30) | E | |
| heading level 5–6 (if the schema allows; ASSUMPTION) | heading_4 | A | Visual level collapsed to 4; original level kept in the round-trip IR. |
| heading `isToggleable` + children | heading_N `is_toggleable: true` + children | E | |
| bulletListItem / numberedListItem / checkListItem | bulleted_list_item / numbered_list_item / to_do (`checked`) | E / A | `numberedListItem.start` → **not settable**: Notion rejects `list_start_index` (verified live, RESULTS L1). A list starting at N shows from 1 → **A**. |
| toggleListItem | toggle | E | |
| quote | quote | E | |
| codeBlock (`language`) | code (`language`) | E / A | Languages map through a table. A language Notion doesn't know → `plain text` + caption `lang: <ours>` (A). Code > 2,000 chars → several rich-text objects (≤100 → 200,000 chars). [T9] |
| divider | divider | E | |
| pageBreak | divider | A | Notion has no page break. Divider + marker "page break". |
| table (rows/cells, rich text) | table + table_row | E | `table_width` set at creation only → a column added later forces a table rebuild (delete + recreate block). |
| table `headerRows` / `headerCols` | `has_column_header` / `has_row_header` | A | Notion: at most one header row and one header column. >1 header rows → only the first is a header (L). |
| table cell colspan / rowspan | — | X → A | Notion tables have no merged cells. Fallback: the merged cell's text goes into the top-left cell, the other covered cells are left empty, and a marker is added. |
| table cell colours / alignment, `columnWidths` | — | L | Not settable through the API. Lost; listed in the dry run. |
| block `textColor` / `backgroundColor` | block `color` (one value) | E / L | Same nine colour names as BlockNote (VERIFIED: palette identical). **Both set → background wins** (L: the text colour is lost). |
| block `textAlignment` (center/right/justify) | — | L | Notion has no alignment. Lost. |
| image (url, caption, name) | image (`file_upload` or `external`) + caption | E | Our storage → upload. Public https → external. Expired signed URL → **cannot fetch** → marker "image unavailable at source" (see ledger B2). |
| image `previewWidth`, `showPreview` | — | L | Notion image width is not settable through the API. |
| video / audio / file | video / audio / file (or pdf for `.pdf`) | E | Upload. Size > plan cap (5 MiB on the free plan) → X → A: a bookmark/link to the original + marker "file too large for this Notion plan". |
| YouTube URL in video | video (external YouTube supported) | E | |
| columnList / column (`width`) | column_list / column (`width_ratio`) | E / A | Notion needs ≥2 columns and each column ≥1 child: a single column → its children flattened (A); an empty column gets an empty paragraph (A). Normalise widths to sum 1. Column nesting: 1 level. |
| **callout** {calloutType, calloutIcon} + children | callout (emoji icon, `color: <palette>_background`) + children | E (visual) / A | Palette maps 1:1 (OVERVIEW→blue, NOTE→gray, TIP→green, IMPORTANT→yellow, WARNING→orange, CAUTION→red, FORMULA→purple, ANALOGY→brown, EXAM→pink). Our callout has no own text (`content:"none"`), so Notion's callout gets empty rich text + children. The semantic *type* name isn't a Notion field; it's recoverable from icon+colour and stored in the IR. |
| **math** {latex} (block) | equation block | E | LaTeX > 1,000 chars → X → A: code block `latex` + marker. KaTeX vs our renderer differences (A, rare). |
| **checkpoint** {anchorType, value, label, resourceId} | callout 📍 "label · page 14 / 03:12" (+ link to the source file if it was sent) | A | Jump-into-source behaviour is impossible in Notion. For YouTube sources: a link with `&t=` seconds gives the same jump (E for that case). |
| **database** (inline) {databaseId, viewId} | `child_database` `is_inline:true` on the note's page | A | Position inside page content: trick = append blocks up to it, create DB, append the rest [T3]. The same database embedded in a second note → a linked view [T6], else a `link_to_page`… (link_to_page isn't in the creatable list → a page mention paragraph, A). `viewId` → that view is created first so it becomes the default. |
| **button** {label, icon, actionsJson} | — | X → A | No button block via API. Fallback: callout "⚡ label" + toggle "Button actions (not runnable in Notion)" containing the actions as readable text. |
| **interactive / Disco block** (localStorage only) | embed with uploaded `.html` (since 2026-07-03) | E (verified T8: JS runs in Notion) once B1 is fixed | **Can't be synced today: the data is not on the server** (ledger B1). After B1 is fixed: upload the HTML as a file → embed. If Notion sandboxes away JS → a static file attachment + marker. |
| unknown block type (future) | — | A | **Never throws.** Generic mapper: plain text of its inline content as a paragraph, children recursed, plus a marker "Unsupported block: <type>", and the original JSON attached as a code block inside a toggle. |

## 3. Inline content and styles

| Ours | Notion | Status | Notes |
|---|---|---|---|
| bold / italic / underline / strike / code | annotations | E | |
| textColor / backgroundColor (inline) | annotation `color` (one value) | E / L | Both on one run → background wins (L). |
| link | `text.link.url` | E | URL > 2,000 chars → text kept, link dropped + marker (L). Links to our own app (`/brain/<id>`) → rewritten to the mirrored Notion page if mapped (E), else left as text (A). |
| **mention** {noteId, noteName} | `mention {page: {id}}` | E (two-pass) | Pass 1 creates every page shell → id map; pass 2 writes content. Target **not mirrored** → plain text "@Name" (A, marked); when the target is later mirrored, this page is flagged *changed* (dependency edge) and the next push turns it into a real mention. Target in Notion trash/archive → still a mention (Notion shows it). |
| **inlineMath** {latex} | rich-text `equation` | E | ≤1,000 chars, else inline code (A). |
| hard break `\n` inside text | `\n` in text content | E | |
| emoji / unicode | text | E | Length counted the way Notion counts (UTF-16 code units — ASSUMPTION [T9]); split with margin. |

## 4. Databases

| Ours | Notion | Status | Notes |
|---|---|---|---|
| `db_databases` title, description, icon, cover | database title, description, icon, cover | E | Cover → upload. |
| `is_inline`, `parent_note_id` | `is_inline` + parent page = mirrored note | E | |
| `is_locked` | — | L | Notion's lock isn't settable via API (ASSUMPTION). Written to the description. |
| one data source per database (UI default) | `initial_data_source` | E | |
| multiple data sources | additional data sources | E | Supported since 2025-09-03; created with the database. |
| **"All Notes" virtual data source** (`system_kind='notes'`) | depends on D1 | A | Its rows ARE every note. D1-C: it *becomes* the Notes database. D1-A/D: not sent as a database (it's a view over everything); its *saved views* are sent where they apply. |
| Row = note: title, icon, cover, body | page in the data source | E | The row body is a full note → the same block pipeline. |
| Row `position` (manual order) | — | L | Notion orders by view sort; manual drag order isn't settable via API (ASSUMPTION). Fallback: a hidden-by-default number property "Order (Second Brain)" plus a view sorted by it → **A, visually exact**. |
| Sub-items / dependencies (built-in self-relations) | self `relation` (`dual_property`) | E / A | Sub-item *nesting display* in a table view = Views API "subtasks" config (A [T6]). |
| Row templates (incl. repeating) | — | X → A | Templates can't be created via API. Fallback: a "Templates (from Second Brain)" toggle page under the database, with each template as a page. Repeating schedule → text. |
| Automations | — | X | No API. Fallback: a description of each automation (trigger → actions) in a toggle on the database's parent page. |
| Form submissions (`db_form_submissions`) | — | not sent | Rate-limit bookkeeping, not content. The submitted *rows* are rows and do sync. |

## 5. Property types (all 24 in `REGISTRY`)

| Type | Notion | Status | Notes |
|---|---|---|---|
| title | title | E | |
| rich_text | rich_text | E | Same split rule (2,000 / 100). |
| number (+ format) | number (`format`) | E | Our format enum was taken from Notion's (research doc §4). Unknown format → `number` (A). "Show as" bar/ring → **L** (UI-only, not in the API). |
| select | select (options name+color) | E | We store option **ids**, Notion writes by name → the mapper resolves id→name. Options pre-created in the schema so colours stick. Duplicate option names: impossible in Notion → suffixed " (2)" (A). >100 options → L. |
| multi_select | multi_select | E | Same as select. Value with >100 options → L (rare). |
| status (options + groups) | status (options + groups, writable since 2026-03-19) | E | Groups To-do/In progress/Complete map 1:1. |
| date (start, end, time_zone) | date | E | With `time_zone` → send local time without offset (Notion rule). Our datetimes are stored with offset → converted. `is_datetime` vs date-only preserved. |
| people / created_by / last_edited_by | people (user ids) | A | Single-user app: our user → the Notion user who owns the connection (looked up once). created_by/last_edited_by are read-only in Notion and become a "Created by (SB)" people property, or are skipped (they always resolve to you). |
| files | files (`file_upload` / `external`) | E | Upload; per-plan size cap (X → A link fallback). |
| checkbox | checkbox | E | |
| url / email / phone_number | url / email / phone_number | E | Length caps 2,000/200/200 → over the cap: L with marker. |
| **formula** | formula (expression) | A [T5] | Our language is a clone of Notion Formula 2.0 using `prop("Name")`. Push the expression with property **names re-resolved to Notion names**. Notion **recomputes**; the result may differ (`now()`, our 88-function coverage). Notion may return `unsupported` for complex formulas (2026-08-05). Fallback when rejected → a rich_text/number "<name> (value from Second Brain)" with our computed value + marker. **Default (for D3): push the formula AND a hidden snapshot property**, so the backup holds our value either way. |
| relation (forward/reverse, pair) | relation `dual_property` (two-way) / `single_property` (one-way) | E | Ordering: create all data sources → add relation properties → rows → relation values (two-pass). Target row not mirrored → the link is dropped and marked (A), with the dependency recorded. >100 links on one row → L beyond 100 [ASSUMPTION]. |
| rollup | rollup (relation_property_id, rollup_property_id, function) | A | Notion recomputes. Function names come from Notion's enum (VERIFIED in our research doc §17). Snapshot property as for formulas. |
| created_time / last_edited_time | created_time / last_edited_time (Notion-owned) | X → A | Values become Notion's own push time. Fallback: date properties with our values (§1). [T10] |
| unique_id (prefix) | unique_id (prefix; number Notion-assigned) | A | Numbers assigned by Notion in creation order → rows are created in ascending ID order, so numbers match when there are no gaps. Gaps/mismatch → our number goes in a "ID (Second Brain)" text property (A). |
| place | place (lat/lon/name/address) | E | Needs coordinates. Ours without coords → text (A). |
| verification | — (wiki-only, not schema-writable) | X → A | Fallback: a select "Verification (SB)" with verified/unverified + expiry date text. |
| button | — (API ignores button schema) | X | Omitted from the schema + database-level marker listing the actions. |
| unknown future type | — | A | Generic mapper: the value's display text → a rich_text property "<name> (unsupported type <t>)". Never throws. |

## 6. Views (`db_views`, config already in Notion field names)

| Ours | Notion | Status | Notes |
|---|---|---|---|
| table | table (visibility, widths, wrap, frozen, group, subtasks) | E | Property ids re-mapped (our key → Notion property id). |
| board | board (group_by, sub-group, card props, cover, layout) | E | |
| list | list | E | |
| gallery | gallery | E | |
| calendar | calendar (date property) | E | |
| timeline | timeline (start/end, table panel, dependency arrows) | E | |
| chart | chart (column/bar/line/donut/number, axes, aggregations) | E / A | Our chart config uses Notion's names. Anything Notion rejects → the closest chart type plus a marker. |
| form | form | A | Notion's API exposes submission permissions; question config is not documented [ASSUMPTION] → questions follow visible properties. |
| dashboard (widgets) | dashboard (widgets = views; ≤4 per row) | A | >4 widgets in a row → wrapped to the next row. Cross-widget global filters: we never built them. |
| feed | — (not creatable) | X → A | Fallback: a list view named "<name> (feed)" + marker. |
| map | (we cut Map) | n/a | |
| filter (nested AND/OR) | view filter (same shape as query) | E | Relative dates ("today") supported since 2026-03-30. |
| sorts / group_by / aggregations (calculation row) | sorts / group_by / … | E / A | Calculation-row functions not in the Views API → L [ASSUMPTION]. |
| locked view | — | L | |
| view icon | — | L [ASSUMPTION] | |

## 7. Other things the app stores

| Ours | Proposed Notion form | Status | Default |
|---|---|---|---|
| Workspace sources (`note_resources`: PDF, video, YouTube, website) | a "Sources" toggle at the end of the note: file blocks (uploaded) / YouTube video / bookmark | A | **Opt-in per send** (files can be large). Section chips, anchors and per-source colours → L. |
| `note_synthesis` (AI draft) | — | not sent | It's applied into the note body already; the draft is AI working state. |
| Chat threads (`chat_threads.messages`) | page per thread under "💬 Chats": message = callout (🧑 / 🤖) with the markdown → IR → blocks; tool events → collapsed toggles | A | **Off by default** (threads can contain private retrieved text — the privacy gate applies to every note cited). |
| Skills (`SKILL.md` + references on disk) | page per skill under "🧠 Skills": frontmatter as a properties header, body as blocks, references as child pages | A | Off by default; on for "whole brain". |
| Forms (as views) | form view | see §6 | |
| Collections colour, sidebar order | properties header / creation order | A/L | |

## 8. Not worth sending (and why)

| Data | Why not |
|---|---|
| Embeddings (`note_index`, `note_chunks`, `resource_chunks`), `fts`, `content_hash`, `indexed_hash` | Derived, rebuildable, meaningless in Notion, large. |
| `content_text` | A derivative of `content`. |
| `ai_jobs`, `ai_outputs`, `ai_runs`, `routing_decisions`, `mcp_audit_log`, `mcp_pending_changes` | Ephemeral working state and logs. They belong in the local backup archive (ROBUSTNESS §backup), not the mirror. |
| `ai_providers` (API keys), `mcp_servers` (secrets), `mcp_grants` | Secrets must never leave. Hard-excluded in code (deny-list), not just by default. |
| `profiles.preferences`, favorites, last viewed | Per-user UI state. |
| `resource_elements` (PDF bboxes) | Viewer data; the original file is the backup. |
| `db_form_submissions` | Rate-limit bookkeeping. |

## 9. Score (to watch over time)
Of 100 rows above: E ≈ 52, A ≈ 33, L ≈ 9, X-with-fallback ≈ 6, silent loss = **0**. The design target is that "silent loss" stays 0 forever; a CI test enforces it (ROBUSTNESS §tests: every mapper must declare its losses).
