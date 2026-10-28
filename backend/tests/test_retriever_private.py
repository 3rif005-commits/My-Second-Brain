"""Private notes have no cloud embedding (indexer.keeps_private), so the
retriever finds them by their words, in our own database. They still pass the
privacy gate afterwards like any retrieved note."""
from unittest.mock import MagicMock

from services import retriever


def _db(private_rows, chunks):
    db = MagicMock()
    notes = MagicMock()
    (notes.select.return_value.eq.return_value.eq.return_value.is_.return_value
       .limit.return_value.execute.return_value.data) = private_rows
    note_chunks = MagicMock()
    (note_chunks.select.return_value.in_.return_value.eq.return_value
       .limit.return_value.execute.return_value.data) = chunks
    db.table.side_effect = lambda name: {"notes": notes, "note_chunks": note_chunks}[name]
    return db


def test_a_private_note_is_found_by_its_words():
    db = _db([{"id": "health", "title": "Health · knee physio plan"},
              {"id": "money", "title": "Budget and scholarship"}],
             [{"note_id": "health", "chunk_text": "Tuesday and Thursday, 15:00 at the clinic"},
              {"note_id": "money", "chunk_text": "Rent 380"}])
    hits = retriever._private_matches(db, "Plan my week around my physio appointments", "u1")
    assert [h["id"] for h in hits] == ["health"]
    assert hits[0]["title"] == "Health · knee physio plan"


def test_no_shared_word_means_no_private_note():
    db = _db([{"id": "money", "title": "Budget"}], [{"note_id": "money", "chunk_text": "Rent"}])
    assert retriever._private_matches(db, "explain attention", "u1") == []


def test_no_private_notes_reads_nothing_more():
    db = _db([], [])
    assert retriever._private_matches(db, "physio", "u1") == []
