"""Contract tests: replay the REAL Notion responses saved by the live probe
(docs/notion-sync/evidence/live/**/T*.json). No network. They pin the shapes
our adapter parses and the error bodies it classifies, so a Notion change is
caught by re-recording, and our own regressions are caught here."""
import json
import re
from pathlib import Path

import httpx
import pytest

from services.notion_sync.notion.adapter import NotionAdapter
from services.notion_sync.notion.client import NotionClient, TokenBucket
from services.notion_sync.notion.errors import NotionError
from services.notion_sync.notion.languages import NOTION_LANGUAGES

LIVE = Path(__file__).resolve().parents[3] / "docs" / "notion-sync" / "evidence" / "live"
RUN = LIVE / "2026-10-08T10-30-25Z"


def cassette(name):
    return json.loads((RUN / f"{name}.json").read_text())["calls"]


def norm(path):
    return re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27}", "{id}", path.split("?")[0])


def replay(calls):
    """A transport that answers each request with the next recorded response
    for the same method + normalised path."""
    pool = list(calls)

    def handler(req: httpx.Request):
        key = (req.method, norm(req.url.path.removeprefix("/v1")))
        for i, c in enumerate(pool):
            if (c["method"], norm(c["path"])) == key:
                pool.pop(i)
                return httpx.Response(c["status"], json=c["response"])
        raise AssertionError(f"no recorded response for {key}")
    return NotionClient("t", transport=httpx.MockTransport(handler),
                        bucket=TokenBucket(rate=1000, burst=1000), sleep=lambda s: None)


def calls_where(calls, method, path_re, status=200):
    return [c for c in calls if c["method"] == method and re.fullmatch(path_re, norm(c["path"]))
            and c["status"] == status]


def test_cassettes_exist():
    assert (RUN / "T9.json").exists() and (RUN / "_env.json").exists()


def test_whoami_parses_the_recorded_bot():
    me = [c for c in cassette("_env") if c["path"] == "/users/me"][0]
    a = NotionAdapter(replay([me]))
    bot = a.whoami()
    assert bot.is_bot and bot.bot_id == me["response"]["id"]
    assert bot.workspace_name == "My second brain backup"
    assert bot.max_upload_bytes == 5242880


def test_shared_pages_parse_the_recorded_search():
    s = [c for c in cassette("_env") if c["path"] == "/search"][0]
    pages = NotionAdapter(replay([s])).list_shared_pages()
    assert pages and pages[0].title == "SB-TEST-root" and pages[0].top and pages[0].icon == "🧪"
    assert pages[0].url.startswith("https://")


def test_get_page_parses_recorded_page_and_edit_author():
    c = calls_where(cassette("T2"), "GET", r"/pages/\{id\}")[0]
    info = NotionAdapter(replay([c])).get_page(c["response"]["id"])
    assert info.id == c["response"]["id"] and info.last_edited_by == c["response"]["last_edited_by"]["id"]
    assert info.last_edited_time == c["response"]["last_edited_time"] and not info.unreachable


def test_create_database_response_gives_data_source_id():
    c = calls_where(cassette("T4"), "POST", r"/databases")[0]
    db = NotionAdapter(replay([c])).create_notes_database("3f37b5cb-32d0-8161-865e-d8df2bcf630f")
    assert db.database_id == c["response"]["id"]
    assert db.data_source_id == c["response"]["data_sources"][0]["id"]


def test_append_response_gives_one_id_per_block():
    c = calls_where(cassette("T3"), "PATCH", r"/blocks/\{id\}/children")[0]
    a = NotionAdapter(replay([c]))
    ids = a._append_once("3f37b5cb-32d0-8138-a161-dbf09942ea27", c["request"]["children"])
    assert ids == [b["id"] for b in c["response"]["results"]]


def test_children_listing_paginates_with_recorded_shape():
    c = calls_where(cassette("T1"), "GET", r"/blocks/\{id\}/children")[0]
    assert NotionAdapter(replay([c]))._children("3f37b5cb-32d0-8138-a517-eed64b1ed5b4") == []


def test_our_append_request_has_the_recorded_shape():
    rec = calls_where(cassette("T3"), "PATCH", r"/blocks/\{id\}/children")[0]["request"]
    seen = {}

    def h(req):
        seen.update(json.loads(req.content))
        return httpx.Response(200, json={"results": [{"id": "x", "type": "paragraph"}]})
    c = NotionClient("t", transport=httpx.MockTransport(h), bucket=TokenBucket(rate=1000, burst=1000))
    NotionAdapter(c)._append_once("p", rec["children"])
    assert seen == rec


def test_recorded_validation_errors_are_classified_permanent():
    for name, status_calls in (("T1", cassette("T1")), ("T9", cassette("T9"))):
        errs = [c for c in status_calls if c["status"] == 400]
        assert errs
        for c in errs:
            cl = replay([c])
            with pytest.raises(NotionError) as e:
                cl.request(c["method"], c["path"], json=c["request"], create=True)
            assert e.value.code == "validation_error" and e.value.error_class == "permanent"


def test_language_enum_matches_what_notion_returned():
    err = next(c for c in cassette("T9") if c["status"] == 400 and "language should be" in json.dumps(c["response"]))
    enum = re.findall(r"`\"([^`\"]+)\"`", err["response"]["message"].split("language should be")[1])
    enum = {e for e in enum if e != "jsx"}               # last item is the echoed bad value
    assert NOTION_LANGUAGES == enum, (NOTION_LANGUAGES ^ enum)


def test_recorded_limits_agree_with_ours():
    from services.notion_sync.notion.limits import MAX_TEXT_UNITS
    err = [c for c in cassette("T9") if c["status"] == 400 and "2000" in json.dumps(c["response"])][0]
    assert MAX_TEXT_UNITS == 2000 and "2002" in err["response"]["message"]       # 1,001 emoji = 2,002 units


def test_recorded_atomic_append_means_a_failed_chunk_wrote_nothing():
    t1 = cassette("T1")
    assert [c["status"] for c in t1 if c["method"] == "PATCH"] == [400]
    kids = [c for c in t1 if c["method"] == "GET" and "children" in c["path"]][0]
    assert kids["response"]["results"] == []
