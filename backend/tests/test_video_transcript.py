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
