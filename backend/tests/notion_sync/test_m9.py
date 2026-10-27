"""M9: the rest of the brain: chat threads, skills, a note's source files, "everything"."""
import re
from pathlib import Path

import pytest

from services.notion_sync.planner import CHANGED, NEW, PRIVATE, UNCHANGED, plan_scope
from services.notion_sync.readers import objects as objs
from services.portable import markdown_in
from tests.notion_sync.conftest import T, USER


# ---- markdown -> IR --------------------------------------------------------------------------------

def test_markdown_in_covers_what_chat_answers_use():
    md = "# Title\n\nSome **bold**, *it*, `code` and [a link](https://x.org).\n\n- one\n  - nested\n- [x] done\n\n1. first\n2. second\n\n> quoted\n\n```python\nprint(1)\n```\n\n---\n"
    bs = markdown_in.blocks(md)
    assert [b.type for b in bs] == ["heading", "paragraph", "list_item", "todo", "list_item", "list_item", "quote", "code", "divider"]
    p = bs[1].inline
    assert [(t.text, t.marks.get("bold"), t.marks.get("italic"), t.marks.get("code"), t.link) for t in p][1:6] == [
        ("bold", True, None, None, None), (", ", None, None, None, None), ("it", None, True, None, None),
        (", ", None, None, None, None), ("code", None, None, True, None)]
    assert bs[2].children[0].inline[0].text == "nested"
    assert bs[7].attrs["language"] == "python" and bs[7].inline[0].text == "print(1)"


def test_markdown_in_never_drops_odd_lines():
    bs = markdown_in.blocks("plain\nwrapped line\n\n| a | b |\n|---|---|\n")
    assert "".join(t.text for t in bs[0].inline) == "plain wrapped line"
    assert any("| a | b |" in "".join(t.text for t in b.inline) for b in bs)


# ---- chat threads -------------------------------------------------------------------------------------

def add_thread(world, messages, **kw):
    t = {"id": f"t-{len(world.db.tables['chat_threads'])}", "user_id": USER, "title": "My chat", "messages": messages,
         "context_note_ids": [], "pinned": False, "model_mode": "api", "archived_at": None,
         "created_at": "2026-10-01T10:00:00+00:00", "updated_at": "2026-10-01T10:05:00+00:00", **kw}
    world.db.tables["chat_threads"].append(t)
    return t


@pytest.fixture
def world(world):
    world.db.tables.setdefault("chat_threads", [])
    world.db.tables.setdefault("note_resources", [])
    return world


def test_a_thread_becomes_a_page_of_callouts_under_the_chats_page(world):
    t = add_thread(world, [{"role": "user", "content": "What is **entropy**?"},
                           {"role": "assistant", "content": "A measure of disorder:\n\n- first\n- second"},
                           {"role": "user", "content": "secret", "private": True}])
    plan = world.plan()                                                                  # nothing in scope: empty
    from services.notion_sync.planner import plan_scope as ps
    eng = world.engine()
    plan = ps(world.db, eng.conn, eng.adapter, thread_ids=[t["id"]])
    assert [(i.kind, i.state, i.path) for i in plan.items] == [("thread", NEW, "Chats")]
    assert "thread_private_messages" in {loss["code"] for loss in plan.items[0].losses}
    res = eng.run(plan.items)
    assert res.items[0].status == "done", res.items[0].message
    m = next(x for x in world.db.tables["notion_mappings"] if x["local_kind"] == "thread")
    page = world.notion.pages[m["notion_id"]]
    assert world.notion._title_of(m["notion_id"]) == "My chat" and page["icon"]["emoji"] == "💬"
    chats = world.notion.pages[page["parent"]["page_id"]]
    assert world.notion._title_of(page["parent"]["page_id"]) == "💬 Chats"
    kids = world.notion.tree(page["children"])
    assert [k["type"] for k in kids] == ["callout", "callout"]
    assert kids[0]["callout"]["icon"]["emoji"] == "🧑" and kids[1]["callout"]["icon"]["emoji"] == "🤖"
    assert kids[1]["callout"]["children"][1]["bulleted_list_item"]["rich_text"][0]["text"]["content"] == "first"
    assert "secret" not in str(kids)


def run_scope(world, **scope):
    eng = world.engine()
    plan = plan_scope(world.db, eng.conn, eng.adapter, **scope)
    return eng.run(plan.items), plan


def test_a_thread_citing_a_private_note_is_blocked_until_released(world):
    secret = world.add_note(sensitivity="private")
    t = add_thread(world, [{"role": "user", "content": "hi"}], context_note_ids=[secret["id"]])
    eng = world.engine()
    plan = plan_scope(world.db, eng.conn, eng.adapter, thread_ids=[t["id"]])
    assert plan.items[0].state == PRIVATE
    res, _ = run_scope(world, thread_ids=[t["id"]])
    assert res.items == [] and world.notion.calls == []
    plan = plan_scope(world.db, eng.conn, eng.adapter, thread_ids=[t["id"]], released={t["id"]})
    assert plan.items[0].state == NEW and plan.items[0].released
    assert world.engine().run(plan.items, frozenset({t["id"]})).items[0].status == "done"


def test_a_thread_citing_a_missing_note_counts_as_private(world):
    t = add_thread(world, [{"role": "user", "content": "hi"}], context_note_ids=["00000000-0000-0000-0000-000000000000"])
    eng = world.engine()
    assert plan_scope(world.db, eng.conn, eng.adapter, thread_ids=[t["id"]]).items[0].state == PRIVATE


def test_a_thread_resend_is_a_noop_and_a_new_message_updates_in_place(world):
    t = add_thread(world, [{"role": "user", "content": "one"}])
    run_scope(world, thread_ids=[t["id"]])
    writes = world.notion.writes()
    res, plan = run_scope(world, thread_ids=[t["id"]])
    assert plan.items[0].state == UNCHANGED and res.items == [] and world.notion.writes() == writes
    t["messages"].append({"role": "assistant", "content": "two"})
    res, plan = run_scope(world, thread_ids=[t["id"]])
    assert plan.items[0].state == CHANGED and res.items[0].action == "update"
    m = next(x for x in world.db.tables["notion_mappings"] if x["local_kind"] == "thread")
    assert len(world.notion.pages[m["notion_id"]]["children"]) == 2
    assert len([p for p in world.notion.pages.values() if world.notion._title_of(p["id"]) == "💬 Chats"]) == 1


# ---- skills ---------------------------------------------------------------------------------------------

@pytest.fixture
def skills(tmp_path, monkeypatch):
    builtin, user = tmp_path / "builtin", tmp_path / "user"
    (builtin / "study-guide" / "reference").mkdir(parents=True)
    (builtin / "study-guide" / "SKILL.md").write_text("---\ndescription: A guide\nsurfaces: [workspace]\n---\n# Study\n\nDo this **well**.\n")
    (builtin / "study-guide" / "reference" / "style.md").write_text("Plain words.\n")
    (builtin / "flashcards.md").write_text("---\ndescription: Cards\n---\nMake cards.\n")
    (user / "study-guide").mkdir(parents=True)
    (user / "study-guide" / "SKILL.md").write_text("---\ndescription: My guide\n---\n# Study (mine)\n")
    monkeypatch.setattr(objs, "skill_dirs", lambda user_id=None: [user, builtin])
    return builtin, user


def test_skills_load_with_the_users_copy_winning(skills):
    found = objs.load_skills(objs.skill_dirs())
    assert set(found) == {"study-guide", "flashcards"}
    assert found["study-guide"]["meta"]["description"] == "My guide"
    assert found["study-guide"]["refs"] == {}                                            # the user's copy has no references


def test_a_skill_becomes_a_page_with_references_in_toggles(world, skills):
    builtin, user = skills
    (user / "study-guide" / "SKILL.md").unlink()
    (user / "study-guide").rmdir()
    res, plan = run_scope(world, skill_names=["study-guide", "ghost"])
    assert [(i.kind, i.state) for i in plan.items] == [("skill", NEW), ("skill", "missing")]
    assert res.items[0].status == "done"
    m = next(x for x in world.db.tables["notion_mappings"] if x["local_kind"] == "skill")
    kids = world.notion.tree(world.notion.pages[m["notion_id"]]["children"])
    assert kids[0]["type"] == "callout" and kids[1]["type"] == "heading_1"
    assert kids[-1]["type"] == "toggle" and kids[-1]["toggle"]["rich_text"][0]["text"]["content"] == "Reference: reference/style.md"
    assert world.notion._title_of(world.notion.pages[m["notion_id"]]["parent"]["page_id"]) == "🧠 Skills"


def test_editing_a_skill_updates_its_page(world, skills):
    builtin, user = skills
    run_scope(world, skill_names=["flashcards"])
    (builtin / "flashcards.md").write_text("---\ndescription: Cards\n---\nMake BETTER cards.\n")
    res, plan = run_scope(world, skill_names=["flashcards"])
    assert plan.items[0].state == CHANGED and res.items[0].status == "done"


# ---- a note's sources --------------------------------------------------------------------------------------

def test_sources_are_off_by_default_and_travel_when_switched_on(world):
    n = world.add_note(title="With sources")
    world.db.tables["note_resources"] += [
        {"id": "r1", "note_id": n["id"], "user_id": USER, "kind": "pdf", "title": "Lecture 10", "storage_path": "u/r1/lecture.pdf",
         "mime_type": "application/pdf", "source_url": None, "order_index": 0},
        {"id": "r2", "note_id": n["id"], "user_id": USER, "kind": "youtube", "title": "A talk", "source_url": "https://youtu.be/abc",
         "storage_path": None, "order_index": 1},
        {"id": "r3", "note_id": n["id"], "user_id": USER, "kind": "website", "title": "An article", "source_url": "https://example.com/a",
         "storage_path": None, "order_index": 2}]
    world.files.blobs["storage:u/r1/lecture.pdf"] = (b"%PDF" + b"0" * 200, "application/pdf")
    world.send(n)
    tree = world.notion.tree(world.notion.pages[world.mapping(n)["notion_id"]]["children"])
    assert all(b["type"] != "toggle" for b in tree)                                      # off by default
    world.db.tables["notion_connections"][0]["include"] = {"source_files": True}
    plan = world.plan(n)
    assert plan.items[0].state == CHANGED                                               # switching it on is a change
    res, _ = world.send(n)
    assert res.items[0].status == "done", res.items[0].message
    tree = world.notion.tree(world.notion.pages[world.mapping(n)["notion_id"]]["children"])
    toggle = tree[-1]
    assert toggle["toggle"]["rich_text"][0]["text"]["content"] == "Sources"
    kinds = [c["type"] for c in toggle["toggle"]["children"]]
    assert kinds == ["pdf", "video", "bookmark"]
    pdf = toggle["toggle"]["children"][0]["pdf"]
    assert pdf["type"] == "file_upload"
    assert world.notion.uploads[pdf["file_upload"]["id"]]["filename"].endswith(".pdf")
    assert toggle["toggle"]["children"][1]["video"]["external"]["url"] == "https://youtu.be/abc"
    writes = world.notion.writes()
    assert world.send(n)[0].items == [] and world.notion.writes() == writes


def test_a_source_file_that_is_gone_becomes_a_marker(world):
    n = world.add_note()
    world.db.tables["note_resources"].append({"id": "r1", "note_id": n["id"], "user_id": USER, "kind": "pdf", "title": "Gone",
                                              "storage_path": "u/x.pdf", "order_index": 0})
    world.db.tables["notion_connections"][0]["include"] = {"source_files": True}
    res, _ = world.send(n)
    assert res.items[0].status == "done" and "media_unavailable" in {loss["code"] for loss in res.items[0].losses}


# ---- hard limits -----------------------------------------------------------------------------------------------

def test_nothing_from_the_deny_list_is_ever_read_by_the_mirror():
    root = Path(__file__).resolve().parents[2] / "services" / "notion_sync"
    banned = ("ai_providers", "mcp_servers", "mcp_grants", "api_key", "preferences")
    offenders = [f"{p.relative_to(root)}: {w}" for p in root.rglob("*.py") for w in banned if w in p.read_text()]
    assert offenders == []
