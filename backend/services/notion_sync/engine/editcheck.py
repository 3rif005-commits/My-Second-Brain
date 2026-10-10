"""Did someone change the page in Notion since our last send? (DESIGN §7.5)

Cheap check: the page's last editor is not our bot (T2: edits to nested blocks
bump the page, so one read suffices). Deep check: the page has top-level blocks
we did not create (people add blocks; a later edit by another tool could hide
them from the cheap check). Nothing here writes.
"""
from __future__ import annotations

import difflib

from services.notion_sync.connection import Connection
from services.notion_sync.notion.adapter import NotionAdapter
from services.notion_sync.notion.errors import NotionError

MAX_DIFF_LINES = 400


def diff_lines(notion_now: str, ours: str) -> list[dict]:
    a, b = notion_now.splitlines(), ours.splitlines()
    out: list[dict] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op == "equal":
            out += [{"op": "same", "text": t} for t in a[i1:i2]]
        else:
            out += [{"op": "notion", "text": t} for t in a[i1:i2]]      # only in Notion now
            out += [{"op": "ours", "text": t} for t in b[j1:j2]]        # what we would send
    return out[:MAX_DIFF_LINES]


def check(adapter: NotionAdapter, conn: Connection, mapping: dict, ours_markdown: str) -> dict | None:
    """-> None when it is safe to write, else why not (with the diff for the UI)."""
    page_id = mapping["notion_id"]
    info = adapter.get_page(page_id)
    if info.unreachable:
        return {"reason": "unreachable"}
    try:
        bi = mapping.get("block_index") or {}
        index = {e["id"] for e in bi.get("top") or []}
        if bi.get("pending"):       # a send of ours died mid-append: those blocks are ours, not a person's
            index |= {e["id"] for e in adapter.reclaim_pending(page_id, bi["pending"], set(index))}
        foreign = [b for b in adapter.top_level_ids(page_id, content_only=True) if b not in index]
    except NotionError:
        foreign = []
    edited = bool(conn.bot_user_id and info.last_edited_by and info.last_edited_by != conn.bot_user_id)
    if not edited and not foreign:
        return None
    try:
        now_md = adapter.page_markdown(page_id)
    except NotionError:
        now_md = ""
    return {"reason": "edited_in_notion", "edited_at": info.last_edited_time, "foreign_blocks": len(foreign),
            "diff": diff_lines(now_md, ours_markdown)}
