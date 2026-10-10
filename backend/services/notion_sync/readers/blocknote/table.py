from services.notion_sync.registry import register_reader
from services.portable import ir
from services.portable.losses import Loss

from .inline import read_inline


@register_reader
class TableReader:
    handles = "blocknote:table"
    version = 1

    def read(self, src, ctx):
        content = src.get("content")
        content = content if isinstance(content, dict) else {}
        rows_src = content.get("rows") or []
        rows: list[ir.Block] = []
        for r in rows_src:
            cells: list[ir.Block] = []
            for c in (r or {}).get("cells") or []:
                losses: list[Loss] = []
                attrs: dict = {}
                inner = c
                if isinstance(c, dict) and c.get("type") == "tableCell":
                    p = c.get("props") or {}
                    for k, name in (("colspan", "colspan"), ("rowspan", "rowspan")):
                        if isinstance(p.get(k), int) and p[k] > 1:
                            attrs[name] = p[k]
                    if p.get("backgroundColor") not in (None, "default"):
                        attrs["bg"] = p["backgroundColor"]
                    if p.get("textColor") not in (None, "default"):
                        attrs["color"] = p["textColor"]
                    if p.get("textAlignment") not in (None, "left"):
                        attrs["align"] = p["textAlignment"]
                    inner = c.get("content")
                cells.append(ir.Block("table_cell", attrs=attrs, inline=read_inline(inner, losses),
                                      losses=losses))
            rows.append(ir.Block("table_row", children=cells))
        attrs = {}
        for key, name in (("headerRows", "header_rows"), ("headerCols", "header_cols")):
            if isinstance(content.get(key), int) and content[key] > 0:
                attrs[name] = content[key]
        widths = content.get("columnWidths")
        if isinstance(widths, list) and any(w for w in widths):
            attrs["custom_widths"] = True
        return [ir.Block("table", attrs=attrs, children=rows, src_id=str(src.get("id", "")))]
