"""The parts of each recording worth showing, for the Remotion video.

    python3 video/draft/remotion_segments.py   → video/src/demo/segments.json

A recording is kept whole except its still stretches (waiting for a model):
of each, the first KEEP seconds stay. Nothing is lost at a cut: the frames
before and after it are the same still page.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from make_real_video import CLIPS, REC, still_spans

KEEP = 0.6
OUT = Path(__file__).resolve().parents[1] / "src" / "demo" / "segments.json"


def duration(path: Path) -> float:
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                 "-of", "csv=p=0", str(path)],
                                capture_output=True, text=True, check=True).stdout)


def main():
    data = {}
    for name in CLIPS.values():
        src = REC / f"{name}.mp4"
        end = duration(src)
        keep, at = [], 0.0
        for s, e in still_spans(src):
            if s + KEEP > at:
                keep.append([round(at, 3), round(min(s + KEEP, end), 3)])
            at = min(e, end)
        if at < end - 0.05:
            keep.append([round(at, 3), round(end, 3)])
        data[name] = keep
        print(f"{name}: {sum(b - a for a, b in keep):.1f}s kept of {end:.1f}s, {len(keep)} parts")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1))


if __name__ == "__main__":
    main()
