"""Keep 7 daily + 4 weekly + 12 monthly archives; delete the rest (and only archives)."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

NAME = re.compile(r"^second-brain-backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})Z\.sbz$")


def archive_name(now: datetime) -> str:
    return f"second-brain-backup-{now:%Y-%m-%dT%H-%M}Z.sbz"


def _when(p: Path) -> datetime | None:
    m = NAME.match(p.name)
    return datetime(*map(int, m.groups()), tzinfo=timezone.utc) if m else None


def keep_set(items: list[tuple[datetime, Path]], daily=7, weekly=4, monthly=12) -> set[Path]:
    items = sorted(items, key=lambda x: x[0], reverse=True)
    keep: set[Path] = set()
    days: set = set()
    weeks: set = set()
    months: set = set()
    for when, p in items:                                   # newest first: the newest of each period wins
        d, w, mo = when.date(), when.isocalendar()[:2], (when.year, when.month)
        if d not in days and len(days) < daily:
            days.add(d)
            keep.add(p)
        if w not in weeks and len(weeks) < weekly:
            weeks.add(w)
            keep.add(p)
        if mo not in months and len(months) < monthly:
            months.add(mo)
            keep.add(p)
    return keep


def prune(folder: Path, **kw) -> list[Path]:
    """Delete archives outside the policy. Only files named like an archive are ever touched."""
    items = [(w, p) for p in folder.glob("*.sbz") if (w := _when(p))]
    keep = keep_set(items, **kw)
    gone = [p for _, p in items if p not in keep]
    for p in gone:
        p.unlink()
    return gone
