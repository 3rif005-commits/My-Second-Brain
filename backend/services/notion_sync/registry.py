"""Registries: type string -> reader / writer (ROBUSTNESS §1.1).

A missing reader degrades to `UnknownReader` (opaque), a missing writer to
`OpaqueWriter`, and a mapper that raises becomes an opaque node plus a
`mapper_error` loss. A missing or broken mapper never crashes a send.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, ClassVar, Protocol

from services.portable import ir
from services.portable.losses import Loss

log = logging.getLogger(__name__)


@dataclass
class ReadCtx:
    """What a reader may use: a way to read nested blocks, nothing else."""
    read_children: Callable[[list], list[ir.Block]] = field(default=lambda _: [])


class Reader(Protocol):
    handles: ClassVar[str]          # e.g. "blocknote:paragraph"
    version: ClassVar[int]          # bump = deliberate re-sync (ADR-08)

    def read(self, src: dict, ctx: ReadCtx) -> list[ir.Block]: ...   # never raises


READERS: dict[str, Reader] = {}


def register_reader(cls):
    inst = cls()
    READERS[cls.handles] = inst
    return cls


def _load() -> None:
    from services.notion_sync.readers.blocknote import load_all
    load_all()


def opaque_block(src: Any, losses: list[Loss] | None = None) -> ir.Block:
    """The 'never drop' node: plain text, original type and raw JSON travel."""
    from services.notion_sync.readers.blocknote.inline import plain_of
    t = src.get("type", "?") if isinstance(src, dict) else "?"
    inline = []
    if isinstance(src, dict):
        text = plain_of(src.get("content"))
        if text:
            inline = [ir.Text(text)]
    return ir.Block(
        type="opaque", attrs={"source_type": str(t), "raw": src},
        inline=inline, src_id=str(src.get("id", "")) if isinstance(src, dict) else "",
        losses=list(losses or []))


def read_block(src: Any, ctx: ReadCtx | None = None) -> list[ir.Block]:
    _load()
    ctx = ctx or ReadCtx(read_children=read_blocks)
    if not isinstance(src, dict):
        return [opaque_block(src, [Loss("lossy", "A block that could not be read.",
                                        "It is kept as a note in the page.", "mapper_error")])]
    reader = READERS.get(f"blocknote:{src.get('type')}") or READERS["blocknote:*"]
    try:
        return reader.read(src, ctx)
    except Exception:                      # a reader must never fail a send
        log.exception("reader %s failed", reader.handles)
        return [opaque_block(src, [Loss(
            "lossy", f"A “{src.get('type')}” block could not be converted.",
            "It is kept as a note in the page.", "mapper_error")])]


def read_blocks(blocks: list | None, ctx: ReadCtx | None = None) -> list[ir.Block]:
    out: list[ir.Block] = []
    for b in blocks or []:
        out.extend(read_block(b, ctx))
    return out


def writers() -> dict:
    from services.notion_sync.notion.writers import WRITERS
    return WRITERS


def mapper_set_version() -> str:
    """Hash of every (handles, version): changes when any mapper is improved."""
    _load()
    pairs = sorted((h, r.version) for h, r in READERS.items())
    pairs += sorted((h, w.version) for h, w in writers().items())
    return hashlib.sha256(repr(pairs).encode()).hexdigest()[:12]
