# Divergence ledger — our app vs Notion

> For every place where Second Brain behaves differently from Notion in a way that touches the
> mirror. **Nothing here has been changed in code.** Bucket 1 needs evidence (quoted). Bucket 2
> is for you to pick. Bucket 3 is one grouped question. Written 2026-10-07.

## Bucket 1 — INTENTIONAL (keep; the mapping is designed around it)

| # | Difference | Evidence (quoted) | Mapping consequence |
|---|---|---|---|
| I1 | Person / Created by / Last edited by always resolve to you | Notion DB spec §1: *"Person / Created by / Last edited by are built and correct, but degenerate: they always resolve to the single workspace member. Schema parity is preserved for future multi-user."* | People → the connection owner's Notion user (matrix §5). |
| I2 | No Notion-style permissions/teamspaces | spec §1 non-goals: *"One `profiles` row per user; nobody to grant to"* | Mirror uses one root page; sharing is done in Notion by you. |
| I3 | Views are shared, not per-user | spec §10: *"the app has one user, so per-user views would be complexity with no consumer."* | 1:1 view push. |
| I4 | Map view not built | STATUS.md: *"Map explicitly cut, no geocoding provider chosen"* | Nothing to push. |
| I5 | Dashboard global filters not built | STATUS.md: *"Dashboard's cross-widget global filters (research §13.4) — scope-cut at M13 kickoff."* | Nothing to push. |
| I6 | Callouts are 9 semantic types with a fixed palette, plus an icon override for pasted Notion callouts | customBlocks.tsx:334: *"A callout pasted from Notion can carry ANY emoji, not just this app's nine, so the source emoji wins"*; mastery-guide callout spec `docs/superpowers/specs/2026-07-30-mastery-guide-callout-redesign-design.md` | Callout maps to emoji + palette colour (exact visually). |
| I7 | Topics not shown as sidebar chips | NOTION_PHASE.md: *"sidebar topic chips removed — Notion only shows these in DB views"* | None. |
| I8 | Rows are notes; DB/data-source split adopted early | spec §2 decisions 2 and §3.1 | Rows = Notion pages in a data source (exact). |
| I9 | Formula engine runs backend-only and materialises results | spec §2 decision 4 | Notion recomputes; snapshot property keeps our value (matrix §5). |
| I10 | Private notes never leave the machine | privacy.py header: *"private — never leaves this machine"*; memory `project_routing_switchboard` | Sending to Notion is gated the same way (DESIGN §6.5). |

## Bucket 2 — BUG / UNINTENDED (you decide which to fix; none fixed yet)

Ranked by how much they hurt the backup's trustworthiness.

| # | Divergence | Why it's a bug (evidence) | Proposed fix | Effort | Blocks sync? |
|---|---|---|---|---|---|
| **B1** | **Interactive "Disco" blocks are stored only in browser `localStorage`** (`interactive-<noteId>`), not in the note. Another browser, the tablet, the MCP server and any backup never see them; clearing site data deletes them. | VISION.md: *"it lives in the editor, travels with the note, and works offline."* localStorage doesn't travel. Introduced in `dbdc7a8` with no recorded reason. Notion keeps embeds in the page. | Move to a real block (`interactive` custom block with `html` prop) or a `note_interactive` table; one-time client-side migration that uploads each browser's localStorage entries. | M | Yes, for these blocks (they're invisible to the server). |
| **B2** | **Captured frames/clips/audio are inserted into notes with signed URLs that expire after 24 h** (`media.py:116` `signed_url(dest, 86400)`, used by `NotePane.tsx:318-339`). After a day the image in your note is broken, in our own app. | `note_sources.py:173-176`: pasted images deliberately get 10 years because *"long-lived is the pragmatic stand-in for permanent"*. Captures were missed. Notion files never expire inside a page. | Store the **storage path** in the block (e.g. `sb-storage://<path>`) and resolve to a fresh signed URL at render time; backfill existing blocks by parsing the path out of the signed URL. | M | Partly: sync can read the path out of the expired URL and upload from storage, so the mirror is fine even before the fix. |
| **B3** | **Unknown block types are silently deleted on load** (`BlockEditor.tsx:86-90` `sanitizeBlocks` filters them out; the next autosave persists the loss). | Notion shows `unsupported` blocks and keeps them. Our prompt rule "never silently drop data". No evidence it was meant to delete. The comment says only "so useCreateBlockNote never receives unrecognized content". | Replace unknown blocks with a read-only `unknown` placeholder block that keeps the original JSON and re-emits it on save. | S | No, but the same rule applies to our mappers (they never drop). |
| B4 | Note `icon` is free text (any string); Notion only accepts real emoji / custom emoji. | 005 migration: `icon TEXT`. Nothing says non-emoji is intended. | Validate on write in the API (single grapheme emoji) or keep and map (matrix §1). | S | No (mapper handles it). |
| B5 | Plaintext secrets: `ai_providers.api_key` stored as plain TEXT. | 012 migration. No encryption anywhere (grep). Adjacent to this feature: the Notion token must NOT copy this pattern. | Introduce `services/secrets.py` (Fernet, key from env) for the Notion token, then migrate provider keys. | M | No; the Notion token uses the new store from day 1. |
| B6 | Spec drift: DatabaseBlock props are `{databaseId, viewId}` in code, `{dataSourceId, viewId}` in spec §3.2/§11.3. | spec vs `DatabaseBlock.tsx:35`. | Fix the spec text. | XS | No. |
| B7 | Form public page shows select/status questions as free text (already known). | STATUS.md known gaps. | `get_form_view` returns option config. | S | No. |

## Bucket 3 — UNKNOWN (one grouped question, with my recommendation)

| # | Difference | My recommendation |
|---|---|---|
| U1 | **Notes can't have sub-pages**; hierarchy is folder (collection) → note. In Notion any page nests. | Keep (don't add sub-pages for this feature). The mirror maps collections to pages; nothing is lost. |
| U2 | **Collections are a separate "folder" object** with a hex colour and no body. In Notion folders are just pages. | Keep. Map to pages; colour goes into the properties header. |
| U3 | BlockNote-isms Notion lacks: **both text and background colour on one block/run, text alignment, merged table cells, multi-row table headers, image width, heading levels 5–6 (if enabled)**. | Keep (they come from the editor library and you may use them). Mapping marks each one as LOSSY in the dry run. |
| U4 | **Our trash never auto-purges; Notion's purges after 30 days.** | Keep ours. For the mirror, never use Notion's trash (DESIGN §6.4). |
| U5 | **Note metadata (topics, mastery, source) are properties of a page that is not a database row** (only in the virtual "All Notes"). Notion can't do this. | This is D1 in DESIGN: choose how notes land in Notion. |

**Decided 2026-10-07:** U1–U4 keep as-is (user accepted each recommendation); U5 resolved by D1 = tree of databases. Bug fixes approved: B1, B2, B3.
