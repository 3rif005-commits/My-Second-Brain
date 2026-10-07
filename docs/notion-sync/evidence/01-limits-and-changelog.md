# Raw evidence: limits + changelog (fetched 2026-10-07)

## https://developers.notion.com/reference/request-limits
- Per-connection: Business/Enterprise 600 req/min (avg 10/s); all other plans 180 req/min (avg 3/s). (Changelog 2026-09-09: 60-second fixed window.)
- Per-workspace limit shared across all connections (added 2026-06-16), scaled by plan.
- 429 `rate_limited` + `Retry-After` (integer seconds). 2026-09-24: also `additional_data.retry_after` in body.
- 529 = overload, retry identically. Exponential backoff + jitter; 5-6 attempts max.
- Do NOT retry 429 with reason `public_api_request_blocked`.
- Retry 500/502/503/504 only for idempotent requests (GET, DELETE).
- Text content 2000 chars; link URL 2000; equation expression 1000.
- Rich text/block arrays 100 elements; multi-select 100 options; relations 100 pages; people 100.
- Any URL 2000; email 200; phone 200.
- Payload max 1000 block elements and 500KB overall.

## https://developers.notion.com/page/changelog (summary of entries)
- Latest version: 2026-03-11.
- 2026-03-11 breaking: block append `after` -> `position` object; `archived` -> `in_trash`; `transcription` -> `meeting_notes`. Template timezone param on page create. Markdown API gains update_content / replace_content.
- 2026-01-15: Move page API; page position within parent; templates (list data-source templates, `template` param on create/update, `erase_content`).
- 2026-02-26: Markdown content API (create/read/update via enhanced markdown). SDK auto-retry w/ backoff.
- 2026-03-19: Views API (8 endpoints); status property create/update; dashboard widget placement.
- 2026-03-25: tab blocks read/create; verification property writable; native icons `type:"icon"`; custom emoji listing.
- 2026-03-30: heading_4 block type; tab item icons.
- 2026-04-20: data source/view queries 10,000-result pagination depth limit.
- 2026-05-12: developer portal; personal access tokens (PATs).
- 2026-05-15: markdown insertion `insert_content.position`.
- 2026-06-08: OAuth mints fresh access/refresh tokens per authorization.
- 2026-06-16: workspace-level rate limits.
- 2026-06-29: async markdown writes `allow_async: true`.
- 2026-07-02: PAT expiration options (7/30/90/180 days, 1 year).
- 2026-07-03: HTML blocks creatable via File Upload API.
- 2026-07-15: OAuth token response includes workspace_id etc.; API links now `https://app.notion.com/p/{page-id}`; search `filter.in_trash`; data source queries `is_archived`.
- 2026-08-05: formula/rollup return `type:"unsupported"` when too complex.
- 2026-08-12: formula expressions stored as `prop("Name")` as written; `filter_properties` on page create/update.
- 2026-09-22: file uploads accept CAD/3D; octet-stream resolved by extension.
- 2026-09-23: icon URLs validated; native icons `type:"icon"`.
- 2026-09-25: custom emoji icons validated against workspace.
- 2026-09-30: custom blocks in markdown render as `<custom-block>`.
- 2026-10-06: Notion MCP rate limits consolidated into standard request limits.
- MCP: notion-query-database-view deprecated 2026-09-29; notion-search keyword-only 2026-09-02; MCP tokens ~8h (2026-07-14).
