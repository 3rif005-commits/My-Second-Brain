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


def test_a_word_matched_private_note_keeps_a_passage_in_the_results(monkeypatch):
    """Lexical-only passages can fall below the fusion's cut; the private note
    still comes back (the privacy gate then holds it back from cloud models)."""
    from unittest.mock import patch
    pass1 = [{"id": f"n{i}", "title": f"Note {i}"} for i in range(5)]
    vector = [{"note_id": f"n{i % 5}", "block_id": f"b{i}", "chunk_text": "lecture text",
               "chunk_index": i, "dist": 0.1} for i in range(40)]
    blocks = vector + [{"note_id": "health", "block_id": "h1", "chunk_index": 0,
                        "chunk_text": "Physio Tuesday and Thursday 15:00"}]
    db = MagicMock()
    db.rpc.side_effect = lambda name, args: MagicMock(**{"execute.return_value.data":
                                                       pass1 if name == "match_note_descriptors" else vector})
    with patch.object(retriever, "get_supabase", return_value=db), \
         patch.object(retriever, "_private_matches", return_value=[{"id": "health", "title": "Health"}]), \
         patch.object(retriever, "_note_blocks", return_value=blocks):
        out = retriever.retrieve([0.1] * 3, "u1", query="my physio appointments")
    hit = [r for r in out if r["id"] == "health"]
    assert hit and hit[0]["deep_link"] == "/brain/health#h1"
    assert "Physio" in hit[0]["content_text"]
