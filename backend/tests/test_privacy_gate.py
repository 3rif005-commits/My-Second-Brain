"""The privacy gate (services/privacy.py) and its place in a chat turn.

The promise under test: a private note never reaches a cloud model unless the
user let it through for that one request. The turn tests assert on what the
model is actually sent — the wire — not on what the code meant to send.
"""
import pytest

from models.agent import AgentRequest, ChatMessage, Mode, Tier
from services import privacy
from services.agent import engine
from services.agent.permissions import Allow, NeedsApproval, check
from services.agent.skills import SkillRegistry
from services.ai.providers import Provider

pytestmark = pytest.mark.real_routing

CANARY = "CANARY-7f3a-private-diagnosis"
PRIVATE = {"id": "p1", "title": "Health log", "content_text": f"{CANARY} details"}
OPEN = {"id": "o1", "title": "Linear algebra", "content_text": "eigenvalues"}
LEVELS = {"p1": {"level": "private", "title": "Health log"},
          "o1": {"level": "open", "title": "Linear algebra"}}

CLOUD = Provider("anthropic", api_key="k", label="Anthropic", capabilities={"text", "vision", "long_context"})


# ---- the gate itself --------------------------------------------------------

def test_levels_and_ceilings():
    assert privacy.level_of({"sensitivity": "open"}) == "open"
    assert privacy.level_of({"local_only": True}) == "private"
    assert privacy.level_of({}) == "personal"
    assert privacy.allows("personal", "open")
    assert not privacy.allows("personal", "private")
    assert privacy.ceiling_for(Provider("local")) == "private"
    assert privacy.ceiling_for(CLOUD) == "personal"
    assert privacy.ceiling_for(CLOUD, untrusted=["anthropic"]) == "open"
    gw = Provider("openai_compatible", base_url="https://openrouter.ai/api/v1")
    assert privacy.provider_key(gw) == "openrouter.ai"


def test_outside_a_scope_rows_pass_unchanged():
    rows = [{"id": "p1", "sensitivity": "private"}]
    assert privacy.filter_rows(rows) == rows


def test_scope_drops_what_is_above_the_ceiling_and_says_so():
    with privacy.scope("personal", "u1") as s:
        kept = privacy.filter_rows([{**PRIVATE, "sensitivity": "private"},
                                    {**OPEN, "sensitivity": "open"}])
    assert [r["id"] for r in kept] == ["o1"]
    assert s.withheld == {"p1": "Health log"}


def test_a_released_note_passes_once_and_is_recorded():
    with privacy.scope("personal", "u1", released=["p1"]) as s:
        kept = privacy.filter_rows([{**PRIVATE, "sensitivity": "private"}])
    assert kept and s.released_used == {"p1"}


def test_lookup_failure_fails_closed(monkeypatch):
    monkeypatch.setattr(privacy, "fetch_levels", lambda ids, uid: None)
    with privacy.scope("personal", "u1") as s:
        assert privacy.filter_rows([OPEN]) == []
    assert "o1" in s.withheld


def test_a_note_not_found_for_this_user_is_withheld(monkeypatch):
    monkeypatch.setattr(privacy, "fetch_levels", lambda ids, uid: {})
    with privacy.scope("open", "u1"):
        assert privacy.filter_rows([{"id": "someone-elses"}]) == []


def test_read_tools_are_filtered(monkeypatch):
    from services.agent import brain_tools
    monkeypatch.setattr(privacy, "fetch_levels",
                        lambda ids, uid: {i: LEVELS[i] for i in ids if i in LEVELS})
    with privacy.scope("personal", "u1"):
        out = brain_tools._withhold("brain.search_brain", {"matches": [PRIVATE, OPEN]})
        assert [m["id"] for m in out["matches"]] == ["o1"]
        assert out["withheld_private"] == 1
        note = brain_tools._withhold("brain.get_note", dict(PRIVATE))
        assert note.get("withheld") and CANARY not in str(note)
        grouped = brain_tools._withhold(
            "brain.query_database", {"groups": [{"key": "x", "rows": [PRIVATE, OPEN]}]})
        assert [r["id"] for r in grouped["groups"][0]["rows"]] == ["o1"]


def test_mcp_calls_need_approval_when_private_notes_are_in_reach():
    d = check("mcp.web.post", Tier.INTERNAL_LOCAL, {}, None, private_context=True)
    assert isinstance(d, NeedsApproval)
    d = check("mcp.web.post", Tier.INTERNAL_LOCAL, {}, None, private_context=True,
              approvals={"mcp.web.post:*"})
    assert isinstance(d, Allow)


# ---- a whole chat turn ------------------------------------------------------

def _wire(monkeypatch, notes, providers=(CLOUD,), tool_rounds=()):
    """Run turns against fakes; returns (run, sent) where `sent` collects every
    request the model received."""
    sent: list[list[dict]] = []
    rounds = list(tool_rounds)

    async def stream(provider, messages, tools=None, max_tokens=2048):
        sent.append([dict(m) for m in messages])
        if rounds:
            for ev in rounds.pop(0):
                yield ev
            return
        yield {"type": "text", "content": "ok"}

    monkeypatch.setattr(engine, "stream_agent", stream)
    monkeypatch.setattr(engine, "embed", lambda q: [0.0])
    monkeypatch.setattr(engine, "retrieve", lambda e, u, **kw: [dict(n) for n in notes])
    monkeypatch.setattr("services.ai.providers.list_providers",
                        lambda uid: list(providers) + [Provider("local", label="Local")])
    monkeypatch.setattr(privacy, "fetch_levels",
                        lambda ids, uid: {i: LEVELS[i] for i in ids if i in LEVELS})
    monkeypatch.setattr("services.routing.log.record", lambda *a, **k: "d1")

    async def no_mcp(u):
        return [], []
    monkeypatch.setattr(engine, "_get_mcp_tools_for_user", no_mcp)

    async def run(**kw):
        q = kw.pop("query", "what did the doctor say?")
        history = kw.pop("history", [])
        req = AgentRequest(messages=history + [ChatMessage(role="user", content=q)],
                           query=q, mode=kw.pop("mode", Mode.AUTO), **kw)
        return [e async for e in engine.run_turn(req, "u1", SkillRegistry({}))]
    return run, sent


def _everything(sent) -> str:
    return "\n".join(str(m.get("content")) for req in sent for m in req)


async def test_ask_stops_before_anything_is_sent(monkeypatch):
    run, sent = _wire(monkeypatch, [PRIVATE, OPEN])
    events = await run()
    assert sent == []
    need = [e for e in events if e["type"] == "privacy_needed"]
    assert need and need[0]["withheld"] == [{"id": "p1", "title": "Health log"}]
    assert events[-1]["type"] == "done"


async def test_send_without_them_never_puts_the_private_note_on_the_wire(monkeypatch):
    run, sent = _wire(monkeypatch, [PRIVATE, OPEN])
    events = await run(withheld_ok=True)
    assert sent and CANARY not in _everything(sent)
    assert "eigenvalues" in _everything(sent)
    route = next(e for e in events if e["type"] == "route")
    assert route["withheld"] == [{"id": "p1", "title": "Health log"}]
    assert route["private_used"] is False


async def test_release_lets_one_note_through_and_marks_the_answer_private(monkeypatch):
    run, sent = _wire(monkeypatch, [PRIVATE, OPEN])
    events = await run(release=["p1"])
    assert CANARY in _everything(sent)
    route = next(e for e in events if e["type"] == "route")
    assert route["private_used"] is True and route["withheld"] == []


async def test_a_tool_search_mid_turn_is_filtered_too(monkeypatch):
    from services.agent import brain_tools
    monkeypatch.setattr(brain_tools, "_search_brain",
                        lambda args, uid: {"matches": [dict(PRIVATE), dict(OPEN)]})
    call = {"type": "tool_call", "id": "c1", "name": "brain.search_brain",
            "arguments": '{"query": "doctor"}'}
    run, sent = _wire(monkeypatch, [OPEN], tool_rounds=[[call]])
    await run(query="search my notes")
    assert len(sent) == 2 and CANARY not in _everything(sent)
    assert "withheld_private" in _everything(sent)


async def test_on_device_everything_is_available(monkeypatch):
    run, sent = _wire(monkeypatch, [PRIVATE, OPEN])
    events = await run(mode=Mode.LOCAL)
    assert CANARY in _everything(sent)
    route = next(e for e in events if e["type"] == "route")
    assert route["on_device"] and route["private_used"]


async def test_a_private_answer_in_history_is_hidden_from_the_cloud(monkeypatch):
    run, sent = _wire(monkeypatch, [OPEN])
    history = [ChatMessage(role="user", content="q1"),
               ChatMessage(role="assistant", content=f"local said {CANARY}", private=True)]
    await run(history=history, query="explain eigenvalues")
    assert CANARY not in _everything(sent)
    assert engine.PRIVATE_ANSWER_PLACEHOLDER in _everything(sent)
    # ...and the flag itself never goes to a provider
    assert all("private" not in m for req in sent for m in req)


async def test_policy_local_moves_the_turn_on_device(monkeypatch):
    from services.routing import policy as routing_policy
    p = routing_policy.default_policy()
    p["privacy"]["when_private_needed"] = "local"
    monkeypatch.setattr(routing_policy, "load", lambda uid: p)
    run, sent = _wire(monkeypatch, [PRIVATE, OPEN])
    events = await run()
    route = next(e for e in events if e["type"] == "route")
    assert route["slot"] == "local" and route["on_device"]
    assert "private" in route["reason"]


# ---- the editor AI (one open note, one fixed provider) ----------------------

def test_editor_ai_refuses_a_private_note(monkeypatch):
    monkeypatch.setattr(privacy, "fetch_levels",
                        lambda ids, uid: {i: LEVELS[i] for i in ids if i in LEVELS})
    assert "private" in privacy.refuse_note("p1", "u1", CLOUD)
    assert privacy.refuse_note("o1", "u1", CLOUD) is None
    assert privacy.refuse_note("p1", "u1", Provider("local")) is None
    assert privacy.refuse_note(None, "u1", CLOUD) is None


def test_editor_ai_fails_closed(monkeypatch):
    monkeypatch.setattr(privacy, "fetch_levels", lambda ids, uid: None)
    assert privacy.refuse_note("o1", "u1", CLOUD)


def test_inline_endpoint_returns_403_before_sending(monkeypatch):
    from fastapi.testclient import TestClient
    import main
    from routers import agent_inline
    monkeypatch.setattr(agent_inline, "get_user_id", lambda a: "u1")
    monkeypatch.setattr(agent_inline.settings, "openrouter_api_key", "k")
    monkeypatch.setattr(privacy, "fetch_levels",
                        lambda ids, uid: {i: LEVELS[i] for i in ids if i in LEVELS})
    called = []

    async def never(*a, **k):
        called.append(1)
        yield b""
    monkeypatch.setattr(agent_inline, "stream_passthrough", never)
    r = TestClient(main.app).post("/agent/inline?note_id=p1", json={"messages": []},
                                  headers={"Authorization": "Bearer t"})
    assert r.status_code == 403 and "private" in r.text and not called


def test_a_replayed_question_is_not_saved_twice(monkeypatch):
    from fastapi.testclient import TestClient
    import main
    from routers import agent as agent_router
    saved = []
    monkeypatch.setattr(agent_router, "get_user_id", lambda a: "u1")
    monkeypatch.setattr(agent_router, "_append_user_message_to_thread",
                        lambda tid, uid, body: saved.append(body.query))
    monkeypatch.setattr(agent_router, "_append_assistant_message_to_thread", lambda *a, **k: None)

    async def turn(body, user_id, skill_registry):
        yield {"type": "done"}
    monkeypatch.setattr(agent_router, "run_turn", turn)
    c = TestClient(main.app)
    msg = [{"role": "user", "content": "q"}]
    c.post("/agent", headers={"Authorization": "Bearer t"},
           json={"thread_id": "t1", "query": "q", "messages": msg})
    c.post("/agent", headers={"Authorization": "Bearer t"},
           json={"thread_id": "t1", "query": "q", "messages": msg, "withheld_ok": True})
    assert saved == ["q"]
