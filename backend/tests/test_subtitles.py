"""Forgiving .srt/.vtt reader and subtitle sections (ArtCraft study item 12)."""
from services.workspace.subtitles import parse_subtitles, same_name, subtitle_sections

SRT = "1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>world</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nSecond line\r\nwraps\r\n"
VTT = "WEBVTT\n\nNOTE a comment\n\n00:01.000 --> 00:02.250 align:start\n<v Ada>Short cue\n\nSTYLE\n::cue { color: red }\n\n1:00:00.5 --> 1:00:02.0\nAn hour in\n"


def test_srt_with_crlf_and_tags():
    cues = parse_subtitles(SRT.encode("utf-8-sig"))
    assert cues == [{"start": 1.0, "duration": 2.5, "text": "Hello world"},
                    {"start": 4.0, "duration": 2.0, "text": "Second line wraps"}]


def test_vtt_without_hours_and_with_header_note_style():
    cues = parse_subtitles(VTT.encode())
    assert [(round(c["start"], 2), c["text"]) for c in cues] == [(1.0, "Short cue"), (3600.5, "An hour in")]


def test_utf16_cp1252_and_missing_numbers():
    assert parse_subtitles("00:00:01.000 --> 00:00:02.000\nCafé".encode("utf-16"))[0]["text"] == "Café"
    assert parse_subtitles("00:00:01,000 --> 00:00:02,000\nCaf\xe9".encode("cp1252"))[0]["text"] == "Café"


def test_garbage_gives_no_cues():
    assert parse_subtitles(b"\x00\x01 not subtitles at all") == []


def test_sections_are_about_a_minute_and_start_with_time():
    cues = [{"start": i * 10.0, "duration": 10.0, "text": f"w{i}"} for i in range(9)]
    secs = subtitle_sections(cues)
    assert [s["content"] for s in secs] == ["[00:00] w0 w1 w2 w3 w4 w5", "[01:00] w6 w7 w8"]


def test_same_name():
    assert same_name("Lecture 3", "lecture 3 ")
    assert not same_name("Lecture 3", "Lecture 4") and not same_name(None, "x")


# ── pairing with a video on the same note ───────────────────────────────────
from unittest.mock import MagicMock  # noqa: E402


def _db_with(rows):
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = rows
    return db


def test_paired_finds_the_other_half_by_name_and_kind():
    from services.workspace.processor import _paired
    rows = [{"id": "v1", "title": "Lecture 3", "kind": "video", "storage_path": "u/v1/l.mp4"},
            {"id": "s1", "title": "lecture 3", "kind": "document", "storage_path": "u/s1/l.srt"},
            {"id": "d1", "title": "Lecture 3", "kind": "document", "storage_path": "u/d1/l.md"}]
    sub = {"id": "s1", "note_id": "n", "title": "lecture 3"}
    vid = {"id": "v1", "note_id": "n", "title": "Lecture 3"}
    assert _paired(_db_with(rows), sub, want_video=True)["id"] == "v1"
    assert _paired(_db_with(rows), vid, want_video=False)["id"] == "s1"   # not the .md
    assert _paired(_db_with(rows), {"id": "x", "note_id": "n", "title": "Other"}, want_video=True) is None


def test_mark_subtitle_paired_flags_it_and_drops_its_chunks():
    from services.workspace.processor import _mark_subtitle_paired
    db = MagicMock()
    _mark_subtitle_paired(db, {"id": "s1", "meta": {"a": 1}}, "v1")
    db.table.return_value.update.assert_called_with({"meta": {"a": 1, "paired_video": "v1"}})
    db.table.return_value.delete.return_value.eq.assert_called_with("resource_id", "s1")


def test_synthesis_skips_a_paired_subtitle(monkeypatch):
    from services.workspace import synthesis
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value.eq.return_value
       .order.return_value.execute.return_value.data) = [
        {"id": "v1", "meta": {}}, {"id": "s1", "meta": {"paired_video": "v1"}}, {"id": "p1", "meta": None}]
    monkeypatch.setattr(synthesis, "get_supabase", lambda: db)
    assert [r["id"] for r in synthesis.ready_sources("n")] == ["v1", "p1"]
