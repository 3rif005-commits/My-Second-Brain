from services.notion_sync.registry import register_reader
from services.portable import ir
from services.portable.losses import Loss

from .inline import read_inline


def _media(kind: str):
    class Reader:
        handles = f"blocknote:{kind}"
        version = 1

        def read(self, src, ctx):
            props = src.get("props") or {}
            url = str(props.get("url") or "")
            losses: list[Loss] = []
            caption = read_inline(props.get("caption") or "", losses)
            attrs = {"kind": kind, "url": url, "name": str(props.get("name") or "")}
            if props.get("previewWidth") not in (None, 512, "512"):
                attrs["sized"] = True
            if props.get("textAlignment") not in (None, "left"):
                attrs["align"] = props["textAlignment"]
            return [ir.Block("media", attrs=attrs, inline=caption, src_id=str(src.get("id", "")),
                             losses=losses)]
    Reader.__name__ = f"{kind.title()}Reader"
    return register_reader(Reader)


for _k in ("image", "video", "audio", "file"):
    _media(_k)
