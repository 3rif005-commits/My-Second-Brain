"""The AI's source tools (docs/AI_SOURCE_TOOLS_PLAN.md): every viewer button that
puts something into a note has a tool, each insert comes back as a token (never
a URL the model must copy), and text versions are made once and kept."""
import json
from unittest.mock import AsyncMock, patch

import pytest

from services.agent import engine, permissions, source_tools
from services.agent.source_tools import SourceToolError, SourceTurn
from tests.fake_db import FakeDB
from tests.test_engine_tool_loop import _Scripted, _collect, call, say
from models.agent import Tier

U, NOTE, OTHER = "u1", "note-1", "note-2"
PDF = "aaaaaaaa-1111-4111-8111-111111111111"
VID = "bbbbbbbb-2222-4222-8222-222222222222"
FOREIGN = "cccccccc-3333-4333-8333-333333333333"


def _db():
    return FakeDB(
        note_resources=[
            {"id": PDF, "note_id": NOTE, "user_id": U, "kind": "pdf", "title": "Lecture 10",
             "status": "ready", "meta": {"pages": 12}, "order_index": 0},
            {"id": VID, "note_id": NOTE, "user_id": U, "kind": "youtube", "title": "Talk",
             "status": "ready", "meta": {"duration": 900}, "order_index": 1,
             "source_url": "https://youtu.be/x"},
            # Another note's source: out of this turn's reach.
            {"id": FOREIGN, "note_id": OTHER, "user_id": U, "kind": "pdf", "title": "Secret",
             "status": "ready", "meta": {}, "order_index": 0},
        ],
        resource_elements=[
            {"id": "el-fig", "resource_id": PDF, "user_id": U, "page": 7, "element_type": "image",
             "order_index": 1, "image_path": "u1/pdf/fig.png", "content": None},
            {"id": "el-tab", "resource_id": PDF, "user_id": U, "page": 4, "element_type": "table",
             "order_index": 2, "content": "| a | b |\n|---|---|\n| 1 | 2 |"},
            {"id": "el-eq", "resource_id": PDF, "user_id": U, "page": 3, "element_type": "formula",
             "order_index": 3, "image_path": "u1/pdf/eq.png", "content": "Q(s,a)"},
            {"id": "el-txt", "resource_id": PDF, "user_id": U, "page": 3, "element_type": "text",
             "order_index": 4, "content": "Q-learning is off-policy."},
            {"id": "el-far", "resource_id": FOREIGN, "user_id": U, "page": 1, "element_type": "table",
             "order_index": 0, "content": "| x |\n|---|\n| y |"},
        ],
        resource_chunks=[
            {"resource_id": PDF, "user_id": U, "chunk_index": 0, "anchor_type": "page",
             "anchor_start": 3, "anchor_end": 3,
             "chunk_text": "Q-learning is an off-policy method: it learns the greedy policy\nwhile acting otherwise."},
            {"resource_id": VID, "user_id": U, "chunk_index": 0, "anchor_type": "time",
             "anchor_start": 740, "anchor_end": 770, "chunk_text": "Here the agent explores."},
        ],
    )


@pytest.fixture
def db():
    d = _db()
    with patch.object(source_tools, "get_supabase", return_value=d):
        yield d


def _turn():
    return SourceTurn(note_ids=[NOTE], user_id=U)


def test_every_tool_has_a_schema_and_a_permission_tier():
    names = {s["name"] for s in source_tools.SCHEMAS}
    assert names == set(source_tools.NAMES)
    for n in names:
        assert n in permissions._TOOL_MIN_TIER, n


def test_list_sources_gives_ids_and_element_counts(db):
    out = source_tools.list_sources({}, _turn())
    by = {s["source_id"]: s for s in out["sources"]}
    assert set(by) == {PDF, VID}                      # not the other note's source
    assert by[PDF]["pages"] == 12 and by[PDF]["figures"] == 1 and by[PDF]["tables"] == 1
    assert by[VID]["duration"] == "15:00"


def test_a_source_is_found_by_the_short_id_the_excerpts_show(db):
    assert source_tools.SourceTurn(note_ids=[NOTE], user_id=U).source(PDF[:8])["id"] == PDF
    with pytest.raises(SourceToolError):
        _turn().source(FOREIGN)                       # out of scope


def test_find_elements_gives_text_versions_not_pixels(db):
    out = source_tools.find_elements({"source_id": PDF}, _turn())
    types = {e["type"]: e for e in out["elements"]}
    assert set(types) == {"figure", "table", "formula"}   # no body text without a page
    assert "look_at" in types["figure"]["text"]
    assert types["table"]["text"].startswith("| a | b |")
    page3 = source_tools.find_elements({"source_id": PDF, "page": 3}, _turn())
    assert {e["type"] for e in page3["elements"]} == {"formula", "text"}


def test_an_element_of_another_notes_source_is_refused(db):
    with pytest.raises(SourceToolError):
        source_tools.insert_table({"element_id": "el-far"}, _turn())


def test_inserts_return_a_token_and_no_url_for_the_model(db):
    with patch("services.workspace.storage.signed_url", return_value="https://signed/very-long"):
        out = source_tools.insert_figure({"element_id": "el-fig"}, _turn())
    insert = out.pop("insert")
    assert out["token"].startswith("[[src:") and insert["token"] == out["token"]
    assert "https://" not in json.dumps(out)         # the model never sees the link
    assert insert["url"] == "https://signed/very-long"
    assert insert["kind"] == "figure" and insert["value"] == 7 and insert["note_id"] == NOTE


def test_figure_links_are_long_lived(db):
    with patch("services.workspace.storage.signed_url", return_value="u") as sign:
        source_tools.insert_figure({"element_id": "el-fig"}, _turn())
    assert sign.call_args.args[1] >= 365 * 24 * 3600


def test_a_quote_must_be_in_the_source_and_finds_its_own_page(db):
    out = source_tools.insert_quote(
        {"source_id": PDF, "text": "Q-learning is an off-policy method — it learns the greedy policy"},
        _turn())
    assert out["insert"]["anchor_type"] == "page" and out["insert"]["value"] == 3
    with pytest.raises(SourceToolError, match="not in that source"):
        source_tools.insert_quote({"source_id": PDF, "text": "SARSA is off-policy."}, _turn())


def test_formula_latex_is_read_once_and_kept(db):
    with patch("services.workspace.storage.download", return_value=b"png"), \
         patch("services.workspace.media.formula_to_latex", return_value="Q(s,a)=r") as ocr:
        first = source_tools.insert_formula({"element_id": "el-eq"}, _turn())
        second = source_tools.insert_formula({"element_id": "el-eq"}, _turn())
    assert first["insert"]["latex"] == second["insert"]["latex"] == "Q(s,a)=r"
    assert ocr.call_count == 1
    row = next(r for r in db.tables["resource_elements"] if r["id"] == "el-eq")
    assert row["latex"] == "Q(s,a)=r"


def test_look_at_describes_a_figure_once_and_saves_it(db):
    with patch("services.workspace.storage.download", return_value=b"png"), \
         patch("services.workspace.figures._downscale", return_value=b"small"), \
         patch.object(source_tools, "_vision", return_value="A grid world.") as vision:
        a = source_tools.look_at({"element_id": "el-fig"}, _turn())
        b = source_tools.look_at({"element_id": "el-fig"}, _turn())
    assert a["description"] == b["description"] == "A grid world."
    assert vision.call_count == 1
    listed = source_tools.find_elements({"source_id": PDF, "type": "figure"}, _turn())
    assert listed["elements"][0]["text"] == "A grid world."


def test_a_clip_is_capped_and_one_capture_per_turn(db):
    turn = _turn()
    with pytest.raises(SourceToolError, match="At most"):
        source_tools.capture_clip({"source_id": VID, "start": 0, "end": 600}, turn)
    with patch("services.workspace.media.capture",
               return_value={"path": "p", "url": "https://clip", "mime": "video/mp4"}):
        out = source_tools.capture_clip({"source_id": VID, "start": "12:00", "end": "12:30"}, turn)
        assert out["insert"]["kind"] == "clip" and out["insert"]["value"] == 720
        with pytest.raises(SourceToolError, match="One capture"):
            source_tools.capture_frame({"source_id": VID, "at": 10}, turn)


def test_a_frame_comes_with_the_transcript_around_it(db):
    with patch("services.workspace.media.capture",
               return_value={"path": "p", "url": "https://f", "mime": "image/jpeg"}):
        out = source_tools.capture_frame({"source_id": VID, "at": "12:30"}, _turn())
    assert "explores" in out["transcript_near"]
    with pytest.raises(SourceToolError, match="video"):
        source_tools.capture_frame({"source_id": PDF, "at": 1}, _turn())


def test_parse_time():
    assert source_tools.parse_time("1:02:03") == 3723
    assert source_tools.parse_time(75) == 75
    with pytest.raises(SourceToolError):
        source_tools.parse_time("soon")


@pytest.mark.asyncio
async def test_the_engine_sends_the_block_to_the_client_and_the_token_to_the_model(db):
    stream = _Scripted([call("c1", "workspace.insert_table", {"element_id": "el-tab"}),
                        say("Here it is:\n\n[[src:x]]")])
    events = await _collect(stream, workspace_note=NOTE, source_turn=_turn())
    ins = next(e for e in events if e["type"] == "source_insert")
    assert ins["kind"] == "table" and ins["markdown"].startswith("| a | b |")
    tool_reply = next(m for m in stream.requests[1] if m.get("role") == "tool")
    assert ins["token"] in tool_reply["content"] and '"insert"' not in tool_reply["content"]


@pytest.mark.asyncio
async def test_without_an_open_note_the_source_tools_are_refused(db):
    events = await _collect(_Scripted([call("c1", "workspace.list_sources", {}), say("ok")]))
    assert any(e["type"] == "tool_denied" and e["reason"] == "no open note" for e in events)


@pytest.mark.asyncio
async def test_a_tool_error_reaches_the_model_as_text(db):
    stream = _Scripted([call("c1", "workspace.insert_table", {"element_id": "nope"}), say("ok")])
    events = await _collect(stream, workspace_note=NOTE, source_turn=_turn())
    assert any(e["type"] == "tool_denied" and "No element" in e["reason"] for e in events)


# Every viewer button that puts something into a note has an AI tool
# (CLAUDE.md, "AI parity"). A new SendAction type with no entry here fails.
_BUTTON_TOOLS = {
    "text": {"workspace.insert_quote"},
    "image": {"workspace.insert_figure", "workspace.capture_frame"},
    "table": {"workspace.insert_table"},
    "latex": {"workspace.insert_formula"},
    # A pill on its own: the AI's [n] citations become pills on Insert, and
    # every insert tool adds one.
    "checkpoint": {"workspace.insert_quote"},
    "clip": {"workspace.capture_clip"},
    "audio": {"workspace.capture_audio"},
}


def test_every_send_to_note_button_has_an_ai_tool():
    import re
    from pathlib import Path
    ts = (Path(__file__).resolve().parents[2] / "frontend/lib/workspace.ts").read_text()
    union = ts[ts.index("export type SendAction"):]
    union = union[:union.index(";\n\n")]
    actions = set(re.findall(r'type: "([a-z]+)"', union))
    assert actions, "SendAction not found"
    missing = actions - set(_BUTTON_TOOLS)
    assert not missing, f"viewer actions with no AI tool: {missing} — add one to source_tools.py"
    for tools in _BUTTON_TOOLS.values():
        assert tools <= source_tools.NAMES
