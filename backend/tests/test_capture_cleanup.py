"""The AI's captures nobody inserted are removed after a week; nothing else is."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from services.agent import source_tools
from services.workspace import capture_cleanup
from tests.fake_db import FakeDB

NOW = datetime(2026, 11, 20, tzinfo=timezone.utc)
OLD, NEW = "2026-11-01T10:00:00Z", "2026-11-18T10:00:00Z"
U, VID, PDF = "u1", "v1", "p1"


class _Bucket:
    def __init__(self, files):
        self.files = files
    def list(self, folder):
        return [o for f, objs in self.files.items() if f == folder for o in objs]


def _db(notes):
    d = FakeDB(note_resources=[{"id": VID, "user_id": U, "kind": "youtube"},
                               {"id": PDF, "user_id": U, "kind": "pdf"}],
               notes=notes)
    files = {f"{U}/{VID}/captures": [
        {"name": "ai-frame-aaaa1111.jpg", "created_at": OLD},   # old, unused → removed
        {"name": "ai-clip-bbbb2222.mp4", "created_at": OLD},    # old, but in a note → kept
        {"name": "ai-audio-cccc3333.mp3", "created_at": NEW},   # unused, but recent → kept
        {"name": "frame-dddd4444.jpg", "created_at": OLD},      # the viewer's own → kept
    ]}
    d.storage = SimpleNamespace(from_=lambda _b: _Bucket(files))
    return d


def test_only_old_unused_ai_captures_go():
    notes = [{"id": "n1", "user_id": U, "content": [
        {"type": "video", "props": {"url": f"https://x/{U}/{VID}/captures/ai-clip-bbbb2222.mp4?token=t"}}]}]
    with patch.object(capture_cleanup, "get_supabase", return_value=_db(notes)), \
         patch("services.workspace.storage.remove") as remove:
        removed = capture_cleanup.sweep(now=NOW)
    assert removed == [f"{U}/{VID}/captures/ai-frame-aaaa1111.jpg"]
    remove.assert_called_once_with(removed)


def test_a_capture_in_a_trashed_or_other_note_is_kept():
    notes = [{"id": "n9", "user_id": U, "deleted_at": OLD, "content": [
        {"type": "image", "props": {"url": f"https://x/ai-frame-aaaa1111.jpg"}}]},
             {"id": "n8", "user_id": U, "content": [
        {"type": "video", "props": {"url": "https://x/ai-clip-bbbb2222.mp4"}}]}]
    with patch.object(capture_cleanup, "get_supabase", return_value=_db(notes)), \
         patch("services.workspace.storage.remove") as remove:
        assert capture_cleanup.sweep(now=NOW) == []
    remove.assert_not_called()


def test_the_ai_names_its_captures_so_and_the_viewer_does_not():
    from services.workspace import media
    seen = {}
    def fake_capture(resource, kind, start, end, prefix=""):
        seen["prefix"] = prefix
        return {"path": "p", "url": "u", "mime": "image/jpeg"}
    with patch.object(media, "capture", side_effect=fake_capture):
        source_tools._capture({"id": VID, "kind": "youtube"}, "frame", 1.0, None)
    assert seen["prefix"] == capture_cleanup.PREFIX == source_tools.AI_CAPTURE_PREFIX
    import inspect
    assert inspect.signature(media.capture).parameters["prefix"].default == ""
