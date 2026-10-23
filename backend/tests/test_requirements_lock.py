"""Every dependency must have an exact version in requirements.lock, or Render takes the newest
on each deploy (that is how PyMuPDF 2.0 arrived and ran the free plan out of memory)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _names(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text().splitlines():
        line = line.split("#")[0].strip()
        if not line or line.startswith("-"):
            continue
        m = re.match(r"([A-Za-z0-9_.-]+)(\[[^\]]*\])?\s*(.*)", line)
        out[re.sub(r"[-_.]+", "-", m.group(1)).lower()] = m.group(3)
    return out


def test_every_requirement_is_pinned_in_the_lock():
    lock = _names(ROOT / "requirements.lock")
    assert all(spec.startswith("==") for spec in lock.values())
    for req in ("requirements.txt", "requirements-slim.txt"):
        missing = set(_names(ROOT / req)) - set(lock)
        assert not missing, f"{req}: not in requirements.lock: {sorted(missing)}"


def test_pymupdf_stays_below_2():
    assert _names(ROOT / "requirements.lock")["pymupdf"].startswith("==1.")
