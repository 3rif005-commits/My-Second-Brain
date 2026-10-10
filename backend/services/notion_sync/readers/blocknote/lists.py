from services.notion_sync.registry import register_reader

from ._common import make


@register_reader
class BulletReader:
    handles = "blocknote:bulletListItem"
    version = 1

    def read(self, src, ctx):
        return [make("list_item", src, ctx, {"style": "bullet"})]


@register_reader
class NumberedReader:
    handles = "blocknote:numberedListItem"
    version = 1

    def read(self, src, ctx):
        attrs = {"style": "numbered"}
        start = (src.get("props") or {}).get("start")
        if isinstance(start, int) and start != 1:
            attrs["start"] = start
        return [make("list_item", src, ctx, attrs)]


@register_reader
class CheckReader:
    handles = "blocknote:checkListItem"
    version = 1

    def read(self, src, ctx):
        return [make("todo", src, ctx,
                     {"checked": bool((src.get("props") or {}).get("checked"))})]


@register_reader
class ToggleReader:
    handles = "blocknote:toggleListItem"
    version = 1

    def read(self, src, ctx):
        return [make("toggle", src, ctx)]
