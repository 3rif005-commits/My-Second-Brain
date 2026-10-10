# Data inventory — everything Second Brain stores (read from code, 2026-10-07)

Status legend: VERIFIED = read in code at the cited path. ASSUMPTION = inferred, needs a test.

## 1. Hierarchy objects
| Object | Storage | Key fields | Evidence |
|---|---|---|---|
| Collection (folder) | `collections` | parent_id (nested), name, description, icon (emoji, default 📁), color (hex), position | 001_initial_schema.sql VERIFIED |
| Note (page) | `notes` | collection_id, title, content (BlockNote JSONB), content_text, icon, cover_image_url, topics[], mastery_status, source_type/url/filename, is_favorited, position, is_public, local_only, sensitivity (open/personal/private), deleted_at, content_hash, created_at, updated_at | 001, 005, 009, 021, 029 VERIFIED |
| Sub-pages | **do not exist**: notes have no parent note. Hierarchy = collection tree -> notes. Only "child" relation: inline database `db_databases.parent_note_id`, and sub-items (self-relation) | VERIFIED (no parent column) |
| Database | `db_databases` | title, description (rich text JSONB), icon, cover_url, is_inline, parent_note_id, is_locked, position, deleted_at | 014 VERIFIED |
| Data source | `db_data_sources` | database_id, name, system_kind ('notes' = virtual All Notes) | 014 VERIFIED |
| Property | `db_properties` | key (8-char opaque), name, type (24 types), config, description, storage jsonb/column, result_type, position | 014 VERIFIED |
| Row | a `notes` row + `db_row_props` (properties JSONB in Notion page-property-value shape, computed JSONB, position) | 014 + spec §3.3 VERIFIED |
| Relation link | `db_relation_links` (relation_id pair, from_row, to_row, position) | 015 VERIFIED |
| View | `db_views` (type, config = Notion Views API field names verbatim, filter, sorts, is_locked) | 014 + spec §10 VERIFIED |
| Row template | `db_row_templates` (incl. repeating) | 017 VERIFIED (table exists) |
| Automation | `db_automations` (triggers + action chains) | 017 VERIFIED |
| Form submission | `db_form_submissions` | 018 VERIFIED |
| Note sources (workspace) | `note_resources`, `note_synthesis`, `note_anchors`, `resource_elements`, `resource_chunks` | 013 VERIFIED |
| Chat thread | `chat_threads` (messages JSONB, title, pinned, model_mode, archived_at) | 009 VERIFIED |
| Skill | files on disk: `<dir>/<name>/SKILL.md` + references/ (user copies override built-ins) | routers/skills_api.py VERIFIED |
| AI jobs/outputs/runs | `ai_jobs`, `ai_outputs`, `ai_runs`, `ai_job_triggers` | 020-028 VERIFIED |
| Routing/privacy | `routing_policies`, `routing_decisions` | 029 VERIFIED |
| MCP | `mcp_servers`, `mcp_audit_log`, `mcp_clients`, `mcp_grants`, `mcp_pending_changes`, `mcp_auth_requests` | 010, 023, 024 VERIFIED |
| Embeddings/index | `note_index`, `note_chunks` (vector), `fts` | 004, 007, 011 VERIFIED |
| Provider keys | `ai_providers.api_key` — **plaintext TEXT** | 012 VERIFIED |
| Profile | `profiles` (preferences JSONB) | 001 VERIFIED |

## 2. BlockNote schema (frontend/components/editor/BlockEditor.tsx:62-80), BlockNote 0.48.0
Default blocks (BlockNote 0.48): paragraph, heading (level; isToggleable), quote, codeBlock (language), bulletListItem, numberedListItem (start), checkListItem (checked), toggleListItem, table (headerRows, headerCols, columnWidths, cell colspan/rowspan, cell colors/alignment), image (url, caption, name, showPreview, previewWidth, textAlignment), video, audio, file, divider, pageBreak. ASSUMPTION: heading levels 1-6 — verify with a fixture.
Default props on most blocks: textColor, backgroundColor, textAlignment.
Styles: bold, italic, underline, strike, code, textColor, backgroundColor. Inline: text, link.
Multi-column: columnList / column (width) via @blocknote/xl-multi-column.
Custom blocks:
- `math` {latex} — block equation (customBlocks.tsx:86)
- `checkpoint` {noteId, workspaceId, resourceId, anchorType time|page|section, value, label} — jump into a source (customBlocks.tsx:263)
- `callout` {calloutType: OVERVIEW|NOTE|TIP|IMPORTANT|WARNING|CAUTION|FORMULA|ANALOGY|EXAM, calloutIcon}; content "none", body in children (customBlocks.tsx:351)
- `database` {databaseId, viewId} — inline database (DatabaseBlock.tsx:27)
- `button` {label, icon, actionsJson} (ButtonBlock.tsx:28)
Custom inline: `mention` {noteId, noteName} (note links only), `inlineMath` {latex}.
**sanitizeBlocks drops any block with an unknown type silently on load** (BlockEditor.tsx:86-90).

## 3. Data NOT in the database
- **Interactive "Disco" blocks** live only in browser localStorage `interactive-<noteId>` (NoteEditorPage.tsx:83-88). Not server-visible, not backed up, lost on another browser. -> divergence ledger.
- Skills: on disk, not in Supabase.

## 4. Files and media
- Bucket via services/workspace/storage.py (`{user_id}/{resource_id}/...`), private, signed URLs.
- Image/video/audio blocks hold a URL string. Sources of URLs:
  - pasted images: signed URL TTL 10 years (note_sources.py:176)
  - captured frames/clips/audio: **signed URL TTL 24 h** (media.py:116) — inserted into note blocks by NotePane.tsx:318-339 -> breaks after a day. -> ledger.
  - external web URLs (website viewer images, user-typed).
- No BlockNote `uploadFile` handler: the editor cannot upload a local file into a note directly (grep: none).
- Note covers `cover_image_url`, database `cover_url`: URL strings.

## 5. Reusable infrastructure
- Jobs: `services/jobs/*` is AI-skill specific (`ai_jobs.skill NOT NULL`, apply/discard statuses). Reusable PATTERNS: compare-and-set `transition(expected=...)`, `recover_stuck`, `sweep`, scheduler tick in `services/db/scheduler.py:172` (asyncio.to_thread(worker.run_due)). Not reusable as a table.
- Privacy: `services/privacy.py` — levels open/personal/private, ceilings, `released` one-time ids from the client, fail-closed lookups. Reusable directly: Notion = a destination with a ceiling.
- connected_apps: INBOUND MCP grants/pending changes — not an outbound OAuth token store. No outbound token store exists.
- Secrets: no encryption anywhere (grep encrypt/Fernet/vault: zero hits).
- Exports: Markdown (client-side `blocksToMarkdownLossy`, BlockEditor.tsx:419), PDF (print), CSV (backend db export), public share link. **No full-brain backup exists.**
- Paste-from-Notion importer `components/editor/notionBlocks.ts` (Notion clipboard JSON -> BlockNote): a reverse mapping table we can mirror and use as a round-trip oracle.
- MCP client `services/agent/mcp_client.py` (agent tool calls on external MCP servers).
