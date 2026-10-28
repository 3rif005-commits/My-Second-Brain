"""Parse BlockNote JSON content into indexable block chunks.

Input:  note content — a list of BlockNote block objects (from notes.content).
Output: list of {"block_id": str, "chunk_index": int, "chunk_text": str}
        in depth-first traversal order; empty blocks and dividers excluded.
"""
from __future__ import annotations


def parse(content: list | None) -> list[dict]:
    """Walk the BlockNote block tree and return one dict per non-empty block."""
    if not content:
        return []
    chunks: list[dict] = []
    _walk(content, chunks)
    return chunks


def _walk(blocks: list[dict], out: list[dict]) -> None:
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "horizontalRule":
            continue
        text = _extract_text(block)
        if text:
            out.append({
                "block_id":    block.get("id", ""),
                "chunk_index": len(out),
                "chunk_text":  text,
            })
        children = block.get("children") or []
        if children:
            _walk(children, out)


def find_block_window(content: list | None, block_id: str,
                      radius: int = 3) -> tuple[list[dict], int] | None:
    """The cited block plus up to `radius` siblings either side, and the cited
    one's index in that list — for the citation hover card
    (`GET /notes/{id}/blocks/{block_id}`). A block alone is often a fragment
    (a list item, a heading), so the card shows the passage around it.
    Siblings come from the block's OWN parent list: a block inside a callout
    previews with the callout's other children. Raw BlockNote JSON, since the
    card renders it with a real BlockNote instance."""
    if not content or not block_id:
        return None
    found = _find_siblings(content, block_id)
    if found is None:
        return None
    blocks, i = found
    start = max(0, i - radius)
    return blocks[start:i + radius + 1], i - start


def _find_siblings(blocks: list, block_id: str) -> tuple[list[dict], int] | None:
    for i, block in enumerate(blocks):
        if not isinstance(block, dict):
            continue
        if block.get("id") == block_id:
            return blocks, i
        found = _find_siblings(block.get("children") or [], block_id)
        if found is not None:
            return found
    return None


def _inline_text(content) -> str:
    """Text of inline content: links (a link's words were lost), an @mention's
    note name and inline math's LaTeX."""
    parts: list[str] = []
    for inline in content or []:
        if not isinstance(inline, dict):
            continue
        if inline.get("type") == "text":
            parts.append(inline.get("text", ""))
        elif isinstance(inline.get("content"), list):          # link, etc.
            parts.append(_inline_text(inline["content"]))
        else:
            props = inline.get("props") or {}
            for key in ("noteName", "latex"):
                if isinstance(props.get(key), str) and props[key].strip():
                    parts.append(props[key])
    return " ".join(p for p in parts if p)


def _extract_text(block: dict) -> str:
    """A block's searchable text. Tables and formulas used to be skipped —
    a table's content is a dict of rows and a formula lives in props.latex —
    so a study guide's rates, comparisons and equations were never found
    (E8b)."""
    content = block.get("content")
    if block.get("type") == "table" and isinstance(content, dict):
        rows = []
        for row in content.get("rows") or []:
            cells = [_inline_text(c.get("content") if isinstance(c, dict) else c)
                     for c in row.get("cells") or []]
            rows.append(" | ".join(c.strip() for c in cells))
        return "\n".join(r for r in rows if r.strip(" |")).strip()
    if block.get("type") == "math":
        return str((block.get("props") or {}).get("latex") or "").strip()
    text = _inline_text(content).strip()
    if block.get("type") in ("image", "video", "audio", "file"):
        # The caption, not the URL: a URL is noise to a semantic search.
        caption = str((block.get("props") or {}).get("caption") or "").strip()
        text = " ".join(p for p in (text, caption) if p)
    return text
