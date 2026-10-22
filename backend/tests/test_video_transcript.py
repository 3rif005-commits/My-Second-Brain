"""Video transcript under the player + creator chapters (ArtCraft study item 9)."""
import sys
import types

from services.workspace.youtube import (
    chunk_transcript, fetch_chapters, strip_fillers, transcript_lines,
)


def snip(start, text, dur=5.0):
    return {"start": start, "duration": dur, "text": text}


def test_strip_fillers_removes_spoken_fillers_only():
    assert strip_fillers("Um, so the uh gradient, erm, flows") == "so the gradient, flows"
    assert strip_fillers("Hmm mhm OK") == "OK"
    # Real words containing filler letters stay.
    assert strip_fillers("umbrella, ahead, hermit, summer") == "umbrella, ahead, hermit, summer"
    assert strip_fillers("it's er fine") == "it's fine"


def test_transcript_lines_merge_into_about_20_seconds():
    snippets = [snip(i * 5, f"part {i}") for i in range(10)]  # 50 s
    lines = transcript_lines(snippets)
    assert [l[0] for l in lines] == [0, 20, 40]
    assert lines[0][1] == "part 0 part 1 part 2 part 3"
    assert lines[-1][1] == "part 8 part 9"


def test_transcript_lines_skip_empty_and_filler_only():
    lines = transcript_lines([snip(0, "um"), snip(5, ""), snip(10, "real words", dur=15)])
    assert lines == [[10, "real words"]]


def test_chunk_transcript_starts_a_chunk_per_chapter():
    snippets = [snip(i * 10, f"s{i}", dur=10) for i in range(6)]  # 0..60 s
    chunks = chunk_transcript(snippets, window_seconds=75,
                              chapters=[{"start": 0, "title": "Intro"}, {"start": 30, "title": "Proof"}])
    assert [c["chunk_text"] for c in chunks] == ["## Intro s0 s1 s2", "## Proof s3 s4 s5"]
    assert [c["anchor_start"] for c in chunks] == [0, 30]


def test_chunk_transcript_without_chapters_is_unchanged():
    snippets = [snip(i * 10, f"s{i}", dur=10) for i in range(3)]
    assert [c["chunk_text"] for c in chunk_transcript(snippets)] == ["s0 s1 s2"]


def test_fetch_chapters_reads_ytdlp_and_never_raises(monkeypatch):
    class FakeYDL:
        def __init__(self, opts): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def extract_info(self, url, download):
            return {"chapters": [{"start_time": 0.0, "title": "Intro"}, {"start_time": 95.4, "title": " Results "},
                                 {"start_time": "x", "title": "bad"}, {"start_time": 10, "title": ""}]}
    monkeypatch.setitem(sys.modules, "yt_dlp", types.SimpleNamespace(YoutubeDL=FakeYDL))
    assert fetch_chapters("https://youtu.be/x") == [{"start": 0, "title": "Intro"}, {"start": 95, "title": "Results"}]

    class Boom(FakeYDL):
        def extract_info(self, url, download): raise RuntimeError("network")
    monkeypatch.setitem(sys.modules, "yt_dlp", types.SimpleNamespace(YoutubeDL=Boom))
    assert fetch_chapters("https://youtu.be/x") == []


# ---- uploaded video: the file's own chapters, each with a picture (ArtCraft study V3) ----

import shutil
import subprocess

import pytest

from services.workspace import video as vsvc


def test_chapters_from_probe_reads_marks_and_numbers_untitled_ones():
    data = {"chapters": [
        {"start_time": "0.000000", "tags": {"title": "Intro"}},
        {"start_time": "95.5"},
        {"start_time": "bad", "tags": {"title": "skipped"}},
    ]}
    assert vsvc.chapters_from_probe(data) == [
        {"start": 0, "title": "Intro"}, {"start": 95, "title": "Chapter 2"}]
    assert vsvc.chapters_from_probe({}) == []


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_a_real_file_with_chapter_marks(tmp_path):
    meta = tmp_path / "chapters.txt"
    meta.write_text(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1\nSTART=0\nEND=2\ntitle=Setup\n"
                    "[CHAPTER]\nTIMEBASE=1/1\nSTART=2\nEND=4\ntitle=Results\n")
    out = tmp_path / "v.mp4"
    subprocess.run(["ffmpeg", "-v", "quiet", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=5:duration=4",
                    "-i", str(meta), "-map_metadata", "1", "-map_chapters", "1", str(out)], check=True)
    info = vsvc.probe(str(out))
    assert info["chapters"] == [{"start": 0, "title": "Setup"}, {"start": 2, "title": "Results"}]
    frames = vsvc.chapter_frames(str(out), info["chapters"] + [{"start": 99, "title": "past the end"}])
    assert all(f and f[:2] == b"\xff\xd8" for f in frames[:2])   # JPEGs
    assert frames[2] is None                                      # no frame past the end


def test_only_the_detail_read_signs_chapter_pictures(monkeypatch):
    from routers import note_sources
    calls = []
    monkeypatch.setattr(note_sources.storage, "signed_urls",
                        lambda paths, exp=3600: calls.append(paths) or {p: f"https://x/{p}" for p in paths})
    row = {"id": "r", "meta": {"chapters": [{"start": 0, "title": "A", "thumb_path": "u/r/chapter_0.jpg"},
                                            {"start": 9, "title": "B"}]}}
    listed = note_sources._source_public(row)
    assert "thumb_url" not in listed["meta"]["chapters"][0] and calls == []
    detail = note_sources._source_public(row, chapter_thumbs=True)
    assert detail["meta"]["chapters"][0]["thumb_url"] == "https://x/u/r/chapter_0.jpg"
    assert detail["meta"]["chapters"][1] == {"start": 9, "title": "B"}
    assert "thumb_url" not in row["meta"]["chapters"][0]          # the stored row is untouched
