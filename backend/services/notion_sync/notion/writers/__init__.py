"""IR -> Notion block payloads. `WRITERS` is the registry (ROBUSTNESS §1.1)."""
from __future__ import annotations

import logging

from services.portable import ir
from services.portable.losses import Loss

from ._base import WriteCtx, WriteResult
from .rich import (ActionWriter, AnchorWriter, CalloutWriter, ColumnsWriter, EquationWriter,
                   MediaWriter, TableWriter, DbEmbedWriter, BookmarkWriter)
from .blocks import (CodeWriter, DividerWriter, HeadingWriter, ListItemWriter,
                     OpaqueWriter, ParagraphWriter, QuoteWriter, TodoWriter, ToggleWriter)

log = logging.getLogger(__name__)

WRITERS = {w.handles: w for w in (
    ParagraphWriter(), HeadingWriter(), ListItemWriter(), TodoWriter(), ToggleWriter(),
    QuoteWriter(), CodeWriter(), DividerWriter(), OpaqueWriter(), TableWriter(), MediaWriter(),
    CalloutWriter(), ColumnsWriter(), EquationWriter(), AnchorWriter(), ActionWriter(), DbEmbedWriter(), BookmarkWriter())}


def write_block(node: ir.Block) -> WriteResult:
    writer = WRITERS.get(f"ir:{node.type}")
    fallback = False
    if writer is None:
        writer, fallback = WRITERS["ir:opaque"], True
    ctx = WriteCtx(write_children=write_blocks)
    try:
        res = writer.write(node, ctx)
    except Exception:                      # a writer must never fail a send
        log.exception("writer %s failed", writer.handles)
        res = WRITERS["ir:opaque"].write(_as_opaque(node), ctx)
        res.losses.append(Loss("lossy", f"A “{node.type}” block could not be converted.",
                               "It is kept as a note in the page.", "mapper_error"))
        return res
    if fallback:
        res.losses.append(Loss("lossy", f"A “{node.type}” block this app cannot yet send as such.",
                               "It appears as a note in the page.", "unsupported_block"))
    return res


def _as_opaque(node: ir.Block) -> ir.Block:
    return ir.Block(type="opaque", attrs={"source_type": node.type, "raw": node.to_dict()},
                    inline=list(node.inline), src_id=node.src_id)


def write_blocks(nodes: list[ir.Block]) -> WriteResult:
    out = WriteResult([])
    for n in nodes:
        r = write_block(n)
        out.blocks += r.blocks
        out.losses += r.losses
        out.refs += r.refs
    return out
