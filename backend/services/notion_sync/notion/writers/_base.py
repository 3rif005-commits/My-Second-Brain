"""Writer plumbing: IR block -> Notion block payloads (pure, no I/O)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from services.portable import ir
from services.portable.losses import Loss


@dataclass
class WriteResult:
    blocks: list[dict]
    losses: list[Loss] = field(default_factory=list)
    refs: list = field(default_factory=list)       # mentions/files to resolve (M2/M3)


@dataclass
class WriteCtx:
    write_children: Callable[[list[ir.Block]], WriteResult]
