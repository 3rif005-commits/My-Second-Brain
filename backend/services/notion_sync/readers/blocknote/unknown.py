from services.notion_sync.registry import opaque_block, register_reader
from services.portable.losses import Loss


@register_reader
class UnknownReader:
    """Any block type without its own reader. Never throws, never drops."""
    handles = "blocknote:*"
    version = 1

    def read(self, src, ctx):
        t = src.get("type", "?") if isinstance(src, dict) else "?"
        return [opaque_block(src, [Loss(
            "lossy", f"A “{t}” block, which this app cannot yet show in Notion.",
            "It appears as a note in the page, with its original data in a toggle.",
            "unsupported_block")])]
