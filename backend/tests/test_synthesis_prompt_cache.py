"""E3: the study-guide instructions as a cached prefix. The rule this guards:
caching changes how the prompt is SENT, never what it says — the user's
instructions reach the model byte for byte (HARNESS.md, the prompt incident)."""
from pathlib import Path

from prompts.note_synthesis import build_note_synthesis_prompt, cache_split
from services.ai.client import _anthropic_payload, _to_openai_messages
from services.ai.providers import Provider
from services.workspace.synthesis import synthesis_messages

SOURCE = (Path(__file__).parent.parent / "evals" / "corpus" / "sources"
          / "iml-lecture-10.extracted.txt").read_text(encoding="utf-8")


def _prompt(n=1):
    return build_note_synthesis_prompt(
        [{"title": f"L{i}", "kind": "pdf", "text": SOURCE} for i in range(n)])


def test_the_split_is_the_prompt_byte_for_byte():
    prompt = _prompt()
    fixed, rest = cache_split(prompt)
    assert fixed + rest == prompt
    assert SOURCE[:200] not in fixed and SOURCE[:200] in rest


def test_the_fixed_part_is_the_same_for_every_note():
    assert cache_split(_prompt(1))[0] == cache_split(_prompt(2))[0]


def test_the_fixed_part_is_long_enough_for_haiku_to_cache():
    # Haiku 4.5 caches nothing under 4,096 tokens; ~3 chars per token here.
    assert len(cache_split(_prompt())[0]) / 3.2 > 4096


def test_off_sends_one_plain_string():
    prompt = _prompt()
    assert synthesis_messages(prompt, cache=False) == [{"role": "user", "content": prompt}]


def test_on_marks_only_the_fixed_part_for_anthropic():
    msgs = synthesis_messages(_prompt(), cache=True)
    p = Provider(provider="anthropic", api_key="k", chat_model="claude-haiku-4-5")
    blocks = _anthropic_payload(p, msgs, 100, stream=True)["messages"][0]["content"]
    assert blocks[0]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in blocks[1]
    assert blocks[0]["text"] + blocks[1]["text"] == _prompt()


def test_other_providers_get_the_same_text_and_no_flag():
    parts = _to_openai_messages(synthesis_messages(_prompt(), cache=True))[0]["content"]
    assert all(set(p) == {"type", "text"} for p in parts)
    assert "".join(p["text"] for p in parts) == _prompt()


def test_no_mark_means_no_cache():
    assert synthesis_messages("just a question", cache=True) == [
        {"role": "user", "content": "just a question"}]
