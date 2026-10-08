"""M8: the mirror map (sidebar dots), whole-brain scope, auto-sync rules and their hard limits."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.notion_sync as api
from services.notion_sync import auto, scope
from tests.notion_sync.conftest import T, USER, World
from tests.notion_sync.test_m3 import para_with

H = {"Authorization": "Bearer t"}
NOW = datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat()


def stamp(note, minutes_ago):
    note["updated_at"] = iso(NOW - timedelta(minutes=minutes_ago))


# ---- the mirror map -----------------------------------------------------------------------------

def test_mirror_states(world):
    sent, changed, private, never = (world.add_note(title=t) for t in ("sent", "changed", "private", "never"))
    private["sensitivity"] = "private"
    for n in (sent, changed):
        stamp(n, 120)
    world.send(sent, changed)
    for m in world.db.tables["notion_mappings"]:
        m["last_pushed_at"] = iso(NOW - timedelta(minutes=60))
    stamp(changed, 5)                                                       # edited after the last send
    mm = scope.mirror_map(world.db, world.conn())
    assert mm["notes"][sent["id"]] == "synced" and mm["notes"][changed["id"]] == "changed"
    assert mm["notes"][private["id"]] == "private" and never["id"] not in mm["notes"]


def test_mirror_failed_paused_needs_you_and_deleted(world):
    a, b, c, d = (world.add_note(title=t) for t in "abcd")
    world.send(a, b, c, d)
    ms = {n["id"]: world.mapping(n) for n in (a, b, c, d)}
    ms[a["id"]]["state"] = "failed"
    ms[b["id"]]["paused"] = True
    ms[c["id"]].update(error_code="edited_in_notion", error_class="needs_user")
    d["deleted_at"] = iso(NOW)
    for n in (a, b, c):
        n["updated_at"] = "2000-01-01T00:00:00+00:00"
    mm = scope.mirror_map(world.db, world.conn())["notes"]
    assert (mm[a["id"]], mm[b["id"]], mm[c["id"]], mm[d["id"]]) == ("failed", "paused", "needs_you", "deleted")


def test_a_folder_shows_the_worst_state_inside(world):
    top, sub = world.add_collection("Top"), None
    sub = world.add_collection("Sub", parent=top)
    n1, n2 = world.add_note(collection_id=sub["id"]), world.add_note(collection_id=top["id"])
    world.send(n1, n2)
    for n in (n1, n2):
        n["updated_at"] = "2000-01-01T00:00:00+00:00"
    assert scope.mirror_map(world.db, world.conn())["collections"][top["id"]] == "synced"
    world.mapping(n1)["state"] = "failed"
    mm = scope.mirror_map(world.db, world.conn())["collections"]
    assert mm[sub["id"]] == "failed" and mm[top["id"]] == "failed"


# ---- whole brain -----------------------------------------------------------------------------------

def test_all_scope_respects_the_d5_switches(world):
    col = world.add_collection("C")
    loose, filed = world.add_note(title="loose"), world.add_note(title="filed", collection_id=col["id"])
    db, ds = world.add_db("T")
    row = world.add_row(ds, "row")
    gone = world.add_note(title="gone", deleted_at=iso(NOW))
    notes, colls, dbs = scope.all_scope(world.db, USER)
    assert set(notes) == {loose["id"], filed["id"]} and colls == [col["id"]] and dbs == [db["id"]]     # rows travel with their database
    assert scope.all_scope(world.db, USER, {"notes": False})[0] == []
    assert scope.all_scope(world.db, USER, {"databases": False})[2] == []


# ---- auto-sync -----------------------------------------------------------------------------------------

def rule(world, kind="all", sid=None, mode="on_change"):
    world.db.tables["notion_rules"].append({"id": f"r{len(world.db.tables['notion_rules'])}", "user_id": USER, "connection_id": "c1",
                                            "scope_kind": kind, "scope_id": sid, "mode": mode, "include": {}})


def tick(world, now=NOW):
    return auto.run_due(world.db, lambda conn, gate: world.client(gate), now)


@pytest.fixture
def w():
    w = World()
    w.db.tables["notion_rules"] = []
    return w


def test_on_change_waits_for_the_debounce_then_sends(w):
    n = w.add_note()
    stamp(n, 3)
    rule(w)
    assert tick(w) == [] and w.notion.calls == []                             # edited 3 minutes ago: still typing
    stamp(n, 11)
    out = tick(w)
    assert out and out[0]["sent"] == 1 and w.mapping(n)["state"] == "synced"
    assert w.db.tables["notion_runs"][-1]["trigger"] == "auto"
    assert tick(w) == []                                                        # nothing changed since


def test_auto_sync_picks_up_a_new_note_in_a_scoped_collection_only(w):
    col, other = w.add_collection("Watched"), w.add_collection("Other")
    inside, outside = w.add_note(collection_id=col["id"]), w.add_note(collection_id=other["id"])
    for n in (inside, outside):
        stamp(n, 60)
    rule(w, "collection", col["id"])
    tick(w)
    assert w.mapping(inside) is not None and w.mapping(outside) is None


def test_auto_sync_never_sends_private_notes(w):
    n = w.add_note(sensitivity="private")
    stamp(n, 60)
    rule(w)
    tick(w)
    assert w.mapping(n) is None and not [c for c in w.notion.calls if c[0] == "POST" and c[1] == "/pages"]


def test_auto_sync_never_overwrites_a_page_edited_in_notion(w):
    n = w.add_note()
    stamp(n, 120)
    w.send(n)
    w.mapping(n)["last_pushed_at"] = iso(NOW - timedelta(minutes=90))
    w.notion.human_edit(w.mapping(n)["notion_id"])
    n["content"] = [{"id": "p", "type": "paragraph", "props": {}, "content": [T("mine")], "children": []}]
    stamp(n, 20)
    rule(w)
    writes = w.notion.writes()
    out = tick(w)
    assert w.notion.writes() == writes and (not out or out[0].get("sent", 0) == 0)


def test_auto_sync_does_not_archive_deleted_notes(w):
    n = w.add_note()
    stamp(n, 120)
    w.send(n)
    n["deleted_at"] = iso(NOW - timedelta(hours=1))
    rule(w)
    tick(w)
    assert w.mapping(n)["state"] == "synced"


def test_a_failing_note_backs_off(w):
    n = w.add_note()
    stamp(n, 60)
    w.send(w.add_note())
    rule(w)
    w.notion.fail("POST /pages", "500", times=1)
    tick(w)
    assert w.mapping(n) is None or w.mapping(n)["state"] in ("creating", "failed")
    calls = len(w.notion.calls)
    tick(w, NOW + timedelta(minutes=2))                                          # retried too soon: skipped
    after_two = len(w.notion.calls)
    tick(w, NOW + timedelta(minutes=30))
    assert after_two - calls <= 2 and len(w.notion.calls) > after_two - 0


def test_daily_runs_once_a_day(w):
    n = w.add_note()
    stamp(n, 5)                                                                   # too recent for on_change
    rule(w, mode="daily")
    out = tick(w)
    assert out and out[0]["sent"] == 1                                            # daily ignores the debounce
    n["content"] = [{"id": "p", "type": "paragraph", "props": {}, "content": [T("again")], "children": []}]
    stamp(n, 1)
    w.mapping(n)["last_pushed_at"] = iso(NOW - timedelta(minutes=30))
    assert tick(w, NOW + timedelta(hours=2)) == []                                # not yet a day
    assert tick(w, NOW + timedelta(hours=25))[0]["sent"] == 1


def test_manual_rules_and_a_paused_connection_do_nothing(w):
    n = w.add_note()
    stamp(n, 60)
    rule(w, mode="manual")
    assert tick(w) == []
    w.db.tables["notion_rules"].clear()
    rule(w)
    w.db.tables["notion_connections"][0]["status"] = "paused"
    assert tick(w) == [] and w.notion.calls == []


def test_a_busy_connection_is_skipped(w):
    from services.notion_sync.engine.runner import connection_lock
    n = w.add_note()
    stamp(n, 60)
    rule(w)
    lock = connection_lock("c1")
    lock.acquire()
    try:
        assert tick(w) == []
    finally:
        lock.release()


# ---- the API -------------------------------------------------------------------------------------------

@pytest.fixture
def env(monkeypatch):
    w = World()
    w.db.tables["notion_rules"] = []
    monkeypatch.setattr(api, "get_user_id", lambda a: USER)
    monkeypatch.setattr(api, "get_supabase", lambda: w.db)
    monkeypatch.setattr(api, "_client", lambda token, gate=None: w.client(gate))
    from cryptography.fernet import Fernet
    from core.config import settings
    from services import secrets
    monkeypatch.setattr(settings, "secrets_key", Fernet.generate_key().decode())
    w.db.tables["notion_connections"][0]["token_ciphertext"] = secrets.encrypt("tok").ciphertext.decode()
    app = FastAPI()
    app.include_router(api.router)
    return w, TestClient(app)


def test_rules_crud_and_include_switches(env):
    w, c = env
    r = c.post("/notion/rules", json={"scope_kind": "all", "mode": "daily"}, headers=H).json()
    assert r["scope_kind"] == "all" and r["mode"] == "daily"
    c.post("/notion/rules", json={"scope_kind": "all", "mode": "on_change"}, headers=H)       # same scope: updated, not duplicated
    rules = c.get("/notion/rules", headers=H).json()["rules"]
    assert len(rules) == 1 and rules[0]["mode"] == "on_change"
    assert c.post("/notion/rules", json={"scope_kind": "note", "mode": "daily"}, headers=H).status_code == 422
    assert c.post("/notion/rules", json={"scope_kind": "bogus"}, headers=H).status_code == 422
    assert c.delete(f"/notion/rules/{rules[0]['id']}", headers=H).json()["deleted"] == rules[0]["id"]
    assert c.get("/notion/rules", headers=H).json()["rules"] == []
    inc = c.put("/notion/include", json={"include": {"threads": True, "evil": True, "notes": False}}, headers=H).json()["include"]
    assert inc["threads"] is True and inc["notes"] is False and "evil" not in inc
    assert c.get("/notion/include", headers=H).json()["include"]["threads"] is True


def test_send_everything_follows_the_switches(env):
    w, c = env
    c.post("/notion/root", json={"page_id": w.notion.root}, headers=H)
    col = w.add_collection("C")
    a, b = w.add_note(title="loose"), w.add_note(title="filed", collection_id=col["id"])
    plan = c.post("/notion/plan", json={"all": True}, headers=H).json()
    assert {i["title"] for i in plan["items"] if i["state"] == "new"} == {"C", "loose", "filed"}
    c.put("/notion/include", json={"include": {"notes": False}}, headers=H)
    plan = c.post("/notion/plan", json={"all": True}, headers=H).json()
    assert {i["title"] for i in plan["items"]} == {"C"} or {i["title"] for i in plan["items"] if i["kind"] == "note"} == {"filed"}
    r = c.post("/notion/send", json={"all": True}, headers=H).json()
    assert r["status"] in ("succeeded", "nothing_to_send")


def test_mirror_endpoint(env):
    w, c = env
    assert c.get("/notion/mirror", headers=H).json()["connected"] is True
    n = w.add_note()
    c.post("/notion/root", json={"page_id": w.notion.root}, headers=H)
    c.post("/notion/send", json={"note_ids": [n["id"]]}, headers=H)
    n["updated_at"] = "2000-01-01T00:00:00+00:00"
    assert c.get("/notion/mirror", headers=H).json()["notes"][n["id"]] == "synced"


def test_unticked_items_are_not_sent_and_a_folder_can_go_without_its_contents(env):
    w, c = env
    c.post("/notion/root", json={"page_id": w.notion.root}, headers=H)
    col = w.add_collection("C")
    a, b = w.add_note(title="a", collection_id=col["id"]), w.add_note(title="b", collection_id=col["id"])
    plan = c.post("/notion/plan", json={"collection_ids": [col["id"]], "exclude": [b["id"]]}, headers=H).json()
    assert {i["title"]: i["selected"] for i in plan["items"]} == {"C": True, "a": True, "b": False}
    r = c.post("/notion/send", json={"collection_ids": [col["id"]], "exclude": [b["id"]]}, headers=H).json()
    assert [i["title"] for i in r["items"]] == ["C", "a"] and w.mapping(b) is None
    only = c.post("/notion/plan", json={"only_collection_ids": [col["id"]]}, headers=H).json()
    assert [i["title"] for i in only["items"]] == ["C"]
