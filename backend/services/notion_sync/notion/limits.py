"""Limits of the Notion API (RESEARCH §1.3, verified by evidence/live/RESULTS.md).
Every number is used in exactly one place so a drift is a one-line fix."""

#: rich-text content is counted in UTF-16 code units (T9: 1,001 emoji = 2,002 -> 400)
MAX_TEXT_UNITS = 2000
MAX_RICH_TEXT_OBJECTS = 100
MAX_CHILDREN = 100
#: top-level block + 2 nested levels per request (VERIFIED live: a 4th level is
#: rejected, column_list > column > block is accepted). Counted including the top block.
MAX_DEPTH = 3
#: documented 1,000 block elements and 500 KB per request; keep a margin
MAX_ELEMENTS = 1000
MAX_PAYLOAD_BYTES = 450_000
MAX_URL_CHARS = 2000
MAX_EQUATION_CHARS = 1000

#: ~3 requests/s average per integration; we stay under it (DESIGN §6.3)
RATE_PER_SECOND = 2.5
RATE_BURST = 3
MAX_ATTEMPTS = 6
REQUEST_TIMEOUT_S = 30
