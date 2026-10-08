"""Stable JSON + sha256 of anything the IR is made of."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, is_dataclass
from typing import Any


def _plain(obj: Any) -> Any:
    if hasattr(obj, "to_dict"):
        return _plain(obj.to_dict())
    if is_dataclass(obj) and not isinstance(obj, type):
        return _plain(asdict(obj))
    if isinstance(obj, dict):
        return {str(k): _plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_plain(v) for v in obj]
    return obj


def canonical(obj: Any) -> str:
    """Same value => same string: sorted keys, no whitespace, no ASCII escaping."""
    return json.dumps(_plain(obj), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)


def digest(*parts: Any) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(canonical(p).encode("utf-8"))
        h.update(b"\x1f")
    return h.hexdigest()
