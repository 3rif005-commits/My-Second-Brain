"""Writers for the M1 block types. One class per IR type, same interface as
the reader interface (ROBUSTNESS §1.1): `handles`, `version`, `write(node, ctx)`."""
from __future__ import annotations

import json

from services.portable import ir
from services.portable.losses import Loss

from ..limits import MAX_RICH_TEXT_OBJECTS
from ..languages import map_language
from ..richtext import chunk_objects, plain_rich, rich_text
from ._base import WriteCtx, WriteResult

_BLOCK_COLORS = {"gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"}


def block_color(node: ir.Block, losses: list[Loss]) -> str:
    fg, bg = node.attrs.get("color"), node.attrs.get("bg")
    for c in (fg, bg):
        if c and c not in _BLOCK_COLORS:
            losses.append(Loss("approximated", f"The colour “{c}”.",
                               "The block uses the default colour.", "unknown_colour"))
    fg = fg if fg in _BLOCK_COLORS else None
    bg = bg if bg in _BLOCK_COLORS else None
    if bg:
        if fg:
            losses.append(Loss("lossy", "A block with both a text colour and a background.",
                               "Notion keeps the background and drops the text colour.",
                               "colour_and_highlight"))
        return f"{bg}_background"
    return fg or "default"


def _common_losses(node: ir.Block) -> list[Loss]:
    out = list(node.losses)
    if node.attrs.get("align"):
        out.append(Loss("lossy", f"Text alignment ({node.attrs['align']}).",
                        "Notion has no alignment; the text is left-aligned.", "text_align"))
    return out


def _text_block(node: ir.Block, ctx: WriteCtx, ntype: str, extra: dict | None = None,
                children_ok: bool = True) -> WriteResult:
    """A rich-text block. Text beyond 100 rich-text objects continues in
    following paragraphs of the same kind (never truncated)."""
    losses = _common_losses(node)
    objs = rich_text(node.inline, losses)
    parts = chunk_objects(objs, MAX_RICH_TEXT_OBJECTS)
    body: dict = {"rich_text": parts[0], **(extra or {})}
    color = block_color(node, losses)
    if color != "default":
        body["color"] = color
    blocks = [{"type": ntype, ntype: body}]
    if len(parts) > 1:
        losses.append(Loss("approximated", "A very long block.",
                           "It continues in the paragraphs that follow.", "long_block_split"))
        for extra_part in parts[1:]:
            blocks.append({"type": "paragraph", "paragraph": {"rich_text": extra_part}})
    if node.children:
        kids = ctx.write_children(node.children)
        losses += kids.losses
        if children_ok:
            body["children"] = kids.blocks
        else:
            losses.append(Loss("approximated", "Indented content under a block Notion cannot nest under.",
                               "It appears directly below, at the same level.", "children_flattened"))
            blocks.extend(kids.blocks)
    return WriteResult(blocks, losses)


class ParagraphWriter:
    handles = "ir:paragraph"
    version = 1

    def write(self, node, ctx):
        return _text_block(node, ctx, "paragraph")


class HeadingWriter:
    handles = "ir:heading"
    version = 1

    def write(self, node, ctx):
        level = node.attrs.get("level", 1)
        extra_losses: list[Loss] = []
        if level > 4:
            extra_losses.append(Loss("approximated", f"Heading level {level}.",
                                     "Notion's smallest heading (level 4) is used.", "heading_level"))
            level = 4
        toggle = bool(node.attrs.get("toggleable"))
        r = _text_block(node, ctx, f"heading_{level}",
                        {"is_toggleable": True} if toggle else {"is_toggleable": False},
                        children_ok=toggle)
        r.losses += extra_losses
        return r


class ListItemWriter:
    handles = "ir:list_item"
    version = 1

    def write(self, node, ctx):
        if node.attrs.get("style") == "numbered":
            r = _text_block(node, ctx, "numbered_list_item")
            start = node.attrs.get("start")
            if isinstance(start, int) and start != 1:
                # VERIFIED live 2026-10-08 (M1): Notion rejects list_start_index on
                # create and on update ("should be not present"), so a list cannot
                # start anywhere but 1.
                r.losses.append(Loss("approximated", f"A numbered list that starts at {start}.",
                                     "Notion numbers it from 1.", "list_start"))
            return r
        return _text_block(node, ctx, "bulleted_list_item")


class TodoWriter:
    handles = "ir:todo"
    version = 1

    def write(self, node, ctx):
        return _text_block(node, ctx, "to_do", {"checked": bool(node.attrs.get("checked"))})


class ToggleWriter:
    handles = "ir:toggle"
    version = 1

    def write(self, node, ctx):
        return _text_block(node, ctx, "toggle")


class QuoteWriter:
    handles = "ir:quote"
    version = 1

    def write(self, node, ctx):
        return _text_block(node, ctx, "quote")


class DividerWriter:
    handles = "ir:divider"
    version = 1

    def write(self, node, ctx):
        losses = list(node.losses)
        if node.attrs.get("was") == "page_break":
            losses.append(Loss("approximated", "A page break.", "Notion has no page breaks; a divider is used.",
                               "page_break"))
        blocks = [{"type": "divider", "divider": {}}]
        if node.children:
            kids = ctx.write_children(node.children)
            losses += kids.losses + [Loss("approximated", "Indented content under a divider.",
                                          "It appears directly below.", "children_flattened")]
            blocks += kids.blocks
        return WriteResult(blocks, losses)


def code_blocks(code: str, language_ours: str, losses: list[Loss]) -> list[dict]:
    """A code block; code longer than one block can hold continues in the next."""
    lang, kind = map_language(language_ours)
    caption: list[dict] = []
    if kind == "close":
        losses.append(Loss("approximated", f"Code language “{language_ours}”.",
                           f"It is highlighted as {lang}.", "code_language"))
        caption = plain_rich(f"lang: {language_ours}")
    elif kind == "unknown":
        losses.append(Loss("approximated", f"Code language “{language_ours}”.",
                           "Notion does not know it; the code is shown as plain text.",
                           "code_language"))
        caption = plain_rich(f"lang: {language_ours}")
    parts = chunk_objects(plain_rich(code), MAX_RICH_TEXT_OBJECTS)
    if len(parts) > 1:
        losses.append(Loss("approximated", "Very long code.",
                           "It continues in the code blocks that follow.", "long_block_split"))
    out = []
    for i, part in enumerate(parts):
        body: dict = {"rich_text": part, "language": lang}
        if caption and i == 0:
            body["caption"] = caption
        out.append({"type": "code", "code": body})
    return out


class CodeWriter:
    handles = "ir:code"
    version = 1

    def write(self, node, ctx):
        losses = _common_losses(node)
        code = "".join(i.text for i in node.inline if isinstance(i, ir.Text))
        blocks = code_blocks(code, node.attrs.get("language", ""), losses)
        if node.children:
            kids = ctx.write_children(node.children)
            losses += kids.losses + [Loss("approximated", "Indented content under a code block.",
                                          "It appears directly below.", "children_flattened")]
            blocks += kids.blocks
        return WriteResult(blocks, losses)


class OpaqueWriter:
    """Fallback for any block without a writer: its text, a visible marker, and
    the original data in a toggle. Nothing is dropped (ADR-14)."""
    handles = "ir:opaque"
    version = 1

    def write(self, node, ctx):
        losses = list(node.losses)
        kind = node.attrs.get("source_type", "unknown")
        blocks: list[dict] = []
        text_objs = rich_text(node.inline, losses)
        if text_objs:
            for part in chunk_objects(text_objs):
                blocks.append({"type": "paragraph", "paragraph": {"rich_text": part}})
        blocks.append({"type": "callout", "callout": {
            "rich_text": plain_rich(f"Not fully represented: a “{kind}” block that Notion "
                                    "cannot show. Its original data is in the toggle below."),
            "icon": {"type": "emoji", "emoji": "⚠️"}, "color": "gray_background"}})
        raw = json.dumps(node.attrs.get("raw"), ensure_ascii=False, indent=1, default=str)
        raw_losses: list[Loss] = []
        blocks.append({"type": "toggle", "toggle": {
            "rich_text": plain_rich(f"Original data ({kind})"),
            "children": code_blocks(raw, "json", raw_losses)}})
        if node.children:
            kids = ctx.write_children(node.children)
            losses += kids.losses
            blocks += kids.blocks
        return WriteResult(blocks, losses)
