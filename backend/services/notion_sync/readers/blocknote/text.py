from services.notion_sync.registry import register_reader

from ._common import make


@register_reader
class ParagraphReader:
    handles = "blocknote:paragraph"
    version = 1

    def read(self, src, ctx):
        return [make("paragraph", src, ctx)]


@register_reader
class HeadingReader:
    handles = "blocknote:heading"
    version = 1

    def read(self, src, ctx):
        props = src.get("props") or {}
        level = props.get("level", 1)
        level = level if isinstance(level, int) and 1 <= level <= 6 else 1
        attrs = {"level": level}
        if props.get("isToggleable"):
            attrs["toggleable"] = True
        return [make("heading", src, ctx, attrs)]


@register_reader
class QuoteReader:
    handles = "blocknote:quote"
    version = 1

    def read(self, src, ctx):
        return [make("quote", src, ctx)]
