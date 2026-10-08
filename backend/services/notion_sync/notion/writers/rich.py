"""Writers for the M2 block types: table, media, callout, columns, equation,
checkpoint (anchor), button (action)."""
from __future__ import annotations

import json
from urllib.parse import urlparse

from services.portable import ir
from services.portable.losses import Loss

from ..limits import MAX_EQUATION_CHARS, MAX_RICH_TEXT_OBJECTS
from ..richtext import chunk_objects, plain_rich, rich_text
from ._base import WriteCtx, WriteResult
from .blocks import _common_losses, _text_block, block_color, code_blocks

#: key of the placeholder the adapter replaces with an upload or an external link
SB_FILE = "__sb_file"

_EMBED_HOSTS = ("youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com", "vimeo.com", "player.vimeo.com")


# ---- table -------------------------------------------------------------------------

class TableWriter:
    handles = "ir:table"
    version = 1

    def write(self, node, ctx):
        losses = list(node.losses)
        rows = [r for r in node.children if r.type == "table_row"]
        if not rows or not any(r.children for r in rows):
            losses.append(Loss("approximated", "An empty table.", "Notion has no empty tables; a note marks the place.",
                               "table_empty"))
            return WriteResult([{"type": "paragraph", "paragraph": {"rich_text": plain_rich("(empty table)")}}], losses)
        width = max(len(r.children) for r in rows)
        out_rows = []
        merged = styled = False
        for r in rows:
            cells: list[list[dict]] = []
            for c in r.children:
                if c.attrs.get("colspan", 1) > 1 or c.attrs.get("rowspan", 1) > 1:
                    merged = True
                if c.attrs.get("bg") or c.attrs.get("color") or c.attrs.get("align"):
                    styled = True
                cl: list[Loss] = []
                objs = rich_text(c.inline, cl)
                losses += c.losses + cl
                if len(objs) > MAX_RICH_TEXT_OBJECTS:
                    head, tail = objs[:MAX_RICH_TEXT_OBJECTS - 1], objs[MAX_RICH_TEXT_OBJECTS - 1:]
                    text = "".join(o.get("text", {}).get("content", "") or
                                   o.get("equation", {}).get("expression", "") for o in tail)
                    objs = head + plain_rich(text)[:1]
                    losses.append(Loss("approximated", "A table cell with very many formatting changes.",
                                       "The end of the cell loses its formatting.", "cell_format_merged"))
                cells.append(objs)
            cells += [[] for _ in range(width - len(cells))]
            out_rows.append({"type": "table_row", "table_row": {"cells": cells}})
        if merged:
            losses.append(Loss("approximated", "Merged table cells.",
                               "Notion cannot merge cells; the text sits in the first cell, the others are empty.",
                               "table_merged_cells"))
        if styled:
            losses.append(Loss("lossy", "Table cell colours or alignment.", "They are not set in Notion.",
                               "table_cell_style"))
        if node.attrs.get("custom_widths"):
            losses.append(Loss("lossy", "Custom column widths.", "Notion uses its own widths.", "table_widths"))
        hr, hc = node.attrs.get("header_rows", 0), node.attrs.get("header_cols", 0)
        if hr > 1 or hc > 1:
            losses.append(Loss("approximated", "More than one header row or column.",
                               "Only the first row and the first column are headers.", "table_headers"))
        return WriteResult([{"type": "table", "table": {
            "table_width": width, "has_column_header": hr >= 1, "has_row_header": hc >= 1,
            "children": out_rows}}], losses)


# ---- media ---------------------------------------------------------------------------

def _kind_for(kind: str, url: str, name: str) -> str:
    if kind == "file" and (name.lower().endswith(".pdf") or urlparse(url.replace("storage:", "/")).path.lower().endswith(".pdf")):
        return "pdf"
    return kind


class MediaWriter:
    """image / video / audio / file. The bytes are not fetched here (writers are
    pure): the block carries a placeholder the adapter resolves at send time."""
    handles = "ir:media"
    version = 1

    def write(self, node, ctx):
        losses = _common_losses(node)
        url, name = node.attrs.get("url", ""), node.attrs.get("name", "")
        kind = node.attrs.get("kind", "file")
        if not url:
            losses.append(Loss("lossy", f"An empty {kind} block.", "It is left out.", "media_empty"))
            return WriteResult([], losses)
        if node.attrs.get("sized"):
            losses.append(Loss("lossy", "The size you gave the image/video.",
                               "Notion picks the size.", "media_size"))
        notion_kind = _kind_for(kind, url, name)
        body = {SB_FILE: {"url": url, "name": name, "kind": notion_kind}}
        cap = rich_text(node.inline, losses)
        if cap:
            body["caption"] = cap[:MAX_RICH_TEXT_OBJECTS]
        return WriteResult([{"type": notion_kind, notion_kind: body}], losses)


# ---- callout -------------------------------------------------------------------------

class CalloutWriter:
    handles = "ir:callout"
    version = 1

    def write(self, node, ctx):
        losses = list(node.losses)
        kids = ctx.write_children(node.children)
        losses += kids.losses
        from ..adapter_emoji import looks_like_emoji
        icon = node.attrs.get("icon") or "💡"
        if not looks_like_emoji(icon):
            losses.append(Loss("approximated", f"The callout icon “{icon}”.", "A default icon is used.",
                               "icon_dropped"))
            icon = "💡"
        color = node.attrs.get("color")
        body = {"rich_text": [], "icon": {"type": "emoji", "emoji": icon},
                "color": f"{color}_background" if color else "gray_background"}
        if kids.blocks:
            body["children"] = kids.blocks
        return WriteResult([{"type": "callout", "callout": body}], losses)


# ---- columns -------------------------------------------------------------------------

class ColumnsWriter:
    handles = "ir:columns"
    version = 1

    def write(self, node, ctx):
        losses = list(node.losses)
        cols = [c for c in node.children if c.type == "column"]
        stray = [c for c in node.children if c.type != "column"]
        written = []
        for c in cols:
            r = ctx.write_children(c.children)
            losses += r.losses
            written.append((c.attrs.get("width"), r.blocks))
        if stray:
            r = ctx.write_children(stray)
            losses += r.losses
            written.append((None, r.blocks))
        written = [(w, b) for w, b in written if b] or []
        if len(written) < 2:
            if written:
                losses.append(Loss("approximated", "A column layout with a single column.",
                                   "The content is shown without columns.", "columns_flattened"))
            return WriteResult(written[0][1] if written else [], losses)
        widths = [w if isinstance(w, (int, float)) and w > 0 else None for w, _ in written]
        known = [w for w in widths if w]
        fill = (sum(known) / len(known)) if known else 1.0
        widths = [w or fill for w in widths]
        total = sum(widths)
        cols_out = [{"type": "column", "column": {"width_ratio": round(w / total, 4), "children": b}}
                    for w, (_, b) in zip(widths, written)]
        return WriteResult([{"type": "column_list", "column_list": {"children": cols_out}}], losses)


# ---- equation ------------------------------------------------------------------------

class EquationWriter:
    handles = "ir:equation"
    version = 1

    def write(self, node, ctx):
        latex = node.attrs.get("latex", "")
        losses = list(node.losses)
        if not latex.strip():
            return WriteResult([], losses)
        if len(latex) > MAX_EQUATION_CHARS:
            losses.append(Loss("approximated", "A formula longer than Notion allows.",
                               "It appears as a LaTeX code block.", "equation_too_long"))
            return WriteResult(code_blocks(latex, "latex", losses), losses)
        return WriteResult([{"type": "equation", "equation": {"expression": latex}}], losses)


# ---- checkpoint (anchor) & button (action) -------------------------------------------

def _anchor_where(t: str, v: str) -> str:
    if t == "time":
        try:
            s = int(float(v))
            return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"
        except ValueError:
            return v
    if t == "page":
        return f"page {v}"
    return v


class AnchorWriter:
    handles = "ir:anchor"
    version = 1

    def write(self, node, ctx):
        a = node.attrs
        where = _anchor_where(a.get("anchor_type", ""), a.get("value", ""))
        text = " · ".join(x for x in (a.get("label"), where) if x) or "Checkpoint"
        losses = list(node.losses) + [Loss("approximated", "A checkpoint that jumps into a source.",
                                          "It appears as a note showing where it points.", "checkpoint_as_callout")]
        return WriteResult([{"type": "callout", "callout": {
            "rich_text": plain_rich(text), "icon": {"type": "emoji", "emoji": "📍"},
            "color": "gray_background"}}], losses)


class ActionWriter:
    handles = "ir:action"
    version = 1

    def write(self, node, ctx):
        a = node.attrs
        raw = a.get("actions")
        text = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False, indent=1, default=str)
        losses = list(node.losses) + [Loss("lossy", f"The button “{a.get('label')}”.",
                                          "Notion cannot run it; its actions are listed in a toggle.",
                                          "button_not_runnable")]
        child_losses: list[Loss] = []
        return WriteResult([{"type": "callout", "callout": {
            "rich_text": plain_rich(f"⚡ {a.get('label')}"), "icon": {"type": "emoji", "emoji": "⚡"},
            "color": "gray_background", "children": [{"type": "toggle", "toggle": {
                "rich_text": plain_rich("Button actions (not runnable in Notion)"),
                "children": code_blocks(text or "(none)", "json", child_losses)}}]}}], losses + child_losses)


class BookmarkWriter:
    handles = "ir:bookmark"
    version = 1

    def write(self, node, ctx):
        losses = list(node.losses)
        url = node.attrs.get("url", "")
        cap = rich_text(node.inline, losses)
        if not url.lower().startswith(("http://", "https://")) or len(url) > 2000:
            losses.append(Loss("approximated", "A web address Notion cannot bookmark.", "The title is kept as text.", "bookmark_dropped"))
            return WriteResult([{"type": "paragraph", "paragraph": {"rich_text": cap or plain_rich(url[:200])}}], losses)
        body = {"url": url}
        if cap:
            body["caption"] = cap[:MAX_RICH_TEXT_OBJECTS]
        return WriteResult([{"type": "bookmark", "bookmark": body}], losses)


DB_EMBED = "__sb_db_embed"


class DbEmbedWriter:
    """An inline database block. The database is a Notion database inside the host page; the
    block here is only an ANCHOR saying where it sits, so the blocks before it go before it and
    the rest after (T3). Without a database in Notion yet there is nothing to anchor."""
    handles = "ir:db_embed"
    version = 1

    def write(self, node, ctx):
        from ..richtext import DB_RESOLVER
        res = DB_RESOLVER.get()
        notion_id = res(node.attrs.get("database_id", "")) if res else None
        losses = list(node.losses)
        if not notion_id:
            return WriteResult([], losses + [Loss("approximated", "An embedded database that is not in Notion yet.",
                                                  "It appears when the database is sent.", "db_embed_pending")])
        return WriteResult([{"type": DB_EMBED, DB_EMBED: {"database_id": notion_id}}], losses)
