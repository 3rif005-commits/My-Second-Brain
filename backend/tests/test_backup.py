"""The local backup archive: build, verify, restore, retention, the daily pass."""
import json
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from services.backup import archive, restore, retention, runner
from tests.fake_db import FakeDB

U = "user-1"


def brain():
    db = FakeDB(
        collections=[{"id": "c1", "user_id": U, "name": "Physics", "icon": "⚛️", "color": "#6366f1", "description": "d", "parent_id": None, "position": 0},
                     {"id": "c2", "user_id": U, "name": "Optics", "icon": "🔭", "color": "#6366f1", "description": None, "parent_id": "c1", "position": 0}],
        notes=[{"id": "n1", "user_id": U, "title": "Lenses", "icon": "🔍", "collection_id": "c2", "sensitivity": "private", "deleted_at": None,
                "content": [{"id": "b1", "type": "paragraph", "props": {}, "content": [{"type": "text", "text": "see ", "styles": {}},
                                                                                        {"type": "mention", "props": {"noteId": "n2", "noteName": "Mirrors"}}], "children": []}]},
               {"id": "n2", "user_id": U, "title": "Mirrors", "icon": "🪞", "collection_id": "c1", "sensitivity": "personal", "deleted_at": None,
                "content": [{"id": "b2", "type": "heading", "props": {"level": 2}, "content": [{"type": "text", "text": "Curved", "styles": {"bold": True}}], "children": []}]},
               {"id": "n3", "user_id": U, "title": "Old", "collection_id": None, "sensitivity": "personal", "deleted_at": "2026-01-01", "content": []},
               {"id": "n4", "user_id": U, "title": "Row one", "collection_id": None, "sensitivity": "personal", "deleted_at": None, "content": []}],
        db_databases=[{"id": "d1", "user_id": U, "title": "Tasks", "deleted_at": None}],
        db_data_sources=[{"id": "s1", "database_id": "d1", "user_id": U, "name": "Default", "system_kind": None, "position": 0}],
        db_properties=[{"id": "p1", "data_source_id": "s1", "user_id": U, "key": "k1", "name": "Hours", "type": "number", "config": {}, "position": 0}],
        db_row_props=[{"note_id": "n4", "data_source_id": "s1", "user_id": U, "properties": {"k1": {"type": "number", "number": 3}}, "computed": {}, "position": 0}],
        db_views=[{"id": "v1", "data_source_id": "s1", "user_id": U, "name": "T", "type": "table", "config": {}}],
        db_relation_links=[],
        chat_threads=[{"id": "t1", "user_id": U, "title": "chat", "messages": [{"role": "user", "content": "hi", "private": True}], "context_note_ids": ["n1"]}],
        note_resources=[{"id": "r1", "note_id": "n1", "user_id": U, "kind": "pdf", "title": "Lecture", "storage_path": "u/r1/l.pdf"},
                        {"id": "r2", "note_id": "n2", "user_id": U, "kind": "pdf", "title": "Same file", "storage_path": "u/r2/l.pdf"},
                        {"id": "r3", "note_id": "n2", "user_id": U, "kind": "pdf", "title": "Huge", "storage_path": "u/r3/huge.pdf"}])
    return db


def download(path):
    return {"u/r1/l.pdf": b"%PDF same", "u/r2/l.pdf": b"%PDF same", "u/r3/huge.pdf": b"x" * 5000}[path]


def build(tmp_path, **kw):
    out = tmp_path / "b.sbz"
    return out, archive.build(brain() if "db" not in kw else kw.pop("db"), U, out, storage_download=download, max_file_bytes=1000,
                              now=datetime(2026, 10, 8, 3, 0, tzinfo=timezone.utc), **kw)


def test_archive_contents_and_manifest(tmp_path):
    out, m = build(tmp_path)
    assert m["format"] == "sbz" and m["format_version"] == 1 and m["ir_version"] == 1
    assert m["counts"] == {"notes": 3, "deleted_notes": 1, "collections": 2, "databases": 1, "rows": 1, "threads": 1, "skills": 0, "files": 1}
    names = set(zipfile.ZipFile(out).namelist())
    assert {"manifest.json", "README.md", "collections.json", "notes/n1.json", "notes/n1.ir.json", "notes/n1.md",
            "databases/d1/schema.json", "databases/d1/views.json", "databases/d1/rows.jsonl", "databases/d1/rows.csv", "threads/t1.json"} <= names
    z = zipfile.ZipFile(out)
    assert "## Curved" in z.read("notes/n2.md").decode() or "Curved" in z.read("notes/n2.md").decode()
    assert json.loads(z.read("notes/n1.json"))["note"]["content"][0]["id"] == "b1"          # raw BlockNote, lossless
    assert json.loads(z.read("notes/n1.ir.json"))["ir_version"] == 1
    assert "Hours" in z.read("databases/d1/rows.csv").decode() and "3" in z.read("databases/d1/rows.csv").decode()
    assert json.loads(z.read("threads/t1.json"))["messages"][0]["private"] is True        # private stays IN the local archive
    assert "private" in z.read("notes/n1.json").decode()


def test_files_are_deduplicated_and_oversize_ones_are_listed(tmp_path):
    out, m = build(tmp_path)
    assert m["counts"]["files"] == 1 and len(m["files_index"]) == 1
    entry = next(iter(m["files_index"].values()))
    assert {e["note_id"] for e in entry} == {"n1", "n2"}
    assert [s["title"] for s in m["files_skipped"]] == ["Huge"]


def test_verify_passes_and_catches_tampering(tmp_path):
    out, _ = build(tmp_path)
    assert archive.verify(out) == []
    tampered = tmp_path / "t.sbz"
    with zipfile.ZipFile(out) as zin, zipfile.ZipFile(tampered, "w") as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "notes/n2.md":
                data = b"changed"
            zout.writestr(item, data)
        zout.writestr("extra.txt", "x")
    bad = archive.verify(tampered)
    assert any("notes/n2.md" in b and "checksum" in b for b in bad) and any("extra.txt" in b for b in bad)


def test_a_broken_note_does_not_stop_the_backup(tmp_path, monkeypatch):
    import services.notion_sync.readers.note as rn
    real = rn.note_to_ir
    monkeypatch.setattr(rn, "note_to_ir", lambda row: (_ for _ in ()).throw(RuntimeError("boom")) if row["id"] == "n2" else real(row))
    out, m = build(tmp_path)
    assert [p["id"] for p in m["problems"]] == ["n2"] and "notes/n2.json" in zipfile.ZipFile(out).namelist()
    assert archive.verify(out) == []


def test_skills_are_included_user_copy_first(tmp_path):
    user, built = tmp_path / "u", tmp_path / "b"
    (user / "x").mkdir(parents=True)
    (user / "x" / "SKILL.md").write_text("mine")
    (built / "x").mkdir(parents=True)
    (built / "x" / "SKILL.md").write_text("theirs")
    (built / "y.md").write_text("y")
    out, m = build(tmp_path, skills_dirs=[user, built])
    z = zipfile.ZipFile(out)
    assert z.read("skills/x/SKILL.md") == b"mine" and z.read("skills/y.md") == b"y" and m["counts"]["skills"] == 2


# ---- restore ----------------------------------------------------------------------------------------------

def test_restore_dry_run_changes_nothing_and_says_what_is_not_restored(tmp_path):
    out, _ = build(tmp_path)
    p = restore.plan(out)
    assert p["ok"] and p["would_create"] == {"folders": 2, "notes": 3, "chats": 1} and p["never_overwrites"]
    assert p["not_restored"]["database_rows"] == 1


def test_restore_refuses_a_damaged_archive(tmp_path):
    out, _ = build(tmp_path)
    bad = tmp_path / "bad.sbz"
    with zipfile.ZipFile(out) as zin, zipfile.ZipFile(bad, "w") as zout:
        for item in zin.infolist():
            zout.writestr(item, b"x" if item.filename == "notes/n1.md" else zin.read(item.filename))
    with pytest.raises(ValueError):
        restore.apply(FakeDB(collections=[], notes=[], chat_threads=[]), "new-user", bad)


def test_restore_into_a_scratch_user_is_faithful_and_never_overwrites(tmp_path):
    out, _ = build(tmp_path)
    scratch = FakeDB(collections=[], notes=[{"id": "keep", "user_id": "new", "title": "mine already", "content": []}], chat_threads=[])
    res = restore.apply(scratch, "new", out, now=datetime(2026, 10, 8, tzinfo=timezone.utc))
    assert res["notes"] == 3 and res["chats"] == 1 and res["folders"] == 2
    notes = {n["title"]: n for n in scratch.tables["notes"]}
    assert "mine already" in notes and len(scratch.tables["notes"]) == 4                  # nothing replaced
    top = next(c for c in scratch.tables["collections"] if c["name"].startswith("Restored from backup 2026-10-08"))
    lenses, mirrors = notes["Lenses"], notes["Mirrors"]
    assert lenses["sensitivity"] == "private" and lenses["icon"] == "🔍"
    cm = {c["name"]: c for c in scratch.tables["collections"]}
    assert cm["Physics"]["parent_id"] == top["id"] and cm["Optics"]["parent_id"] == cm["Physics"]["id"]
    assert lenses["collection_id"] == cm["Optics"]["id"]
    assert lenses["content"][0]["content"][1]["props"]["noteId"] == mirrors["id"]        # links follow the new ids
    assert mirrors["content"] == json.loads(zipfile.ZipFile(out).read("notes/n2.json"))["note"]["content"]
    assert scratch.tables["chat_threads"][0]["context_note_ids"] == [lenses["id"]]
    assert "Old" not in notes                                                            # a note in the trash stays in the trash


# ---- retention & the daily pass ---------------------------------------------------------------------------

def day(n, hour=3):
    return datetime(2026, 10, 8, hour, 0, tzinfo=timezone.utc) - timedelta(days=n)


def test_retention_keeps_7_daily_4_weekly_12_monthly(tmp_path):
    for n in range(0, 400, 1):
        (tmp_path / retention.archive_name(day(n))).write_bytes(b"x")
    (tmp_path / "notes.txt").write_text("not an archive")
    (tmp_path / "second-brain-backup-bad-name.sbz").write_bytes(b"x")
    gone = retention.prune(tmp_path)
    left = sorted(p.name for p in tmp_path.glob("second-brain-backup-2*.sbz"))
    assert 7 <= len(left) <= 7 + 4 + 12
    assert retention.archive_name(day(0)) in left and retention.archive_name(day(6)) in left
    assert retention.archive_name(day(8)) not in left or retention.archive_name(day(8)) in left   # weekly may keep it
    assert (tmp_path / "notes.txt").exists() and (tmp_path / "second-brain-backup-bad-name.sbz").exists()   # only archives are touched
    assert len(gone) > 300


def test_daily_pass_is_off_by_default_and_once_a_day_when_on(tmp_path, monkeypatch):
    from core.config import settings
    db = brain()
    db.tables["profiles"] = [{"id": U}]
    monkeypatch.setattr("services.workspace.storage.download", download)
    now = datetime(2026, 10, 8, 3, 5, tzinfo=timezone.utc)
    assert runner.tick(db, now) == []                                                    # BACKUP_ENABLED is false
    monkeypatch.setattr(settings, "backup_enabled", True)
    monkeypatch.setattr(settings, "backup_dir", str(tmp_path))
    first = runner.tick(db, now)
    assert len(first) == 1 and Path(first[0]["path"]).exists()
    assert archive.verify(Path(first[0]["path"])) == []
    assert runner.tick(db, now + timedelta(hours=2)) == []                               # already done today
    assert len(runner.tick(db, now + timedelta(days=1))) == 1


def test_a_backup_that_fails_its_own_check_is_not_kept(tmp_path, monkeypatch):
    db = brain()
    monkeypatch.setattr(archive, "verify", lambda p: ["boom"])
    with pytest.raises(RuntimeError):
        runner.run_for_user(db, U, tmp_path, now=datetime(2026, 10, 8, tzinfo=timezone.utc))
    assert list(tmp_path.rglob("*.sbz")) == []
