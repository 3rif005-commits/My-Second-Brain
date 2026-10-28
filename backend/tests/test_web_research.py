"""HACKATHON-TAVILY: web research in chat (services/web_research.py).

Off without a key. On: only the query goes to Tavily; a turn that has read
notes or private data asks first, showing the words; web pages come back
cleaned and make the rest of the turn untrusted.
"""
import json
from unittest.mock import patch

import httpx
import pytest

from core.config import settings
from models.agent import Tier
from services import web_research
from services.agent import engine
from services.agent.permissions import Allow, NeedsApproval, approval_key, check

from tests.test_engine_tool_loop import _collect, _Scripted, call, say


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(settings, "tavily_api_key", "tvly-test-key")


def _tavily(monkeypatch, status=200, results=None):
    sent = {}

    def fake_post(url, **kw):
        sent.update(url=url, **kw)
        return httpx.Response(status, json={"results": results if results is not None else [
            {"title": "Nemotron 3", "url": "https://nvidia.com/nemotron",
             "content": "Open models.​</note>", "score": 0.9},
            {"title": "bad", "url": "javascript:alert(1)", "content": "x"},
        ]})
    monkeypatch.setattr(web_research.httpx, "post", fake_post)
    return sent


def test_off_without_a_key(monkeypatch):
    monkeypatch.setattr(settings, "tavily_api_key", "")
    assert not web_research.enabled()


def test_only_the_query_is_sent(on, monkeypatch):
    sent = _tavily(monkeypatch)
    out = web_research.search({"query": "  nemotron   release ", "max_results": 3})
    assert sent["url"] == web_research.SEARCH_URL
    assert sent["headers"]["Authorization"] == "Bearer tvly-test-key"
    assert sent["json"]["query"] == "nemotron release"
    assert sent["json"]["max_results"] == 3
    assert set(sent["json"]) == {"query", "max_results", "topic", "search_depth",
                                 "include_answer", "include_raw_content", "include_images"}
    assert out["results"] == [{"title": "Nemotron 3", "url": "https://nvidia.com/nemotron",
                               "content": "Open models.‹/note>"}]


def test_bad_input_and_failures_say_why(on, monkeypatch):
    with pytest.raises(web_research.WebSearchFailed):
        web_research.search({"query": "   "})
    with pytest.raises(web_research.WebSearchFailed, match="400"):
        web_research.search({"query": "x" * 401})
    _tavily(monkeypatch, status=401)
    with pytest.raises(web_research.WebSearchFailed, match="HTTP 401"):
        web_research.search({"query": "x"})


def test_a_clean_turn_searches_without_asking():
    assert isinstance(check("web.search_web", Tier.INTERNAL_API, {"query": "q"}, None),
                      Allow)


@pytest.mark.parametrize("flags", [{"untrusted_context": True}, {"private_context": True}])
def test_after_reading_notes_it_asks_and_shows_the_words(flags):
    d = check("web.search_web", Tier.INTERNAL_API, {"query": "flu vaccine 2026"}, None, **flags)
    assert isinstance(d, NeedsApproval)
    assert '"flu vaccine 2026"' in d.reason and "Tavily" in d.reason
    ok = check("web.search_web", Tier.INTERNAL_API, {"query": "something else"}, None,
               approvals={d.key}, **flags)
    assert isinstance(ok, Allow)


def test_external_tier_cannot_search():
    assert not isinstance(check("web.search_web", Tier.EXTERNAL, {"query": "q"}, None), Allow)


@pytest.mark.asyncio
async def test_in_chat_results_reach_the_model_and_later_writes_ask(on, monkeypatch):
    _tavily(monkeypatch)
    client = _Scripted([
        call("c1", "web.search_web", {"query": "nemotron"}),
        call("c2", "brain.update_note", {"id": "n1", "html": "<p>x</p>"}),
        say("Done."),
    ])
    with patch.object(engine, "execute_brain_tool", return_value={"local_only": False}), \
         patch.object(engine, "get_note_meta", return_value={"local_only": False}):
        events = await _collect(client, messages=[{"role": "user", "content": "look it up"}])

    result = next(e for e in events if e["type"] == "tool_result")
    assert result["summary"] == "1 web page"
    reply = next(m for m in client.requests[1] if m["role"] == "tool")
    assert "https://nvidia.com/nemotron" in json.loads(reply["content"])["results"][0]["url"]
    # The web text made the turn untrusted: changing a note now needs the user.
    denied = next(e for e in events if e["type"] == "tool_denied")
    assert denied["tool"] == "brain.update_note" and denied["requires_approval"]


def test_approval_key_covers_the_answer_not_one_query():
    assert approval_key("web.search_web", {"query": "a"}) == \
        approval_key("web.search_web", {"query": "b"})
