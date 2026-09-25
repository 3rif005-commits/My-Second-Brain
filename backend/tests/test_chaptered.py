"""E9: a guide from several sources is planned, then written chapter by
chapter. The user's study-guide instructions reach every chapter call
unchanged; every page is in some chapter; a bad plan falls back."""
from unittest.mock import patch

from prompts.note_synthesis import build_note_synthesis_prompt
from services.workspace import chaptered

SOURCES = [{"title": "L8", "kind": "pdf", "text": "[page 1]\nbagging\n[page 2]\nboosting\n[page 3]\nstacking"},
           {"title": "L9", "kind": "pdf", "text": "[page 1]\nk-means\n[page 2]\nPCA"}]
PLAN = {"title": "ML", "chapters": [
    {"title": "Ensembles", "covers": "bagging and boosting", "pages": [{"source": 1, "pages": [1, 2]}]},
    {"title": "Unsupervised", "covers": "clustering, PCA", "pages": [{"source": 2, "pages": [1, 2, 99]}]}]}


def test_every_page_lands_in_a_chapter_and_unreal_pages_are_dropped():
    plan = chaptered._checked(PLAN, SOURCES)
    assert plan["chapters"][0]["pages"][1] == {1, 2, 3}      # page 3 was unclaimed
    assert plan["chapters"][1]["pages"][2] == {1, 2}         # page 99 does not exist


def test_one_chapter_is_no_plan():
    assert chaptered._checked({"chapters": PLAN["chapters"][:1]}, SOURCES) is None


def test_each_chapter_gets_the_user_s_instructions_and_only_its_pages():
    seen = []

    def fake(job, user, messages, **kw):
        content = messages[0]["content"]
        text = content if isinstance(content, str) else "".join(p["text"] for p in content)
        seen.append(text)
        return "<h1>stray</h1><h2>Chapter</h2>" + "x" * 400

    plan = chaptered._checked(PLAN, SOURCES)
    with patch("services.ai.router.complete_with_fallback", side_effect=fake):
        html, _ = chaptered._write_chapter(1, plan, SOURCES, "u", False)
    fixed = build_note_synthesis_prompt(SOURCES).split("\n---\nSOURCE MATERIAL")[0]
    assert seen[0].startswith(fixed)                 # instructions byte for byte
    assert "bagging" in seen[0] and "k-means" not in seen[0]
    assert 'Write ONLY chapter 1: "Ensembles"' in seen[0]
    assert "<h1>" not in html


def test_the_guide_has_one_title_and_the_chapters_in_order():
    calls = iter(["```json\n" + __import__("json").dumps(PLAN) + "\n```"])

    def fake(job, user, messages, **kw):
        if kw.get("max_tokens") == 4000:
            return next(calls)
        text = messages[0]["content"] if isinstance(messages[0]["content"], str) else \
            "".join(p["text"] for p in messages[0]["content"])
        name = "Ensembles" if "Write ONLY chapter 1" in text else "Unsupervised"
        return f"<h2>{name}</h2>" + "y" * 400

    with patch("services.ai.router.complete_with_fallback", side_effect=fake):
        html, truncated = chaptered.synthesize_chaptered(SOURCES, "u")
    assert html.count("<h1>") == 1 and html.index("Ensembles") < html.index("Unsupervised")
    assert truncated is False


def test_an_unreadable_plan_means_one_call():
    with patch("services.ai.router.complete_with_fallback", return_value="not json"):
        assert chaptered.synthesize_chaptered(SOURCES, "u") is None
