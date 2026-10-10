# Raw evidence 02 (fetched 2026-10-07)

## Blocks — https://developers.notion.com/reference/block
Creatable: audio, bookmark, breadcrumb, bulleted_list_item, callout (icon: emoji / custom emoji / native icon / file), code (70+ langs, caption), column_list (>=2 columns, each column >=1 child), column (optional width_ratio 0-1, sum 1), divider, embed (URL or file upload; HTML via uploaded .html), equation (KaTeX string), file, heading_1..heading_4 (`is_toggleable` -> children), image, numbered_list_item (`list_start_index`, `list_format`), paragraph, pdf, quote, table (table_width only at creation), table_of_contents, table_row, tab (paragraph children = tabs), to_do (checked), toggle, video.
Special: child_page (via create page), child_database (via create database), meeting_notes (own endpoint), synced_block (API does not support updating synced block content).
Read-only: link_preview, unsupported. Deprecated: template (no creation since 2023-03-27).
Colors: default, blue, brown, gray, green, orange, pink, purple, red, yellow + `_background` variants.

## Append children — https://developers.notion.com/reference/patch-block-children
- 100 block children per request; up to TWO levels of nesting per request.
- `position`: {type:"end"} | {type:"start"} | {type:"after_block", after_block:{id}} (2026-03-11).
- Atomicity: not stated -> ASSUMPTION, must test.

## Files — working-with-files-and-media, uploading-small-files, file-object
- Direct single-part <= 20MB; multi-part > 20MB; indirect import from public URL.
- Free workspaces: 5 MiB per file. Paid: 5 GiB per file. Filename <= 900 bytes.
- Destinations: file/image/pdf/audio/video blocks, embed, files property, page icon, page cover.
- Unattached upload: must attach within 1 hour, else archived/expired. Once attached, permanent.
- One file_upload id can be attached many times ("upload once, attach many times").
- Notion-hosted file URLs returned by API expire after 1 hour. `external` URLs returned as-is, never expire.
- Image block cannot hold a video (type must match).

## Create database — https://developers.notion.com/reference/create-a-database
- parent: page_id or workspace. title/description rich text (<=100). is_inline. initial_data_source {properties}. icon, cover. database_type (tasks/projects/skills) not combinable with initial_data_source.
- Needs insert-content capability (else 403).
- Schema can include status, button(?), verification(?), unique_id prefix, place, formula expression, rollup, relation {data_source_id, single_property|dual_property}.

## Property object — https://developers.notion.com/reference/property-object
- Writable schema: title, rich_text, number(format), select, multi_select, status(options+groups), date, people, files, checkbox, url, email, phone_number, formula(expression; page values read-only), relation(data_source_id, single/dual), rollup(relation_property_id, rollup_property_id, function; values read-only), place.
- created_time/created_by/last_edited_time/last_edited_by: values set by Notion (read-only). [Summarizer said schema "No" — ASSUMPTION that the column itself can be added; values never writable.]
- unique_id: prefix configurable, page number cannot be written.
- verification: "API cannot create this property through schema write" (wiki-only). [changelog 2026-03-25 says verification VALUE writable]
- button: "API ignores button settings in schema writes; does not create or change".

## Views — https://developers.notion.com/guides/data-apis/working-with-views.md
- Creatable: table, board, list, calendar, timeline, gallery, form, chart, map, dashboard. NOT feed.
- Table: property visibility, widths, wrap, frozen columns, grouping/subtasks. Board: group_by required, sub-group, card props, cover, card layout. Calendar/Timeline: date property required; timeline end date, table panel, dependency arrows. Chart: column/bar/line/donut/number, axes, aggregations. Form: submission permissions + anonymous settings only (questions not documented as configurable -> ASSUMPTION). Map: location property. Dashboard: layout read-only, managed by creating/deleting widget views; <=4 widgets per row; no nested dashboards.
- Filters/sorts same shapes as data source query; quick filters.
- A database must always have at least one view.

## Auth — https://developers.notion.com/docs/authorization ; personal-access-tokens guide
- Internal connection: static token, one workspace, sees ONLY pages explicitly shared with it.
- PAT (since 2026-05-12): user-scoped, acts with the user's full permissions; expiry 7/30/90/180d/1y; admins can revoke; Free workspaces: only owners may create by default.
- Public OAuth: access + refresh token; refresh rotates both.

## Notion MCP — https://developers.notion.com/docs/mcp , /guides/mcp/mcp-supported-tools
- Hosted remote MCP, OAuth only (interactive; tokens ~8h). Built for AI clients (Claude Code, Cursor...).
- Content in "Notion-flavored markdown". File upload tool 20 MiB; attachments 5 MiB free / 50 MiB paid.
- Too large/heavily formatted markdown -> validation_error. Rate limit: retries once if wait <= 2s, else tool error.
- No block-id-level control, no idempotency keys.

## Markdown API — working-with-markdown-content.md
- POST /v1/pages {markdown}, GET/PATCH /v1/pages/:id/markdown (replace_content, update_content old_str/new_str, insert_content position).
- ~5,000 blocks per write; allow_async for large; truncation >~20,000 blocks on read, unknown blocks as `<unknown>`.
- update refuses to delete child pages/databases unless allow_deleting_content:true.
- Bookmarks, embeds, link previews, breadcrumbs, templates -> `<unknown>` in markdown (block API needed).
- Block id preservation on replace_content: not stated -> ASSUMPTION (likely recreated).
