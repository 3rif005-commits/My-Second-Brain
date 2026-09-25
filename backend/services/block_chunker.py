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


def _inline_text(content) -> str:
    """Text of inline content, links included (a link's words were lost)."""
    parts: list[str] = []
    for inline in content or []:
        if not isinstance(inline, dict):
            continue
        if inline.get("type") == "text":
            parts.append(inline.get("text", ""))
        elif isinstance(inline.get("content"), list):          # link, etc.
            parts.append(_inline_text(inline["content"]))
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
    return _inline_text(content).strip()
