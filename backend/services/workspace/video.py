"""Uploaded video processing — ffprobe metadata + optional faster-whisper transcript.

faster-whisper is an OPTIONAL dependency (PyTorch-free but still ~1 GB of
CTranslate2 models on first run). When it isn't installed the resource degrades
gracefully: no transcript → summary is generated from whatever is available
(title-only stub note in the worst case). ffmpeg/ffprobe are system binaries.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess

logger = logging.getLogger(__name__)


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


MAX_CHAPTERS = 200
MAX_CHAPTER_FRAMES = 40


def chapters_from_probe(data: dict) -> list[dict]:
    """The file's own chapter marks `[{start, title}]` (MP4/MKV chapters, as ffprobe reports
    them) — the same shape as a YouTube creator's chapters. Untitled ones are numbered."""
    out = []
    for i, c in enumerate((data.get("chapters") or [])[:MAX_CHAPTERS]):
        try:
            start = int(float(c.get("start_time") or 0))
        except (TypeError, ValueError):
            continue
        title = str((c.get("tags") or {}).get("title") or "").strip()[:200] or f"Chapter {i + 1}"
        out.append({"start": start, "title": title})
    return out


def chapter_frames(path: str, chapters: list[dict]) -> list[bytes | None]:
    """A small JPEG (320 px wide) a second into each chapter, None where ffmpeg can't take
    one. Only the first MAX_CHAPTER_FRAMES chapters get a picture."""
    frames: list[bytes | None] = []
    for c in chapters[:MAX_CHAPTER_FRAMES]:
        try:
            out = subprocess.run(
                ["ffmpeg", "-ss", str(c["start"] + 1), "-i", path, "-frames:v", "1",
                 "-vf", "scale=320:-2", "-f", "image2", "-c:v", "mjpeg", "-q:v", "5",
                 "pipe:1", "-v", "quiet"],
                capture_output=True, timeout=60, check=True,
            ).stdout
            frames.append(out or None)
        except Exception:
            frames.append(None)
    return frames


def probe(path: str) -> dict:
    """{duration, width, height, chapters?} via ffprobe. Empty dict on failure."""
    if not ffmpeg_available():
        return {}
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", "-show_chapters", path],
            capture_output=True, timeout=60, check=True,
        ).stdout
        data = json.loads(out)
        meta: dict = {}
        fmt = data.get("format", {})
        if fmt.get("duration"):
            meta["duration"] = float(fmt["duration"])
        for s in data.get("streams", []):
            if s.get("codec_type") == "video":
                meta["width"] = s.get("width")
                meta["height"] = s.get("height")
                break
        chapters = chapters_from_probe(data)
        if chapters:
            meta["chapters"] = chapters
        return meta
    except Exception as e:
        logger.warning(f"ffprobe failed: {e}")
        return {}


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def transcribe(path: str, model_size: str = "base") -> list[dict]:
    """[{text, start, duration}] via faster-whisper (CPU int8).

    Raises RuntimeError when faster-whisper is not installed.
    """
    if not whisper_available():
        raise RuntimeError(
            "faster-whisper not installed — pip install faster-whisper to enable "
            "local transcription of uploaded videos."
        )
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(path, beam_size=5, vad_filter=True)
    out = []
    for seg in segments:
        out.append({
            "text": seg.text.strip(),
            "start": float(seg.start),
            "duration": float(seg.end - seg.start),
        })
    return out


def extract_keyframes(path: str, duration: float, count: int = 6) -> list[bytes]:
    """Evenly spaced JPEG keyframes — vision-model fallback when no transcript."""
    if not ffmpeg_available() or duration <= 0:
        return []
    frames = []
    step = duration / (count + 1)
    for i in range(1, count + 1):
        try:
            out = subprocess.run(
                ["ffmpeg", "-ss", str(step * i), "-i", path,
                 "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
                 "-v", "quiet"],
                capture_output=True, timeout=60, check=True,
            ).stdout
            if out:
                frames.append(out)
        except Exception:
            continue
    return frames
