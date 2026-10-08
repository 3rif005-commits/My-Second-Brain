from services.notion_sync.registry import register_reader
from services.portable import ir

from ._common import style_attrs

# the editor's callout palette: type -> (icon, colour). Editor knowledge lives in readers.
PALETTE = {
    "OVERVIEW": ("📋", "blue"), "NOTE": ("ℹ️", "gray"), "TIP": ("💡", "green"),
    "IMPORTANT": ("❗", "yellow"), "WARNING": ("⚠️", "orange"), "CAUTION": ("🛑", "red"),
    "FORMULA": ("📐", "purple"), "ANALOGY": ("💭", "brown"), "EXAM": ("🎯", "pink"),
}


@register_reader
class CalloutReader:
    handles = "blocknote:callout"
    version = 1

    def read(self, src, ctx):
        props = src.get("props") or {}
        variant = props.get("calloutType") if props.get("calloutType") in PALETTE else "NOTE"
        icon, color = PALETTE[variant]
        return [ir.Block("callout", attrs={"variant": variant, "icon": props.get("calloutIcon") or icon,
                                           "color": color},
                         children=ctx.read_children(src.get("children") or []),
                         src_id=str(src.get("id", "")))]


@register_reader
class ColumnListReader:
    handles = "blocknote:columnList"
    version = 1

    def read(self, src, ctx):
        return [ir.Block("columns", children=ctx.read_children(src.get("children") or []),
                         src_id=str(src.get("id", "")))]


@register_reader
class ColumnReader:
    handles = "blocknote:column"
    version = 1

    def read(self, src, ctx):
        w = (src.get("props") or {}).get("width")
        attrs = {"width": float(w)} if isinstance(w, (int, float)) and w > 0 else {}
        return [ir.Block("column", attrs=attrs, children=ctx.read_children(src.get("children") or []),
                         src_id=str(src.get("id", "")))]


@register_reader
class PageBreakReader:
    handles = "blocknote:pageBreak"
    version = 1

    def read(self, src, ctx):
        return [ir.Block("divider", attrs={"was": "page_break"}, src_id=str(src.get("id", "")))]
