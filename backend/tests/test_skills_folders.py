"""Folder skills, richer frontmatter, and references loaded on demand.

The point of the folder form is progressive disclosure: a prompt carrying every
skill's full text pays for all of them on every turn, while the metadata is
about a hundred tokens. These tests pin the parts that make that possible.
"""
from pathlib import Path

import pytest

from services.agent.skills import Skill, SkillRegistry, classify_skills

FOLDER_SKILL = """---
name: study-guide
description: Turn sources into a structured mastery guide note.
surfaces: [workspace, chat]
inputs: sources
output: draft_note
model_tier: standard
auto: false
confirm: true
priority: 5
---

Write the guide. The dialect lives in references/notion-dialect.md.
"""

FLAT_SKILL = """---
name: note-author
description: Formats note content for the block editor.
priority: 4
---

Structure it for BlockNote.
"""


@pytest.fixture
def skills_dir(tmp_path):
    d = tmp_path / "skills"
    (d / "study-guide" / "references").mkdir(parents=True)
    (d / "study-guide" / "SKILL.md").write_text(FOLDER_SKILL)
    (d / "study-guide" / "references" / "notion-dialect.md").write_text("# Dialect\nUse callouts.")
    (d / "note-author.md").write_text(FLAT_SKILL)
    return d


def test_both_shapes_load_side_by_side(skills_dir):
    """Flat .md skills predate folders and must keep working untouched."""
    reg = SkillRegistry.load([skills_dir])
    assert sorted(reg.names()) == ["note-author", "study-guide"]
    assert reg.get("note-author").folder is None
    assert reg.get("study-guide").folder is not None


def test_frontmatter_carries_where_it_runs_and_what_it_makes(skills_dir):
    s = SkillRegistry.load([skills_dir]).get("study-guide")
    assert s.surfaces == ("workspace", "chat")
    assert (s.inputs, s.output, s.model_tier) == ("sources", "draft_note", "standard")
    assert s.confirm is True


def test_a_reference_is_read_only_when_asked_for(skills_dir):
    s = SkillRegistry.load([skills_dir]).get("study-guide")
    assert s.references() == ["references/notion-dialect.md"]
    # the body does not contain it — that is the whole point
    assert "Use callouts" not in s.body
    assert "Use callouts" in s.reference("references/notion-dialect.md")


def test_a_reference_cannot_escape_its_folder(skills_dir):
    s = SkillRegistry.load([skills_dir]).get("study-guide")
    with pytest.raises(ValueError, match="escapes"):
        s.reference("../../../etc/passwd")


def test_a_flat_skill_has_no_references(skills_dir):
    s = SkillRegistry.load([skills_dir]).get("note-author")
    assert s.references() == []
    with pytest.raises(FileNotFoundError):
        s.reference("references/anything.md")


def test_the_index_is_metadata_only(skills_dir):
    """What goes in the system prompt: names and descriptions, no bodies."""
    index = SkillRegistry.load([skills_dir]).index()
    assert "study-guide: Turn sources" in index
    assert "Write the guide" not in index
    assert len(index) < 300


def test_surfaces_filter_what_a_screen_may_offer(skills_dir):
    reg = SkillRegistry.load([skills_dir])
    workspace = [s.name for s in reg.for_surface("workspace")]
    database = [s.name for s in reg.for_surface("database")]
    assert "study-guide" in workspace
    # note-author declares no surfaces, so it is available everywhere
    assert "note-author" in workspace and "note-author" in database
    assert "study-guide" not in database


def test_one_broken_skill_does_not_take_the_registry_down(skills_dir, caplog):
    """A user's malformed file must not disable the assistant."""
    (skills_dir / "broken.md").write_text("no frontmatter here")
    (skills_dir / "nameless").mkdir()
    (skills_dir / "nameless" / "SKILL.md").write_text("---\ndescription: x\n---\nbody")

    reg = SkillRegistry.load([skills_dir])
    assert sorted(reg.names()) == ["note-author", "study-guide"]
    assert "skipping skill" in caplog.text


def test_auto_gates_what_the_classifier_may_pick_by_itself(skills_dir):
    reg = SkillRegistry.load([skills_dir])
    query = "turn these sources into a mastery guide note"

    picked = [s.name for s in classify_skills(query, reg.all())]
    assert picked[0] == "study-guide"       # best overlap wins
    # the same query picks nothing when only opted-in skills may fire
    assert classify_skills(query, reg.all(), require_auto=True) == []


def test_an_opted_in_skill_can_still_fire(tmp_path):
    d = tmp_path / "skills"
    d.mkdir()
    (d / "triage.md").write_text(
        "---\nname: triage\ndescription: sort and tag incoming notes\nauto: true\n---\nbody")
    reg = SkillRegistry.load([d])
    picked = classify_skills("sort my incoming notes", reg.all(), require_auto=True)
    assert [s.name for s in picked] == ["triage"]


def test_chat_only_classifies_skills_it_may_use():
    """A selection- or workspace-only skill must never be pasted into a chat
    turn; one with no surfaces, or with `chat`, may be."""
    from pathlib import Path
    from services.agent.skills import SkillRegistry
    reg = SkillRegistry.load([Path(__file__).resolve().parent.parent / "skills"])
    chat = {s.name for s in reg.for_surface("chat")}
    assert "flashcards" in chat                 # used from chat (E7 case)
    assert "define-terms" not in chat           # selection only
    assert "compare-sources" not in chat        # needs attached sources


def test_the_study_guide_is_a_skill_folder_offered_as_a_chat_job():
    """The study guide's prompts live in skills/study-guide/ (SKILL.md = the
    Markdown path, reference/html-dialect.md = the user's HTML instructions).
    It runs as a chat job (/study-guide, user decision 2026-09-24) — never
    pasted into the chat assistant's own prompt, never in the selection menu."""
    from pathlib import Path
    from services.agent.skills import SkillRegistry
    from services.workspace import skill_run
    from prompts.note_synthesis_md import MARKDOWN_SPEC
    from prompts.mastery_guide import SYSTEM_PROMPT
    root = Path(__file__).resolve().parent.parent / "skills" / "study-guide"
    assert MARKDOWN_SPEC in (root / "SKILL.md").read_text(encoding="utf-8")
    assert SYSTEM_PROMPT == (root / "reference" / "html-dialect.md").read_text(encoding="utf-8")[:-1]
    reg = SkillRegistry.load([root.parent])
    assert reg.get("study-guide") is not None
    assert "study-guide" not in {s.name for s in reg.for_surface("chat")}
    assert "study-guide" not in {s.name for s in skill_run.selection_skills()}
    chat_jobs = {s.name for s in reg.all() if s.output and skill_run.CHAT_SURFACES & set(s.surfaces)}
    assert "study-guide" in chat_jobs


def test_the_chat_catalogue_lists_only_chat_skills():
    from pathlib import Path
    from services.agent.skills import SkillRegistry
    reg = SkillRegistry.load([Path(__file__).resolve().parent.parent / "skills"])
    chat = reg.index("chat")
    assert "flashcards" in chat
    assert "define-terms" not in chat and "study-guide" not in chat
    assert "define-terms" in reg.index()          # the unfiltered listing is unchanged
