"""The privacy gate for whole-note work: synthesis, skills, background jobs,
source processing, indexing (services/privacy.handling + check_provider).

Chat cuts context to fit the provider; a job cannot (its sources are the job),
so the provider must fit the note. Asserted at the wire: a refused call never
reaches the provider's HTTP code.
"""
import asyncio

import pytest

from services import privacy
from services.ai import router
from services.ai.providers import Provider

pytestmark = pytest.mark.real_routing

CLOUD = Provider("anthropic", api_key="k", label="Anthropic",
                 capabilities={"text", "vision", "long_context", "batch"})
GATEWAY = Provider("openai_compatible", api_key="k", label="OpenRouter",
                   base_url="https://openrouter.ai/api/v1", capabilities={"text"})
LOCAL = Provider("local", label="Local", capabilities={"text"})
LEVELS = {"priv": {"level": "private", "title": "Health log"},
          "pers": {"level": "personal", "title": "Diary"},
          "open": {"level": "open", "title": "Linear algebra"}}


@pytest.fixture(autouse=True)
def world(monkeypatch):
    monkeypatch.setattr(privacy, "fetch_levels",
                        lambda ids, uid: {i: LEVELS[i] for i in ids if i in LEVELS})
    monkeypatch.setattr("services.ai.providers.list_providers",
                        lambda uid: [CLOUD, GATEWAY, LOCAL])
    monkeypatch.setattr(router, "list_providers", lambda uid: [CLOUD, GATEWAY, LOCAL])


def _untrust(monkeypatch, *keys):
    from services.routing import policy
    p = policy.validate({"privacy": {"untrusted": list(keys)}})
    monkeypatch.setattr(policy, "load", lambda uid: p)


# ---- handling ---------------------------------------------------------------

def test_the_strictest_note_sets_the_level():
    with privacy.handling(["open", "pers", "priv"], "u1") as need:
        assert need.level == "private" and need.titles == ["Health log"]
    assert privacy.needed() is None


def test_nesting_never_loosens():
    with privacy.handling(["priv"], "u1"):
        with privacy.handling(["open"], "u1") as inner:
            assert inner.level == "private"


def test_lookup_failure_fails_closed(monkeypatch):
    monkeypatch.setattr(privacy, "fetch_levels", lambda ids, uid: None)
    with privacy.handling(["open"], "u1") as need:
        assert need.level == "private"


# ---- the router -------------------------------------------------------------

def test_a_private_note_only_gets_the_local_model():
    with privacy.handling(["priv"], "u1"):
        assert router.candidates("summarize_text", "u1") == [LOCAL]


def test_a_personal_note_skips_untrusted_providers(monkeypatch):
    _untrust(monkeypatch, "openrouter.ai")
    with privacy.handling(["pers"], "u1"):
        assert GATEWAY not in router.candidates("summarize_text", "u1")
        assert CLOUD in router.candidates("summarize_text", "u1")


def test_an_open_note_changes_nothing():
    with privacy.handling(["open"], "u1"):
        assert router.candidates("summarize_text", "u1")[0] == CLOUD


def test_a_job_with_no_allowed_provider_says_why(monkeypatch):
    sent = []
    monkeypatch.setattr("services.ai.client.complete", lambda *a, **k: sent.append(a) or "x")
    with privacy.handling(["priv"], "u1"):
        with pytest.raises(privacy.PrivacyBlocked, match="Health log.*private"):
            router.complete_with_fallback("vision", "u1", [{"role": "user", "content": "x"}])
    assert sent == []


def test_a_private_job_falls_to_local(monkeypatch):
    used = []
    monkeypatch.setattr("services.ai.client.complete",
                        lambda p, m, max_tokens=0: used.append(p.provider) or "ok")
    with privacy.handling(["priv"], "u1"):
        assert router.complete_with_fallback("summarize_text", "u1", []) == "ok"
    assert used == ["local"]


# ---- the wire: every client entry point refuses ------------------------------

def test_complete_refuses_before_sending(monkeypatch):
    from services.ai import client
    sent = []
    monkeypatch.setattr(client, "_complete_inner", lambda *a: sent.append(a) or "x")
    with privacy.handling(["priv"], "u1"):
        with pytest.raises(privacy.PrivacyBlocked):
            client.complete(CLOUD, [{"role": "user", "content": "secret"}])
    assert sent == []
    assert client.complete(CLOUD, [{"role": "user", "content": "fine"}]) == "x"


def test_stream_and_agent_turn_refuse():
    from services.ai import client
    from services.ai.agent_stream import stream_agent

    async def first(gen):
        async for _ in gen:
            return

    with privacy.handling(["priv"], "u1"):
        with pytest.raises(privacy.PrivacyBlocked):
            asyncio.run(first(client.stream(CLOUD, [])))
        with pytest.raises(privacy.PrivacyBlocked):
            asyncio.run(first(stream_agent(CLOUD, [])))


def test_batch_submit_refuses(monkeypatch):
    from services.jobs import batch
    posted = []
    monkeypatch.setattr(batch.httpx, "post", lambda *a, **k: posted.append(a))
    with privacy.handling(["priv"], "u1"):
        with pytest.raises(privacy.PrivacyBlocked):
            batch.AnthropicBatches().submit(CLOUD, "c1", [], 100)
    assert posted == []


def test_gemini_embeddings_refuse_a_private_note():
    from services import embedder
    with privacy.handling(["priv"], "u1"):
        with pytest.raises(privacy.PrivacyBlocked):
            embedder._embed_gemini("secret")


# ---- the decorator on the real entry points ----------------------------------

def test_reads_note_wraps_sync_and_async(monkeypatch):
    seen = []

    @privacy.reads_note
    def job(note_id, user_id, x=0):
        seen.append(privacy.needed().level)
        return x

    @privacy.reads_note
    async def chat(note_id, user_id):
        seen.append(privacy.needed().level)
        yield 1

    monkeypatch.setattr(privacy, "_owner", lambda nid: "u1")

    @privacy.reads_note
    def no_user(note_id, mode="replace"):
        seen.append(privacy.needed().level)

    assert job("priv", "u1", x=3) == 3

    async def drain():
        return [i async for i in chat("pers", "u1")]
    assert asyncio.run(drain()) == [1]
    no_user("open")
    assert seen == ["private", "personal", "open"]
    assert privacy.needed() is None


def test_the_entry_points_are_wrapped():
    from services.workspace import chat, skill_run, synthesis
    from services import indexer
    for fn in (synthesis.run_synthesis, synthesis.estimate_synthesis, skill_run.run_skill,
               skill_run.produce_skill_result, skill_run.batch_call, skill_run.estimate,
               chat.run_skill_in_chat, chat.run_note_chat, indexer.index_note):
        assert hasattr(fn, "__wrapped__"), fn.__name__


def test_the_worker_plans_a_private_job_on_device(monkeypatch):
    from services.jobs import worker
    monkeypatch.setattr(worker, "_estimate_now", lambda job: 0.5)
    plan = worker.plan_for({"note_id": "priv", "user_id": "u1", "model": None})
    assert plan["mode"] == "local"


# ---- apps outside this one: the desktop MCP server's /internal endpoints -----

def test_internal_endpoints_never_serve_a_private_note(monkeypatch):
    from unittest.mock import MagicMock
    from fastapi.testclient import TestClient
    import main
    from routers import internal
    monkeypatch.setattr(internal.settings, "internal_api_key", "k")
    monkeypatch.setattr(internal, "embed", lambda q: [0.0])
    monkeypatch.setattr(internal, "retrieve", lambda e, u: [
        {"id": "priv", "title": "Health log", "content_text": "SECRET"},
        {"id": "open", "title": "Linear algebra", "content_text": "eigen"}])
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .maybe_single.return_value.execute.return_value.data = {"id": "priv", "content_text": "SECRET"}
    db.table.return_value.select.return_value.eq.return_value.order.return_value \
        .limit.return_value.execute.return_value.data = [{"id": "priv"}, {"id": "open"}]
    monkeypatch.setattr(internal, "get_supabase", lambda: db)
    c, h = TestClient(main.app), {"x-internal-key": "k"}

    r = c.post("/internal/search", headers=h, json={"query": "q", "user_id": "u1"})
    assert "SECRET" not in r.text and "eigen" in r.text
    r = c.post("/internal/note", headers=h, json={"note_id": "priv", "user_id": "u1"})
    assert r.status_code == 403 and "SECRET" not in r.text
    r = c.post("/internal/notes?user_id=u1", headers=h)
    assert [n["id"] for n in r.json()["notes"]] == ["open"]
