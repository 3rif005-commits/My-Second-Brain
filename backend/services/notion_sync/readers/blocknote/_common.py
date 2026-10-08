from __future__ import annotations

from services.notion_sync.registry import ReadCtx
from services.portable import ir
from services.portable.losses import Loss

from .inline import read_inline


def style_attrs(src: dict) -> dict:
    """Block-level colour and alignment, only when not default."""
    props = src.get("props") or {}
    attrs: dict = {}
    if props.get("textColor") not in (None, "default"):
        attrs["color"] = props["textColor"]
    if props.get("backgroundColor") not in (None, "default"):
        attrs["bg"] = props["backgroundColor"]
    if props.get("textAlignment") not in (None, "left"):
        attrs["align"] = props["textAlignment"]
    return attrs


def make(type_: str, src: dict, ctx: ReadCtx, attrs: dict | None = None) -> ir.Block:
    losses: list[Loss] = []
    inline = read_inline(src.get("content"), losses)
    return ir.Block(
        type=type_, attrs={**style_attrs(src), **(attrs or {})}, inline=inline,
        children=ctx.read_children(src.get("children") or []),
        src_id=str(src.get("id", "")), losses=losses)
