import json

from services.notion_sync.registry import register_reader
from services.portable import ir
from services.portable.losses import Loss


@register_reader
class MathReader:
    handles = "blocknote:math"
    version = 1

    def read(self, src, ctx):
        return [ir.Block("equation", attrs={"latex": str((src.get("props") or {}).get("latex") or "")},
                         src_id=str(src.get("id", "")))]


@register_reader
class CheckpointReader:
    handles = "blocknote:checkpoint"
    version = 1

    def read(self, src, ctx):
        p = src.get("props") or {}
        return [ir.Block("anchor", attrs={
            "anchor_type": str(p.get("anchorType") or "time"), "value": str(p.get("value") or ""),
            "label": str(p.get("label") or "")}, src_id=str(src.get("id", "")))]


@register_reader
class ButtonReader:
    handles = "blocknote:button"
    version = 1

    def read(self, src, ctx):
        p = src.get("props") or {}
        actions = p.get("actionsJson") or ""
        try:
            parsed = json.loads(actions) if isinstance(actions, str) and actions else actions
        except Exception:
            parsed = actions
        return [ir.Block("action", attrs={"label": str(p.get("label") or "Button"),
                                          "icon": str(p.get("icon") or ""), "actions": parsed},
                         src_id=str(src.get("id", "")))]


@register_reader
class DatabaseEmbedReader:
    handles = "blocknote:database"
    version = 1

    def read(self, src, ctx):
        p = src.get("props") or {}
        return [ir.Block("db_embed", attrs={"database_id": str(p.get("databaseId") or ""),
                                            "view_id": str(p.get("viewId") or "")},
                         src_id=str(src.get("id", "")))]


@register_reader
class InteractiveReader:
    """The sandboxed interactive ("Disco") block: a self-contained HTML page stored in the note (ledger B1)."""
    handles = "blocknote:interactive"
    version = 1

    def read(self, src, ctx):
        p = src.get("props") or {}
        return [ir.Block("embed", attrs={"title": str(p.get("title") or "Interactive block"), "html": str(p.get("html") or "")},
                         src_id=str(src.get("id", "")))]
