"""Tests for two-pass cosine retriever."""
from unittest.mock import MagicMock, patch

import pytest

from services.retriever import retrieve


def _db_with_rpc_results(pass1_rows, pass2_rows):
    """Build a mock supabase client whose .rpc().execute() side_effect returns pass1 then pass2."""
    db = MagicMock()
    r1 = MagicMock(); r1.execute.return_value.data = pass1_rows
    r2 = MagicMock(); r2.execute.return_value.data = pass2_rows
    db.rpc.side_effect = [r1, r2]
    return db


def test_two_pass_returns_block_level_deep_link():
    db = _db_with_rpc_results(
        pass1_rows=[
            {"id": "note1", "title": "ML Basics", "descriptor": "About gradients", "dist": 0.1},
        ],
        pass2_rows=[
            {"note_id": "note1", "block_id": "blk-abc", "chunk_text": "Gradient descent minimizes loss.", "chunk_index": 0, "dist": 0.15},
        ],
    )
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "user-x")

    assert len(results) == 1
    assert results[0]["id"] == "note1"
    assert results[0]["title"] == "ML Basics"
    assert results[0]["deep_link"] == "/brain/note1#blk-abc"
    assert "Gradient descent" in results[0]["content_text"]
    assert results[0]["similarity"] > 0


def test_two_pass_multiple_blocks_from_same_note():
    db = _db_with_rpc_results(
        pass1_rows=[
            {"id": "note1", "title": "Note", "descriptor": "desc", "dist": 0.1},
        ],
        pass2_rows=[
            {"note_id": "note1", "block_id": "b1", "chunk_text": "block one", "chunk_index": 0, "dist": 0.1},
            {"note_id": "note1", "block_id": "b2", "chunk_text": "block two", "chunk_index": 1, "dist": 0.2},
            {"note_id": "note1", "block_id": "b3", "chunk_text": "block three", "chunk_index": 2, "dist": 0.3},
        ],
    )
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "user-x")

    assert len(results) == 3
    deep_links = {r["deep_link"] for r in results}
    assert "/brain/note1#b1" in deep_links
    assert "/brain/note1#b2" in deep_links


def test_two_pass_multiple_notes():
    db = _db_with_rpc_results(
        pass1_rows=[
            {"id": "note1", "title": "Note 1", "descriptor": "d1", "dist": 0.1},
            {"id": "note2", "title": "Note 2", "descriptor": "d2", "dist": 0.2},
        ],
        pass2_rows=[
            {"note_id": "note1", "block_id": "b1", "chunk_text": "text1", "chunk_index": 0, "dist": 0.1},
            {"note_id": "note2", "block_id": "b2", "chunk_text": "text2", "chunk_index": 0, "dist": 0.2},
        ],
    )
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "user-x")

    note_ids = {r["id"] for r in results}
    assert "note1" in note_ids
    assert "note2" in note_ids


def test_fallback_to_match_chunks_when_no_descriptors():
    """When pass1 returns nothing (no notes have descriptors yet), fall back."""
    db = MagicMock()
    empty = MagicMock(); empty.execute.return_value.data = []
    fallback_result = MagicMock()
    fallback_result.execute.return_value.data = [
        {
            "note_id":    "note1",
            "title":      "Old Note",
            "deep_link":  "/brain/note1",
            "chunk_text": "legacy chunk",
            "similarity": 0.7,
        }
    ]
    db.rpc.side_effect = [empty, fallback_result]

    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "user-x")

    # Fallback should have been called (second rpc call is match_chunks)
    assert db.rpc.call_count == 2
    second_call_name = db.rpc.call_args_list[1][0][0]
    assert second_call_name == "match_chunks"


def test_pass1_uses_correct_rpc():
    db = MagicMock()
    r1 = MagicMock(); r1.execute.return_value.data = []
    r2 = MagicMock(); r2.execute.return_value.data = []
    db.rpc.side_effect = [r1, r2]

    with patch("services.retriever.get_supabase", return_value=db):
        retrieve([0.1] * 768, "user-x")

    first_rpc = db.rpc.call_args_list[0][0][0]
    assert first_rpc == "match_note_descriptors"


def test_empty_embedding_returns_empty():
    db = MagicMock()
    db.rpc.return_value = MagicMock()
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([], "user-x")
    assert results == []


# ── E8: pass 2 fused with word matching ─────────────────────────────────────

def _db_hybrid(pass1_rows, pass2_rows, note_rows):
    db = _db_with_rpc_results(pass1_rows, pass2_rows)
    (db.table.return_value.select.return_value.in_.return_value.eq.return_value
     .limit.return_value.execute.return_value.data) = note_rows
    return db


BLOCKS = [
    {"note_id": "n1", "block_id": "b1", "chunk_text": "Momentum averages gradients.", "chunk_index": 0},
    {"note_id": "n1", "block_id": "b2", "chunk_text": "The Bellman equation gives the observed value.", "chunk_index": 1},
]


def test_the_question_s_own_term_lifts_its_block():
    db = _db_hybrid([{"id": "n1", "title": "RL", "dist": 0.1}],
                    [dict(BLOCKS[0], dist=0.2), dict(BLOCKS[1], dist=0.3)], BLOCKS)
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "u", query="Bellman equation")
    assert results[0]["deep_link"] == "/brain/n1#b2"
    db.table.assert_called_with("note_chunks")


def test_a_block_without_an_embedding_is_found_by_its_words():
    unembedded = {"note_id": "n1", "block_id": "b3", "chunk_text": "Kepler's laws fix the orbit.", "chunk_index": 2}
    db = _db_hybrid([{"id": "n1", "title": "RS", "dist": 0.1}],
                    [dict(BLOCKS[0], dist=0.2)], BLOCKS + [unembedded])
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "u", query="Kepler orbit")
    # invisible to the embedding before; now its text reaches the model
    assert any("Kepler" in r["content_text"] for r in results)


def test_without_the_question_text_the_embedding_order_stands():
    db = _db_with_rpc_results([{"id": "n1", "title": "RL", "dist": 0.1}],
                              [dict(BLOCKS[0], dist=0.2), dict(BLOCKS[1], dist=0.3)])
    with patch("services.retriever.get_supabase", return_value=db):
        results = retrieve([0.1] * 768, "u")
    assert results[0]["deep_link"] == "/brain/n1#b1"
    db.table.assert_not_called()


# ── E8b: a hit is shown with its neighbours ─────────────────────────────────

from services.retriever import with_neighbours  # noqa: E402

NOTE = [{"note_id": "n1", "block_id": f"b{i}", "chunk_index": i, "chunk_text": t}
        for i, t in enumerate(["Intro", "The Bellman Equation",
                               "Q_obs = R + gamma * max Q", "gamma weighs the future",
                               "Episodes", "An episode is one run"])]


def test_a_heading_hit_brings_the_text_under_it():
    [(hit, text)] = with_neighbours([NOTE[1]], NOTE, budget=60)
    assert "The Bellman Equation\nQ_obs = R + gamma * max Q" in text
    assert hit is NOTE[1]


def test_overlapping_hits_are_shown_once():
    out = with_neighbours([NOTE[1], NOTE[2]], NOTE, budget=80)
    assert len(out) == 1                            # NOTE[2] is inside the first window


def test_the_window_stays_within_budget():
    [(_, text)] = with_neighbours([NOTE[3]], NOTE, budget=30)
    assert len(text) <= 30 + 5


def test_a_hit_from_an_unknown_note_is_kept_as_is():
    stray = {"note_id": "zz", "block_id": "x", "chunk_index": 0, "chunk_text": "alone"}
    assert with_neighbours([stray], NOTE) == [(stray, "alone")]
