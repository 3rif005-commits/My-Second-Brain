# Send to Notion — Research

> Written 2026-10-07. Every claim is tagged **VERIFIED** (official doc or code, link given) or
> **ASSUMPTION** (inferred; listed in §7 with the test that settles it). Raw fetch notes:
> `evidence/01-limits-and-changelog.md`, `evidence/02-*.md`, code inventory `evidence/INVENTORY.md`.
> No live Notion call has been made yet: that needs a throwaway test workspace token from you (§7).

---

## 1. The platform today

### 1.1 Version and data model
- **Latest API version `2026-03-11`**; pinned per request with the required `Notion-Version` header. Notion says it has "no plans to stop supporting older API versions" and new *non-breaking* features ship to all versions without a bump. VERIFIED — [versioning](https://developers.notion.com/reference/versioning), [changelog](https://developers.notion.com/page/changelog).
- `2026-03-11` breaking changes: block append `after` → `position` object; `archived` → `in_trash`; `transcription` → `meeting_notes`. VERIFIED — [upgrade guide](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11).
- Since `2025-09-03`: **database = container, data source = schema + rows**; one database can hold several data sources. Rows are pages whose parent is a `data_source_id`. VERIFIED — changelog 2025-08-26. *Our app already adopted this exact split* (`db_databases` / `db_data_sources`, spec §3.1).
- **Views API** (since 2026-03-19): create/update/delete/list/query views. Creatable types: table, board, list, calendar, timeline, gallery, form, chart, map, dashboard. **Not feed.** A database must always keep ≥1 view; dashboards ≤4 widgets per row, no nesting. VERIFIED — [working with views](https://developers.notion.com/guides/data-apis/working-with-views).
- **Markdown content API** (since 2026-02-26): `POST /v1/pages {markdown}`, `GET/PATCH /v1/pages/:id/markdown` (`replace_content`, `update_content`, `insert_content`). ~5,000 blocks per write, `allow_async` for big ones; bookmarks, embeds, link previews, breadcrumbs are `<unknown>` in markdown. Update refuses to delete child pages/databases unless `allow_deleting_content: true`. VERIFIED — [working with markdown](https://developers.notion.com/guides/data-apis/working-with-markdown-content).
- **Move page** (since 2026-01-15): new parent `page_id` or `data_source_id`; pages only, not databases. VERIFIED — [move page](https://developers.notion.com/reference/move-page).
- Page links now `https://app.notion.com/p/{page-id}` (2026-07-15). VERIFIED.

### 1.2 Authentication options
| Option | Identity | Sees | Expiry | Fit for us |
|---|---|---|---|---|
| **Internal connection** | a **bot** user | only pages explicitly shared with it | static | ✅ **Recommended.** Least privilege: share ONE root page ("Second Brain mirror") and the connection cannot read or damage anything else. Its bot identity is what makes Notion-side-edit detection work (`last_edited_by` ≠ bot ⇒ a human edited). |
| Personal access token (since 2026-05-12) | **you** | everything you can see | 7d–1y (2026-07-02) | ❌ Too broad (whole workspace), expires, and edits by the sync and by you look identical — detection breaks. Free workspaces: only owners may create PATs. |
| Public OAuth | bot per install | pages picked at install | access+refresh, rotating | Later, only if the app goes multi-user. Needs a registered public integration + redirect URL. |
VERIFIED — [authorization](https://developers.notion.com/docs/authorization), [PATs](https://developers.notion.com/guides/get-started/personal-access-tokens).

### 1.3 Hard limits (all VERIFIED — [request limits](https://developers.notion.com/reference/request-limits), [append children](https://developers.notion.com/reference/patch-block-children))
| Limit | Value | Design consequence |
|---|---|---|
| Rate, per connection | **180 req/min** (3/s) on Free/Plus; 600/min on Business+; 60-s fixed window (2026-09-09) | Token bucket at 2.5 req/s default, configurable. 10k notes ≈ hours on first push (see ROBUSTNESS §scale). |
| Rate, per workspace | shared across all connections (2026-06-16), unspecified number | Other tools in the workspace eat our budget → must honour 429 always. |
| 429 | `Retry-After` seconds (+ `additional_data.retry_after` in body, 2026-09-24); never retry `public_api_request_blocked` | Retry-After first, then exp. backoff + jitter, max 6 attempts. |
| 5xx | retry 500/502/503/504 **only for idempotent requests**; 529 = overload, retry identically | Creates are NOT idempotent → reconcile before retrying a create (§ ROBUSTNESS crash rules). |
| Rich text content | 2,000 chars per text object; 100 rich-text objects per array | Split long runs into ≤2,000-char objects; split paragraphs > 100 objects. |
| Equation | 1,000 chars | Longer LaTeX → code block (language `latex`) + marker. |
| URL | 2,000 chars | Data URLs / long signed URLs → must upload instead. |
| Children per append | 100 blocks; **2 nesting levels per request** | Chunk + recurse: deeper children appended in follow-up calls. |
| Payload | 1,000 block elements, 500 KB | Batch by size, not only count. |
| Arrays | multi-select 100 options; relation 100 pages; people 100 | Relation > 100 → LOSSY (see matrix). |
| Email / phone | 200 chars | — |
| Files | Free: **5 MiB per file**; paid: 5 GiB; single-part ≤ 20 MB, multi-part above; filename ≤ 900 bytes | **Free-plan Notion cannot hold most lecture PDFs.** Dry-run must show this per file. |
| Unattached upload | must attach within **1 h** or it expires; one upload can be attached many times | Upload → attach in the same job step; cache upload id per content hash for reuse. |
| Hosted file URLs read back | expire after **1 h** | Never store Notion file URLs; store our hash ↔ upload id. |
| `last_edited_time` / `created_time` | **rounded down to the minute** ([changelog](https://developers.notion.com/changelog/last-edited-time-is-now-rounded-to-the-nearest-minute)) | Time alone cannot detect an edit made in the same minute as our push → also compare `last_edited_by` + content hash. |
| Query depth | data source / view queries stop at 10,000 results (2026-04-20) | Our reconciliation must page by filter, not by one deep cursor. |
| Markdown write | ~5,000 blocks per write | Not used as main transport anyway. |

### 1.4 What can and cannot be created
- **Blocks creatable:** paragraph, heading_1–4 (`is_toggleable`), bulleted/numbered (`list_start_index`)/to_do/toggle, quote, callout (emoji / custom emoji / native icon / file icon), code (70+ languages, caption), equation, divider, table (+`table_width` only at creation, `has_column_header`, `has_row_header`), table_row, column_list (≥2 columns, each ≥1 child; `width_ratio`), image/video/audio/file/pdf (external URL or `file_upload`), embed (URL or uploaded file; **HTML via uploaded `.html`** since 2026-07-03), bookmark, breadcrumb, table_of_contents, tab (2026-03-25). VERIFIED — [block reference](https://developers.notion.com/reference/block).
- **Not creatable / special:** link_preview (read-only), template block (deprecated 2023), synced_block content cannot be updated, meeting_notes (own endpoint), child_page/child_database (via create page / create database). VERIFIED.
- **Colors:** default, gray, brown, orange, yellow, green, blue, purple, pink, red + `_background` variants — **one color per block / per rich-text run**. VERIFIED. (BlockNote uses the same nine names.)
- **Rich text:** text (bold, italic, strikethrough, underline, code, color, link), mention (page, database, date, user, link_preview, template_mention), equation. VERIFIED — [rich text](https://developers.notion.com/reference/rich-text). A mention of a page the connection cannot see comes back as "Untitled" with only the id.
- **Property schema writable:** title, rich_text, number(format), select, multi_select, status (options + groups, since 2026-03-19), date, people, files, checkbox, url, email, phone_number, formula (expression), relation (`data_source_id`, `single_property`/`dual_property`), rollup (relation + property + function), unique_id (prefix only), place. **Not writable:** verification (wiki-only), button ("API ignores button settings"). VERIFIED — [property object](https://developers.notion.com/reference/property-object).
- **Page property values read-only:** rollup, formula, created_time, created_by, last_edited_time, last_edited_by, unique_id, button. Status writes cannot create new options. People writes need Notion user ids. Date with `time_zone` must be a local time with no offset. VERIFIED — [page property values](https://developers.notion.com/reference/page-property-values).
- **Relations across two databases created in separate calls:** a relation property needs the *target* `data_source_id`, so the target must exist first. Two-way relation = `dual_property`. Consequence: **create all data sources first (without relation/rollup properties), then add relations, then rollups (they need the relation property id), then rows, then relation values.** VERIFIED (shape) + ASSUMPTION (that adding a dual relation via data-source update creates the reverse property on the target in one call — test T4).
- **Templates:** you can list data-source templates and apply one at page creation, but not create templates. Automations: no API. Buttons: no API. VERIFIED (changelog 2026-01-15; property object).
- **Trash:** `in_trash: true`. Notion's trash **permanently deletes after 30 days by default** (Enterprise can extend up to 10 years). VERIFIED — [delete & restore](https://www.notion.com/help/duplicate-delete-and-restore-content). ⇒ "Archive in Notion" through the trash is **a delayed hard delete**. Design uses a "Deleted in Second Brain" archive page instead (moved, never trashed).

### 1.5 Direct API vs Notion's hosted MCP server — **recommend the direct API**
| | Direct REST API from our backend | Notion MCP via our MCP client |
|---|---|---|
| Auth | Internal connection token, headless, bot identity | OAuth only, interactive, tokens ~8 h ([MCP](https://developers.notion.com/docs/mcp), changelog 2026-07-14) — a background job cannot refresh without you |
| Content model | Exact block objects, block ids, positions | "Notion-flavored markdown" only; too-large or heavily formatted content → `validation_error` ([tools](https://developers.notion.com/guides/mcp/mcp-supported-tools)) |
| Update in place | Per-block PATCH/insert/delete keyed by ids | Whole-content replace or string search/replace |
| Files | Full File Upload API (5 GiB paid, multi-part) | 20 MiB upload tool; attachments 5/50 MiB |
| Rate limits | Retry-After visible to us | MCP retries once if wait ≤ 2 s, else returns a tool error |
| Idempotency, ids, version pin | Under our control, `Notion-Version` pinned | Tool surface changes often: e.g. `notion-query-database-view` deprecated 2026-09-29, `notion-search` semantics changed 2026-09-02 |
| Intended use | Integrations | AI clients (Claude Code, Cursor) |
**Verdict:** direct API behind our own adapter. The MCP server is built for an AI agent to read and write a bit of Notion interactively. A permanent, exact, resumable mirror needs block ids, file uploads and headless auth, and the MCP server provides none of these. The *agent* may still use Notion MCP through our existing MCP client for ad-hoc tasks; that is a separate path and does not touch the sync.

**SDK:** the only official SDK is JavaScript ([notion-sdk-js](https://github.com/makenotion/notion-sdk-js)); Python options are community-maintained. Our backend is Python and the adapter is small, so we use **plain `httpx` behind our own adapter**. That gives one place that knows Notion's payload shapes and no third-party version drift. (ADR-03.)

---

## 2. Prior art — what others reach, lose, and get wrong

| Tool | Direction | Fidelity reached | What it loses | Identity / update | Complaints & lessons |
|---|---|---|---|---|---|
| **martian** ([repo](https://github.com/tryfabric/martian)) | MD → Notion blocks | headings, lists any depth, code, quotes, GFM alerts → callouts, tables, equations, images | headings > 3 collapse to h3; **truncates oversized content by default**; images with invalid URLs become text | none (library) | Silent truncation by default is exactly what we must not do → our rule "split, never truncate; if impossible, mark". |
| **obsidian-to-notion** (EasyChris) ([issues](https://github.com/EasyChris/obsidian-to-notion/issues)) | Obsidian → Notion | basic MD | nested lists > 4 levels → HTTP 400; long notes → 400 | Notion id in frontmatter | #52 "always creates a new page", #69 "notion id different after each sync" → **identity must live in a mapping table we own, written before the create returns** (ADR-05). |
| **Share to NotionNext** | Obsidian → Notion DB | uploads local images & PDFs | Obsidian-specific syntax | frontmatter id | Uploading files (not linking) is the reliable path. |
| **N2O Sync** ([repo](https://github.com/n2osync/n2o-lite)) | Notion ↔ Obsidian | block mapping table published | — | incremental; "updates what changed instead of dumping a second copy" | **Conflict = never overwrite; write the other version beside it** (`.conflict.md`). Same spirit as our "push as copy". |
| **Whalesync** ([docs](https://docs.whalesync.com/connectors/notion/notion-page-sync)) | 2-way, DB-centric | paragraphs, h1–h3, lists, quotes, code, toggles, tables, callouts, columns | **unsupported: synced blocks, child pages/DBs, link-to-page, equations, PDFs, files, mentions**; "no style preservation"; **200-block cap** into Notion | record ids | Even commercial sync tools give up on mentions, files and equations. Doing those well is our differentiator, and each needs its own explicit strategy. |
| **Unito** ([limits](https://guide.unito.io/limitations-notion-integration)) | 2-way, DB rows | properties | attachments, rich text, comments, **Status**; long text cut at 2,000 chars ("can lead to data loss") | record ids | Polls every 5 min (no webhooks). Truncation causing loss is a named failure. |
| **Readwise → Notion** ([docs](https://docs.readwise.io/readwise/docs/exporting-highlights/notion)) | push only | DB row per document, highlights appended | in-place edits | own mapping; **append-only** | First sync "may take several minutes"; creates its own DB in a private page. Lesson: let the tool own a root page. |
| **Notion Import** ([help](https://www.notion.com/help/import-data-into-notion)) | file → Notion | MD/HTML/CSV/DOCX/PDF | colours, complex layout; CSV "can't create rollups or formulas" | **none — "Imports add rows. They don't update existing rows, so watch for duplicates."** | Import is a one-shot copy, not a mirror. |
| **Our own `notionBlocks.ts`** (repo) | Notion clipboard → BlockNote | toggles, toggle headings, callout icon+color, inline equations | — | n/a | Already a Notion↔BlockNote mapping; reuse its tables as the reverse oracle in round-trip tests. |

**Lessons carried into the design**
1. Duplicates come from identity stored in the wrong place or written after the create. Our mapping row is written *before* the create (state `creating`) and reconciled after a crash (ROBUSTNESS §crash).
2. Every tool that "just works" does it by dropping things silently: truncation, ignored blocks, styles lost. We split instead of truncating, show a marker for anything we can't represent, and list it in the dry run.
3. Nested content and long content cause most HTTP 400s. Chunking by nesting level (2 per call), by count (100) and by bytes (500 KB) is non-negotiable.
4. Files must be uploaded, not linked: our URLs are private signed URLs that expire.
5. Nobody does mentions and relations well. Both need the two-pass id strategy (create shells → fill content).

## 3. UX prior art (patterns to reuse)
- **Obsidian Publish** ([help](https://obsidian.md/help/Obsidian+Publish/Publish+your+content)): a changes dialog with **NEW / CHANGED / UNCHANGED** tabs, checkboxes per item, an **"Add linked"** button that pulls in linked notes and media, and **deletions never pre-selected, "for safety"**. → Our dry-run preview copies this structure, and delete-propagation is opt-in per item.
- **Notion Import**: shows a progress toast, then lands you on the result. → The end of our Send flow is an "Open in Notion" link.
- **Dropbox / Google Drive** (from general product knowledge, ASSUMPTION — not re-verified this session): a small overlay badge per item (synced ✓, syncing ↻, error !), with a status panel that lists recent activity and errors. → Badges in our sidebar and an Activity page.
- **GitHub ↔ Linear**: the linked object shows a chip with the other side's id/status and a deep link. → An "In Notion" chip in the note header that opens the mirrored page.
- **Notion's own chrome** (ASSUMPTION, not re-verified live this session): top-right page header holds Share, comments, favorite, and a "•••" menu (Copy link, Duplicate, Move to, Export, Import, Connections). → "Send to Notion" goes in our "•••" menu plus a compact header chip, matching where Notion users look.

## 4. What this means for us (summary)
- The app is already modeled on Notion: the same 24 property names, the same value shapes (spec §3.3), Views config in Notion's own field names (spec §10), and the database/data-source split. **Properties and views map almost one to one.** The hard parts are blocks with no Notion twin (custom callouts, checkpoints, buttons, interactive blocks), files, timestamps, and identity.
- Our biggest structural mismatch: **notes have properties but are not database rows** in our sidebar tree, while Notion only gives properties to database rows. This is decision D1 in DESIGN.md.

## 5. Sources (all accessed 2026-10-07)
- https://developers.notion.com/reference/request-limits
- https://developers.notion.com/page/changelog
- https://developers.notion.com/reference/versioning
- https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11
- https://developers.notion.com/reference/block
- https://developers.notion.com/reference/patch-block-children
- https://developers.notion.com/docs/working-with-files-and-media
- https://developers.notion.com/docs/uploading-small-files
- https://developers.notion.com/reference/file-object
- https://developers.notion.com/reference/create-a-database
- https://developers.notion.com/reference/property-object
- https://developers.notion.com/reference/page-property-values
- https://developers.notion.com/reference/rich-text
- https://developers.notion.com/reference/move-page
- https://developers.notion.com/guides/data-apis/working-with-views
- https://developers.notion.com/guides/data-apis/working-with-markdown-content
- https://developers.notion.com/guides/data-apis/enhanced-markdown
- https://developers.notion.com/docs/authorization
- https://developers.notion.com/guides/get-started/personal-access-tokens
- https://developers.notion.com/docs/mcp
- https://developers.notion.com/guides/mcp/mcp-supported-tools
- https://developers.notion.com/changelog/last-edited-time-is-now-rounded-to-the-nearest-minute
- https://www.notion.com/help/duplicate-delete-and-restore-content
- https://www.notion.com/help/import-data-into-notion
- https://github.com/tryfabric/martian
- https://github.com/EasyChris/obsidian-to-notion/issues
- https://github.com/n2osync/n2o-lite
- https://docs.whalesync.com/connectors/notion/notion-page-sync
- https://guide.unito.io/limitations-notion-integration
- https://docs.readwise.io/readwise/docs/exporting-highlights/notion
- https://obsidian.md/help/Obsidian+Publish/Publish+your+content

## 6. Not yet researched / honest gaps
- Notion's UI layout details and Dropbox/Drive badge behaviour were not re-verified live this session (marked ASSUMPTION above).
- Whalesync's change detection method is undocumented.
- Raycast / Super / Zapier / Make Notion actions were not surveyed: they are single-action "create page" tools with no identity tracking, so they teach nothing beyond §2. Mentioned for completeness. ASSUMPTION.

## 7. Live tests that settle the ASSUMPTIONs

> **Run 2026-10-08: see `evidence/live/RESULTS.md`.** All ten answered. T2's human half and T8's "does JS run" need a person to look. New findings: the File Upload API has an extension allow-list (`.bin` rejected); text length is counted in UTF-16 units; a 1,001-char block equation was accepted; schema size cap is 50 KB.

| # | Question | How |
|---|---|---|
| T1 | Is append-children atomic, or can it half-apply on error? | Append 3 blocks where the 3rd is invalid; read back. |
| T2 | Does a block edit inside a page bump the *page's* `last_edited_time` / `last_edited_by`? | Edit a nested block as a human; read the page. |
| T3 | Where does a `child_database` created with `is_inline: true` land in the parent's content order? | Create page with blocks A,B; create inline DB; append C; read order. |
| T4 | Does adding a `dual_property` relation in one data-source update create the reverse property? | Two DBs, one update, read both schemas. |
| T5 | Does Notion accept our formula expressions verbatim (`prop("Name")`), and when does it return `unsupported`? | Push every formula in our test fixtures; diff results. |
| T6 | Can a linked database view be placed on a page via the Views API (one database shown in two pages)? | Create a view with a different parent page. |
| T7 | Free-plan file cap is really 5 MiB for uploads made by API? | Upload 4.9 and 5.1 MiB files. |
| T8 | Does an uploaded `.html` embed render an interactive block (JS allowed?) | Upload a Disco block HTML. |
| T9 | Heading-level, code-language and emoji-icon validation edge cases | Fixture page. |
| T10 | Can `created_time` / `last_edited_time` columns be *added* to a schema (values Notion-owned)? | Schema write. |
