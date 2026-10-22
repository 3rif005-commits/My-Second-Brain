"""Gemini embeddings go up to GEMINI_BATCH texts per request, in order (a 300-page PDF used
to make one request per chunk on the deployed backend)."""
import sys
import types

import pytest

from services import embedder


class FakeModels:
    def __init__(self, short=False):
        self.calls, self.short = [], short

    def embed_content(self, model, contents, config):
        self.calls.append(list(contents))
        n = len(contents) - (1 if self.short else 0)
        vecs = [types.SimpleNamespace(values=[float(len(t)), 1.0]) for t in contents[:n]]
        return types.SimpleNamespace(embeddings=vecs)


@pytest.fixture
def gemini(monkeypatch):
    genai_types = types.SimpleNamespace(EmbedContentConfig=lambda **k: k)
    genai = types.SimpleNamespace(types=genai_types)
    monkeypatch.setitem(sys.modules, "google", types.SimpleNamespace(genai=genai))
    monkeypatch.setitem(sys.modules, "google.genai", genai)
    monkeypatch.setitem(sys.modules, "google.genai.types", genai_types)
    monkeypatch.setattr(embedder.settings, "embedder_provider", "gemini")

    def use(models):
        monkeypatch.setattr(embedder, "_gemini_client", types.SimpleNamespace(models=models))
        return models
    return use


def test_texts_go_in_batches_of_the_api_limit_and_come_back_in_order(gemini):
    models = gemini(FakeModels())
    texts = ["x" * (i + 1) for i in range(250)]
    out = embedder.embed_batch(texts)
    assert [len(c) for c in models.calls] == [100, 100, 50]
    assert [v[0] for v in out] == [float(i + 1) for i in range(250)]


def test_one_text_is_one_request_and_long_texts_are_capped(gemini):
    models = gemini(FakeModels())
    assert embedder.embed("y" * 9000) == [8000.0, 1.0]
    assert models.calls == [["y" * 8000]]


def test_a_short_reply_is_an_error_not_misaligned_vectors(gemini):
    gemini(FakeModels(short=True))
    with pytest.raises(RuntimeError, match="2 embeddings for 3 texts"):
        embedder.embed_batch(["a", "b", "c"])
