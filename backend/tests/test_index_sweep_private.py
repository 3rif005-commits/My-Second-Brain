"""Private notes embedded before the cloud-embedder rule are re-indexed by
the sweep, which replaces their cloud embedding with none."""
from unittest.mock import MagicMock, patch

from services import index_sweep


def _db(rows):
    db = MagicMock()
    q = db.table.return_value.select.return_value.eq.return_value
    q.not_.is_.return_value.is_.return_value.limit.return_value.execute.return_value.data = rows
    return db


def test_still_embedded_private_notes_are_picked_up_with_a_cloud_embedder():
    with patch("services.indexer.settings") as s:
        s.embedder_provider = "gemini"
        assert index_sweep._private_still_embedded(_db([{"id": "n1", "user_id": "u1"}]), 20) == \
            [{"id": "n1", "user_id": "u1"}]


def test_nothing_to_clean_with_the_local_embedder():
    with patch("services.indexer.settings") as s:
        s.embedder_provider = "llamacpp"
        assert index_sweep._private_still_embedded(_db([{"id": "n1"}]), 20) == []
