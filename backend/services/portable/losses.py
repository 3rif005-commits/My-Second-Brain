"""Losses are data (ADR-14): every mapper that cannot represent something
exactly says so, in plain words. The dry run, the page marker and the status
all come from this list, so "silent loss = 0" is testable.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

LEVELS = ("approximated", "lossy", "impossible")
_RANK = {lvl: i for i, lvl in enumerate(LEVELS)}


@dataclass(frozen=True)
class Loss:
    level: str          # approximated | lossy | impossible
    what: str           # plain words: what could not be kept
    fallback: str       # plain words: what happens instead
    code: str           # stable machine slug, e.g. "text_align"

    def __post_init__(self):
        if self.level not in _RANK:
            raise ValueError(f"unknown loss level {self.level!r}")

    def to_dict(self) -> dict:
        return asdict(self)


def fidelity(losses: list[Loss]) -> str:
    """One word for a set of losses: exact | approximated | lossy.
    `impossible` counts as lossy: something is not in the destination at all."""
    if not losses:
        return "exact"
    worst = max(_RANK[loss.level] for loss in losses)
    return "approximated" if worst == 0 else "lossy"


def dedupe(losses: list[Loss]) -> list[Loss]:
    seen, out = set(), []
    for loss in losses:
        key = (loss.code, loss.what)
        if key not in seen:
            seen.add(key)
            out.append(loss)
    return out
