from services.notion_sync.registry import register_reader
from services.portable import ir

from .inline import plain_of


@register_reader
class CodeReader:
    handles = "blocknote:codeBlock"
    version = 1

    def read(self, src, ctx):
        code = plain_of(src.get("content"))
        language = (src.get("props") or {}).get("language") or "text"
        return [ir.Block(
            type="code", attrs={"language": str(language)},
            inline=[ir.Text(code)] if code else [],
            src_id=str(src.get("id", "")))]
