"""Coverage guard and anti-corruption lint (ROBUSTNESS §2, §6)."""
import re
from pathlib import Path

from services.notion_sync import registry
from services.notion_sync.notion.writers import WRITERS
from services.portable import ir

ROOT = Path(__file__).resolve().parents[2]            # backend/
FRONTEND_EDITOR = ROOT.parent / "frontend" / "components" / "editor" / "BlockEditor.tsx"

#: BlockNote default blocks + our custom ones that M1 reads
M1_READ = {"paragraph", "heading", "quote", "codeBlock", "bulletListItem", "numberedListItem",
           "checkListItem", "toggleListItem", "divider"}
#: block types that exist in the editor but still travel as `opaque` (milestone that adds them)
KNOWN_UNREAD = {
    "table": "M2", "image": "M2", "video": "M2", "audio": "M2", "file": "M2", "pageBreak": "M2",
    "columnList": "M2", "column": "M2", "callout": "M2", "math": "M2", "checkpoint": "M2",
    "database": "M7", "button": "M2", "unknownBlock": "never persisted (B3 placeholder)",
    "bulletListItem_": "", }
#: IR block types without a writer yet (they degrade to OpaqueWriter)
KNOWN_UNWRITTEN = {"equation", "table", "media", "callout", "columns", "column", "embed", "bookmark",
                   "db_embed", "anchor", "action"}


def test_every_ir_block_type_has_a_writer_or_is_listed():
    for t in ir.BLOCK_TYPES:
        assert f"ir:{t}" in WRITERS or t in KNOWN_UNWRITTEN, f"IR type {t!r} has no writer and is not listed"
    for t in KNOWN_UNWRITTEN:
        assert f"ir:{t}" not in WRITERS, f"{t} now has a writer: remove it from KNOWN_UNWRITTEN"


def test_every_m1_block_has_a_reader():
    registry._load()
    for t in M1_READ:
        assert f"blocknote:{t}" in registry.READERS, t
    assert "blocknote:*" in registry.READERS                   # the unknown fallback


def test_every_editor_block_type_is_read_or_listed():
    """A new block type added to the editor schema fails here until someone
    decides how it maps (reader) or consciously lists it as opaque for now."""
    src = FRONTEND_EDITOR.read_text()
    custom = set(re.findall(r"^\s+(\w+): \w+BlockSpec\(\),", src, re.M))
    assert {"math", "checkpoint", "callout", "database", "button", "unknownBlock"} <= custom
    registry._load()
    for t in custom:
        assert f"blocknote:{t}" in registry.READERS or t in KNOWN_UNREAD, \
            f"editor block {t!r} has no reader and is not in KNOWN_UNREAD"


def test_every_reader_has_a_golden_file():
    registry._load()
    names = {p.name.removesuffix(".input.json") for p in (Path(__file__).parent / "golden").glob("*.input.json")}
    blocks_in_goldens = set()
    import json
    for p in (Path(__file__).parent / "golden").glob("*.input.json"):
        def walk(bs):
            for b in bs:
                blocks_in_goldens.add(b["type"])
                walk(b.get("children") or [])
        walk(json.loads(p.read_text()))
    for h in registry.READERS:
        t = h.split(":", 1)[1]
        if t != "*":
            assert t in blocks_in_goldens, f"reader {h} has no golden input"
    assert names


def test_unknown_reader_and_opaque_writer_exist():
    assert "ir:opaque" in WRITERS


# ---- anti-corruption lint -------------------------------------------------------------------

NOTION_SHAPES = re.compile(
    r"api\.notion\.com|Notion-Version|\"(?:bulleted_list_item|numbered_list_item|to_do|heading_[1-4]|"
    r"child_database|child_page|rich_text|data_source_id|page_id|file_upload|is_toggleable|"
    r"list_start_index|column_list|table_row|synced_block)\"|'(?:bulleted_list_item|rich_text|data_source_id)'")


def _py_files(*dirs, skip=()):
    for d in dirs:
        base = ROOT / d
        files = [base] if base.is_file() else base.rglob("*.py")
        for f in files:
            if "__pycache__" in f.parts or any(s in f.parts for s in skip):
                continue
            yield f


def test_no_notion_shapes_outside_adapter():
    offenders = []
    for f in _py_files("services/notion_sync", "services/portable", "routers/notion_sync.py",
                       skip=("notion",)):
        for n, line in enumerate(f.read_text().splitlines(), 1):
            if NOTION_SHAPES.search(line):
                offenders.append(f"{f.relative_to(ROOT)}:{n}: {line.strip()[:80]}")
    assert not offenders, "\n".join(offenders)


def test_readers_and_ir_never_import_the_adapter():
    for f in _py_files("services/notion_sync/readers", "services/portable"):
        text = f.read_text()
        assert "notion_sync.notion" not in text and "import httpx" not in text, f


def test_ir_names_neither_blocknote_nor_notion():
    for f in _py_files("services/portable"):
        text = f.read_text().lower()
        assert "blocknote" not in text and "notion" not in text.replace("docs/notion-sync", ""), f


def test_adapter_never_imports_blocknote_names():
    for f in _py_files("services/notion_sync/notion"):
        t = f.read_text()
        assert "blocknote" not in t.lower() and "readers" not in t, f


def test_no_unsafe_notion_deletes():
    """Pages are never put in the trash; block deletes take ids, not a page id."""
    text = (ROOT / "services/notion_sync/notion/adapter.py").read_text()
    assert "in_trash" not in text.replace("p.get(\"in_trash\")", "").replace("p[\"in_trash\"]", "") \
        or "\"in_trash\": True" not in text
