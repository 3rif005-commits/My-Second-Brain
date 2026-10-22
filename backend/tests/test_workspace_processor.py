"""Tests for services/workspace/processor.py's DB-insertion helpers.

Postgres text columns reject a literal NUL byte (\\u0000) outright — a
known artifact of PDF text extraction on malformed/binary-embedded content
streams. These tests cover sanitizing it out before the row ever reaches
the insert call, since it's cheaper and more robust to fix at the DB
boundary than to chase every extractor that might produce one.
"""
from unittest.mock import MagicMock, patch

from services.workspace import processor


def _db():
    """get_supabase() double: one MagicMock per table, .insert()/.delete()
    chains pre-wired to return themselves so .eq()/.execute() are chainable."""
    tables: dict = {}
    db = MagicMock()
    db.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    db.tables = tables
    return db


RESOURCE = {"id": "r1", "user_id": "u1", "note_id": "n1"}


def test_insert_elements_strips_nul_bytes_from_content():
    db = _db()
    with patch.object(processor, "get_supabase", return_value=db):
        processor._insert_elements(RESOURCE, [
            {"element_type": "text", "content": "before\x00after", "page": 1, "order_index": 0},
        ])
    rows = db.tables["resource_elements"].insert.call_args[0][0]
    assert rows[0]["content"] == "beforeafter"
    assert "\x00" not in rows[0]["content"]


def test_insert_elements_leaves_clean_content_untouched():
    db = _db()
    with patch.object(processor, "get_supabase", return_value=db):
        processor._insert_elements(RESOURCE, [
            {"element_type": "text", "content": "perfectly normal text", "page": 1, "order_index": 0},
        ])
    rows = db.tables["resource_elements"].insert.call_args[0][0]
    assert rows[0]["content"] == "perfectly normal text"


def test_insert_elements_tolerates_content_none():
    db = _db()
    with patch.object(processor, "get_supabase", return_value=db):
        processor._insert_elements(RESOURCE, [
            {"element_type": "image", "content": None, "page": 1, "order_index": 0},
        ])
    rows = db.tables["resource_elements"].insert.call_args[0][0]
    assert rows[0]["content"] is None


def test_insert_chunks_strips_nul_bytes_from_chunk_text():
    db = _db()
    with patch.object(processor, "embed_batch", side_effect=Exception("skip embedding for this test")):
        with patch.object(processor, "get_supabase", return_value=db):
            processor._insert_chunks(RESOURCE, [
                {"chunk_index": 0, "chunk_text": "poisoned\x00chunk",
                 "anchor_type": "page", "anchor_start": 1, "anchor_end": 1},
            ])
    rows = db.tables["resource_chunks"].insert.call_args[0][0]
    assert rows[0]["chunk_text"] == "poisonedchunk"
    assert "\x00" not in rows[0]["chunk_text"]


def test_resume_interrupted_reruns_cut_off_sources_and_gives_up_after_two_restarts():
    db = _db()
    q = db.tables.setdefault("note_resources", MagicMock())
    q.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"id": "fresh", "meta": {"pages": 300}},
        {"id": "again", "meta": {"resumed": 1}},
        {"id": "crashy", "meta": {"resumed": 2}},
    ]
    saved, statuses, ran = {}, {}, []
    with patch.object(processor, "get_supabase", return_value=db), \
         patch.object(processor, "_save_meta", side_effect=lambda rid, m: saved.__setitem__(rid, m)), \
         patch.object(processor, "_set_status", side_effect=lambda rid, st, err=None: statuses.__setitem__(rid, (st, err))), \
         patch.object(processor, "process_resource", side_effect=ran.append):
        assert processor.resume_interrupted() == 2
    # only sources stuck on "processing" are looked at; "queued" waits for the user on purpose
    q.select.return_value.eq.assert_called_with("status", "processing")
    assert ran == ["fresh", "again"]
    assert saved["fresh"] == {"pages": 300, "resumed": 1}
    assert saved["again"]["resumed"] == 2
    assert statuses["crashy"][0] == "error" and "Try again" in statuses["crashy"][1]
    assert "crashy" not in saved
