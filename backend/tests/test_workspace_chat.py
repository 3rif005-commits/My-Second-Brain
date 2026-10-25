"""Tests for grounded workspace chat: prompt building, citation mapping,
and the streamed event grammar."""
from unittest.mock import MagicMock, patch

import pytest

from services.workspace.chat import (
    build_system_prompt, citations_payload, run_note_chat, retrieve_chunks,
    _anchor_label,
)


CHUNKS = [
    {"id": "c1", "resource_id": "r1", "chunk_text": "Gradient descent minimizes loss.",
     "anchor_type": "time", "anchor_start": 83.0, "anchor_end": 150.0},
    {"id": "c2", "resource_id": "r2", "chunk_text": "The chain rule composes derivatives.",
     "anchor_type": "page", "anchor_start": 4, "anchor_end": 4},
]
TITLES = {"r1": "Lecture video", "r2": "Calculus PDF"}


def test_anchor_labels():
    assert _anchor_label(CHUNKS[0]) == "t=01:23"
    assert _anchor_label(CHUNKS[1]) == "page 4"
    assert _anchor_label({"anchor_type": "section", "anchor_start": 7}) == "section 7"


def test_system_prompt_numbers_sources():
    prompt = build_system_prompt(CHUNKS, TITLES)
    assert "[1] (Lecture video, t=01:23)" in prompt
    assert "[2] (Calculus PDF, page 4)" in prompt
    assert "Gradient descent" in prompt
    assert "Never invent citation numbers" in prompt


def test_system_prompt_empty_sources():
    prompt = build_system_prompt([], {})
    assert "(no sources)" in prompt


def test_citations_payload_maps_n_to_anchors():
    payload = citations_payload(CHUNKS, TITLES)
    assert payload[0]["n"] == 1
    assert payload[0]["resource_id"] == "r1"
    assert payload[0]["anchor_type"] == "time"
    assert payload[0]["anchor_start"] == 83.0
    assert payload[1]["n"] == 2
    assert payload[1]["title"] == "Calculus PDF"


@pytest.mark.asyncio
async def test_run_note_chat_event_grammar():
    async def fake_stream(provider, messages, max_tokens=2048):
        yield "Loss is minimized by gradient descent [1]."

    db = MagicMock()
    db.table.return_value.select.return_value.in_.return_value.execute.return_value.data = [
        {"id": "r1", "title": "Lecture video"},
        {"id": "r2", "title": "Calculus PDF"},
    ]

    with patch("services.workspace.chat.embed", return_value=[0.1] * 768), \
         patch("services.workspace.chat.retrieve_chunks", return_value=CHUNKS), \
         patch("services.workspace.chat.get_supabase", return_value=db), \
         patch("services.workspace.chat.candidates",
               return_value=[MagicMock(provider="openai", label="OpenAI")]), \
         patch("services.workspace.chat.ai_stream", fake_stream):
        events = [ev async for ev in run_note_chat("n1", "u1", [
            {"role": "user", "content": "what minimizes loss?"},
        ])]

    types = [e["type"] for e in events]
    assert types[0] == "context"
    assert "text" in types
    assert types[-2] == "citations"
    assert types[-1] == "done"
    citations_ev = next(e for e in events if e["type"] == "citations")
    assert citations_ev["citations"][0]["n"] == 1
    assert citations_ev["citations"][0]["resource_id"] == "r1"


@pytest.mark.asyncio
async def test_run_note_chat_no_provider():
    with patch("services.workspace.chat.embed", return_value=[0.1] * 768), \
         patch("services.workspace.chat.retrieve_chunks", return_value=[]), \
         patch("services.workspace.chat.candidates", return_value=[]):
        events = [ev async for ev in run_note_chat("n1", "u1", [
            {"role": "user", "content": "hi"},
        ])]
    assert any(e["type"] == "error" for e in events)
    assert events[-1]["type"] == "done"


@pytest.mark.asyncio
async def test_run_note_chat_falls_back_to_next_provider():
    """First provider 429s before yielding anything → second one answers."""
    calls = []

    def make_stream():
        async def fake_stream(provider, messages, max_tokens=2048):
            calls.append(provider.label)
            if provider.label == "broken":
                raise RuntimeError("429 quota exhausted")
                yield  # pragma: no cover — makes this an async generator
            yield "Answer [1]."
        return fake_stream

    broken = MagicMock(provider="gemini", label="broken")
    working = MagicMock(provider="openai_compatible", label="working")

    with patch("services.workspace.chat.embed", return_value=[0.1] * 768), \
         patch("services.workspace.chat.retrieve_chunks", return_value=CHUNKS), \
         patch("services.workspace.chat.get_supabase", return_value=MagicMock()), \
         patch("services.workspace.chat.candidates", return_value=[broken, working]), \
         patch("services.workspace.chat.ai_stream", make_stream()):
        events = [ev async for ev in run_note_chat("n1", "u1", [
            {"role": "user", "content": "q"},
        ])]

    assert calls == ["broken", "working"]
    texts = [e["content"] for e in events if e["type"] == "text"]
    assert texts == ["Answer [1]."]
    assert not any(e["type"] == "error" for e in events)


def _db(vector_rows, note_rows):
    db = MagicMock()
    db.rpc.return_value.execute.return_value.data = vector_rows
    (db.table.return_value.select.return_value.eq.return_value.eq.return_value
     .limit.return_value.execute.return_value.data) = note_rows
    return db


def test_retrieval_is_note_scoped():
    db = _db(CHUNKS, CHUNKS)
    with patch("services.workspace.chat.embed", return_value=[0.1] * 768), \
         patch("services.workspace.chat.get_supabase", return_value=db):
        out = retrieve_chunks("query", "n1", "u1")
    assert {c["id"] for c in out} == {"c1", "c2"}
    name, args = db.rpc.call_args[0]
    assert name == "match_note_source_chunks"
    assert args["target_note_id"] == "n1"
    assert args["match_user_id"] == "u1"
    assert "target_workspace_id" not in args
    # the word-matching side reads the same note only
    db.table.assert_called_with("resource_chunks")
    eqs = db.table.return_value.select.return_value.eq
    assert eqs.call_args == (("note_id", "n1"),)
    assert eqs.return_value.eq.call_args == (("user_id", "u1"),)


def test_the_lecture_s_own_term_lifts_its_piece():
    """E8: the embedding put the chain-rule piece first; the question names
    gradient descent, so the fused order puts that piece first."""
    db = _db([CHUNKS[1], CHUNKS[0]], CHUNKS)
    with patch("services.workspace.chat.embed", return_value=[0.1] * 768), \
         patch("services.workspace.chat.get_supabase", return_value=db):
        out = retrieve_chunks("what does gradient descent minimize?", "n1", "u1")
    assert out[0]["id"] == "c1"


def test_words_alone_answer_when_the_embedding_server_is_down():
    db = _db([], CHUNKS)
    with patch("services.workspace.chat.embed", side_effect=ConnectionError("8081 down")), \
         patch("services.workspace.chat.get_supabase", return_value=db):
        out = retrieve_chunks("chain rule", "n1", "u1")
    assert [c["id"] for c in out] == ["c2"]


def test_a_piece_without_an_embedding_is_still_found():
    unembedded = {"id": "c3", "resource_id": "r2", "chunk_text": "Backpropagation uses the Jacobian.",
                  "anchor_type": "page", "anchor_start": 9, "anchor_end": 9}
    db = _db(CHUNKS, CHUNKS + [unembedded])
    with patch("services.workspace.chat.embed", return_value=[0.1] * 768), \
         patch("services.workspace.chat.get_supabase", return_value=db):
        out = retrieve_chunks("Jacobian", "n1", "u1")
    assert "c3" in [c["id"] for c in out]


@pytest.mark.asyncio
async def test_titles_come_from_note_resources():
    async def fake_stream(provider, messages, max_tokens=2048):
        yield "Answer [1]."

    db = MagicMock()
    db.table.return_value.select.return_value.in_.return_value.execute.return_value.data = [
        {"id": "r1", "title": "Lecture video"},
    ]
    with patch("services.workspace.chat.retrieve_chunks", return_value=CHUNKS), \
         patch("services.workspace.chat.get_supabase", return_value=db), \
         patch("services.workspace.chat.candidates",
               return_value=[MagicMock(provider="openai", label="OpenAI")]), \
         patch("services.workspace.chat.ai_stream", fake_stream):
        _ = [ev async for ev in run_note_chat("n1", "u1", [
            {"role": "user", "content": "q"}])]
    db.table.assert_called_with("note_resources")


# ── sessions that bring other notes in (redesign 2026-10-25) ────────────────

def test_a_brought_in_notes_text_becomes_note_pieces():
    from services.workspace.chat import note_text_pieces
    db = MagicMock()
    long_para = "x" * 600
    (db.table.return_value.select.return_value.in_.return_value.eq.return_value.is_.return_value
     .execute.return_value.data) = [{"id": "n2", "content_text": f"Bellman\n{long_para}\n{long_para}\nend"}]
    with patch("services.workspace.chat.get_supabase", return_value=db):
        pieces = note_text_pieces(["n2"], "u1")
    assert [p["kind"] for p in pieces] == ["note"] * len(pieces)
    assert all(p["note_id"] == "n2" and p["resource_id"] == "n2" for p in pieces)
    assert all(len(p["chunk_text"]) <= 900 for p in pieces)
    assert "".join(p["chunk_text"] for p in pieces).replace("\n", "").count("x") == 1200
    assert pieces[0]["chunk_text"].startswith("Bellman")


def test_retrieval_searches_every_note_in_the_session():
    db = MagicMock()
    db.rpc.return_value.execute.return_value.data = [
        {"id": "c9", "resource_id": "r9", "chunk_text": "value iteration", "anchor_type": "page",
         "anchor_start": 1, "anchor_end": 1, "similarity": 0.9}]
    (db.table.return_value.select.return_value.in_.return_value.eq.return_value
     .limit.return_value.execute.return_value.data) = []
    with patch("services.workspace.chat.embed", return_value=[0.1] * 768), \
         patch("services.workspace.chat.get_supabase", return_value=db), \
         patch("services.workspace.chat.note_text_pieces", return_value=[]) as pieces:
        out = retrieve_chunks("value iteration", "n1", "u1", ["n2", "n1", "n2"])
    searched = [c[0][1]["target_note_id"] for c in db.rpc.call_args_list]
    assert searched == ["n1", "n2"]                  # once each, the session's own first
    assert db.table.return_value.select.return_value.in_.call_args == (("note_id", ["n1", "n2"]),)
    pieces.assert_called_once_with(["n2"], "u1")      # only brought-in notes' own text
    assert out and out[0]["note_id"] in ("n1", "n2")


def test_a_note_citation_says_which_note_to_open():
    from services.workspace.chat import citations_payload, source_excerpts
    chunk = {"id": "note:n2:0", "resource_id": "n2", "note_id": "n2", "kind": "note",
             "chunk_text": "An MDP is (S, A, P, R, γ).", "anchor_type": "section",
             "anchor_start": 0, "anchor_end": 0}
    cites = citations_payload([chunk], {"n2": "Lecture 9 · MDPs"})
    assert cites[0]["kind"] == "note" and cites[0]["note_id"] == "n2"
    assert "(Lecture 9 · MDPs, your note)" in source_excerpts([chunk], {"n2": "Lecture 9 · MDPs"})
