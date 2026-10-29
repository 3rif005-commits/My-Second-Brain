"""The demo video from real screen recordings of the live site.

    python3 video/draft/make_real_video.py   → video/out/demo_real.mp4

Each scene's recording (video/out/rec/<scene>.mp4, made with
video/record/screencast.py) is cropped to the browser page, its still
stretches (waiting for a model) are cut, and it is fitted to the scene's
length from the script, under the same title bar and narration subtitles
as the draft (make_real_draft.py).
"""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image

import make_draft as m
import make_real_draft as d

d.SHOTS = m.OUT / "shots"
REC = m.OUT / "rec"
TMP = m.OUT / "video_parts"
PAGE = "crop=1300:597:66:171"  # the page inside the full-screen recording
BOX_W, BOX_H, BOX_Y = 1232, 554, 58
FPS = 30
MAX_STRETCH = 1.25  # slower than this looks like slow motion; hold the last frame instead
KEEP_STILL = 1.0  # seconds of each wait that stay in

# scene title → recording
CLIPS = {
    "The problem": "s01_board", "Workspace: a lecture with its sources": "s02_workspace",
    "Ask your whole brain": "s03_brain", "A hard question goes to the big model": "s04_hard",
    "Private stays private": "s05_private", "Web research (Tavily)": "s06_tavily",
    "Tools I choose (MCP)": "s07_mcp", "It learns a skill": "s08_skill",
    "I stay in control": "s09_control",
}


def run(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def frames(path: Path) -> int:
    out = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                          "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return int(out.strip())


def chrome(i: int, t0, title, say, done) -> Path:
    """Title bar + subtitles, with a transparent hole where the page goes."""
    img = d.base(t0, title, d.REAL, say, done, d.TOTAL)
    hole = Image.new("RGBA", (BOX_W, BOX_H), (0, 0, 0, 0))
    img.paste(hole, ((m.W - BOX_W) // 2, BOX_Y))
    p = TMP / f"chrome{i}.png"
    img.save(p)
    return p


def still_spans(src: Path) -> list[tuple[float, float]]:
    """Stretches where the page doesn't change (waiting for a model), merged."""
    log = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(src), "-vf",
                          f"{PAGE},freezedetect=n=0.003:d={KEEP_STILL + 0.4}", "-map", "0:v",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", log)]
    ends += [1e9] * (len(starts) - len(ends))  # still at the very end
    spans: list[tuple[float, float]] = []
    for s, e in zip(starts, ends):
        if spans and s - spans[-1][1] < 0.05:
            spans[-1] = (spans[-1][0], e)
        else:
            spans.append((s, e))
    return spans


def scene_clip(i: int, name: str, secs: float, overlay: Path) -> Path:
    src = REC / f"{name}.mp4"
    cut = TMP / f"cut{i}.mp4"
    # keep the first KEEP_STILL seconds of each still stretch, drop the rest
    drop = "+".join(f"between(t,{s + KEEP_STILL:.3f},{e:.3f})" for s, e in still_spans(src))
    keep = f"select='not({drop})'," if drop else ""
    run("-i", str(src), "-vf", f"{PAGE},{keep}setpts=N/{FPS}/TB",
        "-an", "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", str(cut))
    have = frames(cut) / FPS
    factor = min(secs / have, MAX_STRETCH)  # <1 speeds up, >1 slows down
    pad = max(0.0, secs - have * factor)
    out = TMP / f"scene{i}.mp4"
    x = (m.W - BOX_W) // 2
    run("-i", str(cut), "-loop", "1", "-i", str(overlay), "-filter_complex",
        f"[0:v]setpts={factor:.4f}*PTS,tpad=stop_mode=clone:stop_duration={pad:.3f},"
        f"scale={BOX_W}:{BOX_H}:force_original_aspect_ratio=decrease,"
        f"pad={BOX_W}:{BOX_H}:(ow-iw)/2:(oh-ih)/2:color=#1f1f1f[page];"
        f"color=c={m.BG}:s={m.W}x{m.H}:r={FPS}[bg];"
        f"[bg][page]overlay={x}:{BOX_Y}[v];[v][1:v]overlay=0:0,format=yuv420p",
        "-t", f"{secs:.3f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "20", str(out))
    print(f"{name}: {have:.1f}s of action → {secs}s (x{factor:.2f}, hold {pad:.1f}s)")
    return out


def still_clip(i: int, img: Image.Image, secs: float) -> Path:
    p = TMP / f"still{i}.png"
    img.convert("RGB").save(p)
    out = TMP / f"scene{i}.mp4"
    run("-loop", "1", "-i", str(p), "-t", f"{secs:.3f}", "-r", str(FPS), "-vf", "format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", str(out))
    return out


def main():
    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir(parents=True)
    parts, done = [], 0.0
    for i, (t0, title, secs, say, steps) in enumerate(d.SCENES):
        name = CLIPS.get(title)
        if name and (REC / f"{name}.mp4").exists():
            parts.append(scene_clip(i, name, secs, chrome(i, t0, title, say, done)))
        else:  # no recording: the draft's frames (screenshots or the drawn close)
            dur, tag, paint = steps[-1]
            img = d.base(t0, title, tag, say, done, d.TOTAL)
            paint(img)
            parts.append(still_clip(i, img, secs))
            print(f"{title}: no recording, still frame")
        done += secs
    lst = TMP / "parts.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    out = m.OUT / "demo_real.mp4"
    run("-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out))
    shutil.rmtree(TMP)
    print(out, f"{d.TOTAL} s")


if __name__ == "__main__":
    main()
