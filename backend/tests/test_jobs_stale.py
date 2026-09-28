"""Is a ready result still made from what the note's sources look like now
(harness 5.3, milestone 5)? Editing the note is never stale — only its
sources are: deleted, re-extracted, or a new one added since the job read them.
"""
from unittest.mock import patch

import pytest

from services.jobs import stale
from services.workspace import synthesis
from tests.fake_db import FakeDB


def _sources(*rows):
    return FakeDB(note_resources=[{"id": i, "updated_at": at, "status": "ready", "note_id": "n1", "title": t}
                                  for i, at, t in rows])


def test_the_signature_is_every_ready_source_paired_with_when_it_changed():
    with patch("services.workspace.synthesis.get_supabase",
              return_value=_sources(("s2", "t2", "B"), ("s1", "t1", "A"))):
        sig = synthesis.source_signature("n1")
    assert sig == "s1:t1,s2:t2"                     # sorted — order of attachment does not matter


def test_parsing_round_trips_the_signature():
    assert stale.parse_signature("s1:t1,s2:t2") == {"s1": "t1", "s2": "t2"}
    assert stale.parse_signature("") == {}
    assert stale.parse_signature("garbage") == {}    # no colon: ignored, not a crash


def test_nothing_queued_before_this_feature_is_never_flagged_stale():
    assert stale.check(None, ["s1"], "n1") is None


def test_unchanged_sources_are_not_stale():
    with patch("services.workspace.synthesis.get_supabase", return_value=_sources(("s1", "t1", "A"))):
        assert stale.check("s1:t1", ["s1"], "n1") is None


def test_a_deleted_source_is_named_generically_no_title_to_give():
    with patch("services.workspace.synthesis.get_supabase", return_value=_sources(("s2", "t2", "B"))):
        result = stale.check("s1:t1,s2:t2", ["s1", "s2"], "n1")
    assert result == {"reason": "deleted", "message": "Made from a source you have since deleted."}


def test_a_re_extracted_source_names_itself():
    db = _sources(("s1", "t2-new", "Slides.pdf"))
    with patch("services.workspace.synthesis.get_supabase", return_value=db), \
         patch("services.jobs.stale.get_supabase", return_value=db):
        result = stale.check("s1:t1", ["s1"], "n1")
    assert result == {"reason": "changed", "message": 'Made from an older version of "Slides.pdf".'}


def test_a_new_source_with_no_title_lookup_falls_back_to_a_plain_sentence():
    """The job read only s1; s2 was added afterwards — nothing about s1 changed,
    but the material this note now offers is not what the job saw."""
    with patch("services.workspace.synthesis.get_supabase",
              return_value=_sources(("s1", "t1", "A"), ("s2", "t2", "B"))):
        result = stale.check("s1:t1", ["s1"], "n1")
    assert result == {"reason": "changed", "message": "Made from an older version of your sources."}


def test_a_deleted_source_wins_over_a_merely_added_one():
    with patch("services.workspace.synthesis.get_supabase", return_value=_sources(("s2", "t2", "B"))):
        result = stale.check("s1:t1", ["s1"], "n1")
    assert result["reason"] == "deleted"
