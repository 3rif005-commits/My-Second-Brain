"""Kept parts of the v2 recordings (script v2), for the Remotion video.

    python3 video/draft/remotion_segments_v2.py   → video/src/demo/segments.json (v2_* keys added)

Each recording keeps only its chosen windows (source seconds, picked from frame
sheets: fumbles and failed attempts left out), and inside them the still
stretches (waiting) are cut to KEEP seconds, as in remotion_segments.py.
"""
from __future__ import annotations

import json
from pathlib import Path

import make_real_video as mv
from remotion_segments import KEEP, OUT, duration

mv.PAGE = "crop=1276:572:0:0"  # the v2 files are already cropped to the page
REC30 = mv.REC.parent / "rec30"

WINDOWS = {
    "v2_s01_blocks": [(8, 168), (200, 212)],
    "v2_s02_workspace": [(0, 82)],
    "v2_s03_guide": [(0, 58)],
    "v2_s04_capture": [(0, 30), (64, 180), (382, 410)],
    "v2_s05_build": [(0, 40), (415, 459)],
    "v2_s06_database": [(0, 64)],
}


def main():
    data = json.loads(OUT.read_text())
    for name, windows in WINDOWS.items():
        src = REC30 / f"{name}.mp4"
        end = duration(src)
        spans = mv.still_spans(src)
        keep = []
        for a, b in windows:
            b = min(b, end)
            at = a
            for s, e in spans:
                if e <= a or s >= b:
                    continue
                s, e = max(s, a), min(e, b)
                if s + KEEP > at:
                    keep.append([round(at, 3), round(min(s + KEEP, b), 3)])
                at = max(at, e)
            if at < b - 0.05:
                keep.append([round(at, 3), round(b, 3)])
        data[name] = keep
        print(f"{name}: {sum(y - x for x, y in keep):.1f}s kept, {len(keep)} parts")
    OUT.write_text(json.dumps(data, indent=1))


if __name__ == "__main__":
    main()
