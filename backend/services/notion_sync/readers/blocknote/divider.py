from services.notion_sync.registry import register_reader
from services.portable import ir


@register_reader
class DividerReader:
    handles = "blocknote:divider"
    version = 1

    def read(self, src, ctx):
        return [ir.Block(type="divider", src_id=str(src.get("id", "")))]
