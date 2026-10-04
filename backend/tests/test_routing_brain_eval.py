"""evals/routing_brain: the scoring, with a scripted brain (no model)."""
import json

import pytest

from evals import routing_brain
from services.ai.providers import Provider

pytestmark = pytest.mark.real_routing


def test_the_corpus_is_50_labelled_questions():
    cases = json.loads(routing_brain.CASES.read_text())["cases"]
    assert len(cases) == 50
    assert {c["slot"] for c in cases} <= {"local", "fast", "strong", "vision", "long"}


async def test_agreement_latency_and_misses(monkeypatch):
    monkeypatch.setattr(routing_brain, "_provider", lambda kind, uid: Provider("local", label="Local"))
    # Always answers "fast": right on the fast cases only.
    monkeypatch.setattr("services.ai.client.complete",
                        lambda p, m, max_tokens=60: '{"slot":"fast","reason":"x"}')
    r = await routing_brain.run("local", None, 5000, "")
    fast = sum(c["want"] == "fast" for c in r["rows"])
    assert r["agreement"] == round(fast / 50, 3)
    assert r["no_decision"] == 0 and "local->fast" in r["confusion"]
    assert r["passes"] is False
