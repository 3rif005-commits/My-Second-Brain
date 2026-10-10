"""M5: kill switch before every request, background runs, Activity, retry, recovery,
write-ahead append reconciliation, adaptive rate limiting, revoked token."""
import time

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.notion_sync as api
from services.notion_sync.engine import worker
from services.notion_sync.engine.store import Store
from services.notion_sync.notion.client import NotionClient, TokenBucket
from tests.notion_sync.conftest import T, USER, World
from tests.notion_sync.fake_notion import BOT, Crash

H = {"Authorization": "Bearer t"}


def paras(n):
    return [{"id": f"k{i}", "type": "paragraph", "props": {}, "content": [T(f"p{i}")], "children": []}
            for i in range(n)]


# ---- kill switch -----------------------------------------------------------------------------

def test_kill_switch_stops_before_the_next_request_and_resume_finishes(world):
    notes = [world.add_note(title=f"N{i}", content=paras(120)) for i in range(3)]   # 2 appends each
    state = {"n": 0}

    def gate():
        state["n"] += 1
        if state["n"] == 8:                                         # someone presses Pause mid-run
            world.db.tables["notion_connections"][0]["status"] = "paused"
        if world.db.tables["notion_connections"][0]["status"] == "paused":
            raise worker.SyncPaused()
    client = world.client(gate)
    from services.notion_sync.engine.runner import Engine
    from services.notion_sync.notion.adapter import NotionAdapter
    from services.notion_sync.planner import plan_scope
    eng = Engine(world.db, world.conn(), NotionAdapter(client, files=world.files))
    plan = plan_scope(world.db, eng.conn, eng.adapter, note_ids=[n["id"] for n in notes])
    res = eng.run(plan.items)
    assert res.status == "paused"
    assert any(i.status == "skipped" for i in res.items)
    # nothing more is written while paused
    writes_at_pause = world.notion.writes()
    res2 = world.engine().run(world.plan(*notes).items)
    assert world.notion.writes() == writes_at_pause and all(i.status == "skipped" for i in res2.items)
    # resume: it finishes, with no duplicates
    world.db.tables["notion_connections"][0]["status"] = "active"
    res3, _ = world.send(*notes)
    assert all(i.status == "done" for i in res3.items)
    for n in notes:
        assert len(world.notion.pages[world.mapping(n)["notion_id"]]["children"]) == 120
    assert len(world.notion.page_ids_in(world.mapping(notes[0])["notion_parent_id"])) == 3


def test_kill_switch_gate_reads_the_status_at_most_once_per_ttl(world):
    gate = worker.kill_switch(world.db, "c1", ttl=0.2)
    gate()
    world.db.tables["notion_connections"][0]["status"] = "paused"
    gate()                                                           # cached: no read yet
    time.sleep(0.25)
    with pytest.raises(worker.SyncPaused):
        gate()


# ---- adaptive rate limiting -----------------------------------------------------------------------

def test_rate_drops_after_a_429_and_recovers():
    t = {"now": 0.0}
    b = TokenBucket(rate=2.5, burst=3, clock=lambda: t["now"], sleep=lambda s: t.__setitem__("now", t["now"] + s))
    b.penalize()
    assert b.rate == pytest.approx(2.0)
    t["now"] += 601
    b.take()
    assert b.rate == 2.5


def test_a_429_counts_a_wait_and_slows_the_bucket():
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(429, headers={"Retry-After": "1"}, json={}) if len(calls) == 1 else httpx.Response(200, json={})
    bucket = TokenBucket(rate=1000, burst=1000)
    c = NotionClient("t", transport=httpx.MockTransport(h), bucket=bucket, sleep=lambda s: None)
    c.get("/x")
    assert c.rate_limit_waits == 1 and bucket.rate < 1000


# ---- write-ahead: a process that dies between an append and its bookkeeping -----------------------

def test_a_crash_between_append_and_bookkeeping_leaves_no_duplicates(world):
    n = world.add_note(content=paras(250))
    world.send(world.add_note())                                     # warm container
    world.notion.fail("PATCH /blocks/.*/children", "crash_after", times=1)
    with pytest.raises(Crash):
        world.send(n)                                                # the 1st chunk landed; nothing recorded
    pid = world.mapping(n)["notion_id"]
    assert len(world.notion.pages[pid]["children"]) == 100
    assert world.mapping(n)["block_index"]["pending"]["count"] == 100
    res, _ = world.send(n)                                           # a new process picks it up
    assert res.items[0].status == "done"
    assert len(world.notion.pages[pid]["children"]) == 250           # the orphaned 100 were reclaimed, not duplicated
    assert "pending" not in world.mapping(n)["block_index"]


def test_reclaim_ignores_blocks_that_do_not_match_what_was_about_to_land(world):
    n = world.add_note(content=paras(5))
    world.send(n)
    m = world.mapping(n)
    pid = m["notion_id"]
    adapter = world.engine().adapter
    got = adapter.reclaim_pending(pid, {"count": 3, "types": ["heading_1"] * 3}, {e["id"] for e in m["block_index"]["top"]})
    assert got == []


# ---- revoked token ----------------------------------------------------------------------------------------

def test_a_revoked_token_sets_the_connection_to_error_and_keeps_the_mappings(world):
    n = world.add_note()
    world.send(n)
    mapping_id = world.mapping(n)["id"]
    world.notion.transport = httpx.MockTransport(lambda r: httpx.Response(
        401, json={"object": "error", "status": 401, "code": "unauthorized", "message": "x"}))
    n2 = world.add_note(title="second")
    res, _ = world.send(n2)
    assert res.items[0].status == "needs_you" and "Reconnect" in res.items[0].message
    assert world.db.tables["notion_connections"][0]["status"] == "error"
    assert world.mapping(n)["id"] == mapping_id                       # kept for the reconnect


# ---- API: background run, activity, retry, recovery, pause, health ----------------------------------------

@pytest.fixture
def env(monkeypatch):
    w = World()
    monkeypatch.setattr(api, "get_user_id", lambda a: USER)
    monkeypatch.setattr(api, "get_supabase", lambda: w.db)
    monkeypatch.setattr(api, "_client", lambda token, gate=None: w.client(gate))
    bells = []

    async def fake_bell(user_id, run_id, done, bad, timeout=20.0):
        bells.append((user_id, run_id, done, bad))
    monkeypatch.setattr(worker, "bell", fake_bell)
    app = FastAPI()
    app.include_router(api.router)
    from core.config import settings
    from cryptography.fernet import Fernet
    monkeypatch.setattr(settings, "secrets_key", Fernet.generate_key().decode())
    from services import secrets
    w.db.tables["notion_connections"][0]["token_ciphertext"] = secrets.encrypt("tok").ciphertext.decode()
    return w, TestClient(app), bells


def wait_run(c, run_id, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        r = c.get(f"/notion/runs/{run_id}", headers=H).json()
        if r["status"] not in ("queued", "running"):
            return r
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def test_background_send_returns_at_once_and_progress_is_readable(env):
    w, c, bells = env
    n = w.add_note()
    r = c.post("/notion/send", json={"note_ids": [n["id"]], "background": True}, headers=H).json()
    assert r["status"] == "queued" and r["run_id"]
    done = wait_run(c, r["run_id"])
    assert done["status"] == "succeeded" and done["items"][0]["status"] == "done" and done["items"][0]["title"] == "A note"
    assert bells == []                                               # successes never ring the bell
    acts = c.get("/notion/runs", headers=H).json()["runs"]
    assert acts[0]["id"] == r["run_id"] and acts[0]["counts"]["done"] == 1


def test_a_failed_run_rings_the_bell_once_and_retry_failed_resends_only_those(env):
    w, c, bells = env
    n_ok, n_bad = w.add_note(title="ok"), w.add_note(title="bad")
    w.send(w.add_note())                                             # warm: container exists
    w.notion.fail("POST /pages", "500", times=1)
    r = c.post("/notion/send", json={"note_ids": [n_bad["id"], n_ok["id"]], "background": True}, headers=H).json()
    run = wait_run(c, r["run_id"])
    time.sleep(0.2)
    assert run["status"] == "partial" and [i["status"] for i in run["items"]] == ["failed", "done"]
    assert len(bells) == 1 and bells[0][1] == r["run_id"] and bells[0][3] == 1
    r2 = c.post(f"/notion/runs/{r['run_id']}/retry", headers=H).json()
    run2 = wait_run(c, r2["run_id"])
    assert run2["trigger"] == "retry" and [(i["title"], i["status"]) for i in run2["items"]] == [("bad", "done")]
    assert c.post(f"/notion/runs/{r2['run_id']}/retry", headers=H).json()["status"] == "nothing_to_send"


def test_interrupted_runs_are_recovered_and_can_be_retried(env):
    w, c, _ = env
    n = w.add_note()
    store = Store(w.db, USER, "c1")
    run = store.new_run({}, {}, [])
    store.begin_run(run["id"])
    rec = store.new_item(run["id"], n["id"], "create", None)
    store.start_item(rec["id"])
    w.db.tables["notion_runs"][0]["started_at"] = "2020-01-01T00:00:00+00:00"        # long ago, no thread
    runs = c.get("/notion/runs", headers=H).json()["runs"]
    assert runs[0]["status"] == "partial"
    detail = c.get(f"/notion/runs/{run['id']}", headers=H).json()
    assert detail["items"][0]["status"] == "failed" and "interrupted" in detail["items"][0]["message"].lower()
    r2 = c.post(f"/notion/runs/{run['id']}/retry", headers=H).json()
    assert wait_run(c, r2["run_id"])["items"][0]["status"] == "done"


def test_pause_and_resume_endpoints_and_health(env):
    w, c, _ = env
    n = w.add_note()
    assert c.post("/notion/pause", headers=H).json()["status"] == "paused"
    res = c.post("/notion/send", json={"note_ids": [n["id"]]}, headers=H)
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "PAUSED"
    assert c.post("/notion/resume", headers=H).json()["status"] == "active"
    c.post("/notion/send", json={"note_ids": [n["id"]]}, headers=H)
    h = c.get("/notion/health", headers=H).json()
    assert h["status"] == "active" and h["api_version"] == "2026-03-11" and h["mappings"]["synced"] >= 2
    assert h["failing"] == 0 and h["last_ok_at"]


def test_mid_run_pause_via_the_connection_row_halts_a_background_run(env):
    w, c, _ = env
    notes = [w.add_note(title=f"N{i}", content=paras(120)) for i in range(4)]
    seen = {"n": 0}
    orig = w.notion.handle

    def handle(req):
        seen["n"] += 1
        if seen["n"] == 10:
            w.db.tables["notion_connections"][0]["status"] = "paused"
        return orig(req)
    w.notion.transport = httpx.MockTransport(handle)
    r = c.post("/notion/send", json={"note_ids": [n["id"] for n in notes], "background": True}, headers=H).json()
    run = wait_run(c, r["run_id"])
    assert run["status"] == "paused" and any(i["status"] == "skipped" for i in run["items"])
