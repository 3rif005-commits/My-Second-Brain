"""Subtitle files (.srt / .vtt) as a video's transcript (ArtCraft study item 12).

The reader is forgiving the way filmcraft's caption readers are: a BOM, UTF-16, Windows-1252,
CRLF, missing cue numbers, "," or "." before milliseconds, missing hours, WebVTT headers,
NOTE/STYLE blocks and inline tags. A subtitle file next to an uploaded video of the same name
replaces Whisper (minutes on a small laptop) with the cues the file already has.
"""
from __future__ import annotations

import re

SUBTITLE_EXTS = (".srt", ".vtt")
MAX_CUES = 20_000

_TIME = r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?"
_TIMING = re.compile(_TIME + r"\s*-->\s*" + _TIME)
_TAG = re.compile(r"<[^>]{0,200}>|\{\\[^}]{0,50}\}")


def _decode(raw: bytes) -> str:
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def _secs(h, m, s, ms) -> float:
    return int(h or 0) * 3600 + int(m) * 60 + int(s) + (int((ms or "0").ljust(3, "0")[:3]) / 1000)


def parse_subtitles(raw: bytes) -> list[dict]:
    """Cues as `[{start, duration, text}]` — the same shape as a YouTube transcript."""
    text = _decode(raw).replace("\r\n", "\n").replace("\r", "\n")
    cues: list[dict] = []
    for block in re.split(r"\n\s*\n", text):
        lines = [l.strip() for l in block.split("\n") if l.strip()]
        for i, line in enumerate(lines):
            m = _TIMING.search(line)
            if not m:
                continue
            start = _secs(*m.groups()[0:4])
            end = _secs(*m.groups()[4:8])
            words = " ".join(_TAG.sub("", l) for l in lines[i + 1:]).strip()
            if words:
                cues.append({"start": start, "duration": max(0.0, end - start), "text": words})
            break
        if len(cues) >= MAX_CUES:
            break
    return sorted(cues, key=lambda c: c["start"])


def is_subtitle(path_or_name: str | None) -> bool:
    return (path_or_name or "").lower().endswith(SUBTITLE_EXTS)


def subtitle_sections(cues: list[dict], window_seconds: float = 60.0) -> list[dict]:
    """A subtitle file on its own, readable in the source viewer: ~1-minute sections, each
    starting with its time."""
    from services.workspace.youtube import _fmt_ts, strip_fillers
    sections: list[dict] = []
    buf: list[str] = []
    start = None
    for c in cues:
        if start is None:
            start = c["start"]
        words = strip_fillers(c["text"])
        if words:
            buf.append(words)
        if c["start"] + c["duration"] - start >= window_seconds:
            sections.append({"index": len(sections), "kind": "text",
                             "content": f"[{_fmt_ts(start)}] " + " ".join(buf)})
            buf, start = [], None
    if buf and start is not None:
        sections.append({"index": len(sections), "kind": "text",
                         "content": f"[{_fmt_ts(start)}] " + " ".join(buf)})
    return sections


def same_name(a: str | None, b: str | None) -> bool:
    return bool(a) and bool(b) and a.strip().lower() == b.strip().lower()
