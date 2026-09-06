"""Tests for workspace extraction helpers: page/transcript/section chunking,
math-density heuristics, and website extraction (trafilatura mocked)."""
from unittest.mock import MagicMock, patch

from services.workspace.pdf_elements import _math_density, chunk_pages, repair_text
from services.workspace.youtube import chunk_transcript, transcript_text, _fmt_ts
from services.workspace.website import chunk_sections


# ── PDF page chunking ─────────────────────────────────────────────────────────

def test_chunk_pages_anchors_pages():
    pages = ["[page 1]\nIntro text about gradients.", "[page 2]\nMore depth here."]
    chunks = chunk_pages(pages)
    assert len(chunks) == 2
    assert chunks[0]["anchor_type"] == "page"
    assert chunks[0]["anchor_start"] == 1
    assert chunks[1]["anchor_start"] == 2
    assert "gradients" in chunks[0]["chunk_text"]
    assert "[page" not in chunks[0]["chunk_text"]


def test_chunk_pages_splits_long_pages():
    long_page = "[page 1]\n" + "\n".join(f"Paragraph {i} " + "x" * 300 for i in range(10))
    chunks = chunk_pages([long_page], max_chars=800)
    assert len(chunks) > 1
    assert all(c["anchor_start"] == 1 for c in chunks)
    # chunk_index strictly increasing
    assert [c["chunk_index"] for c in chunks] == list(range(len(chunks)))


def test_chunk_pages_skips_empty_pages():
    chunks = chunk_pages(["[page 1]\n", "[page 2]\nContent."])
    assert len(chunks) == 1
    assert chunks[0]["anchor_start"] == 2


def test_math_density_flags_symbolic_text():
    assert _math_density("∫∑√α = β ± ∞") > 0.15
    assert _math_density("Plain prose about history.") < 0.05
    assert _math_density("") == 0.0


# ── YouTube transcript chunking ───────────────────────────────────────────────

def _snippets(n, step=10.0):
    return [{"text": f"snippet {i}", "start": i * step, "duration": step} for i in range(n)]


def test_chunk_transcript_windows_by_time():
    chunks = chunk_transcript(_snippets(20, step=10.0), window_seconds=75.0)
    assert len(chunks) >= 2
    first = chunks[0]
    assert first["anchor_type"] == "time"
    assert first["anchor_start"] == 0.0
    assert first["anchor_end"] >= 75.0
    # windows don't overlap and are ordered
    for a, b in zip(chunks, chunks[1:]):
        assert b["anchor_start"] >= a["anchor_start"]


def test_chunk_transcript_flushes_tail():
    chunks = chunk_transcript(_snippets(3, step=10.0), window_seconds=75.0)
    assert len(chunks) == 1
    assert "snippet 2" in chunks[0]["chunk_text"]


def test_transcript_text_prefixes_timestamps():
    text = transcript_text([
        {"text": "hello", "start": 0, "duration": 5},
        {"text": "world", "start": 65, "duration": 5},
        {"text": "later", "start": 3700, "duration": 5},
    ])
    lines = text.split("\n")
    assert lines[0].startswith("[00:00]")
    assert lines[1].startswith("[01:05]")
    assert lines[2].startswith("[1:01:40]")


def test_fmt_ts():
    assert _fmt_ts(0) == "00:00"
    assert _fmt_ts(75) == "01:15"
    assert _fmt_ts(3661) == "1:01:01"


# ── Website section chunking ─────────────────────────────────────────────────

def test_chunk_sections_anchors_section_indices():
    sections = [
        {"index": 0, "kind": "heading", "content": "Title"},
        {"index": 1, "kind": "text", "content": "First paragraph. " * 10},
        {"index": 2, "kind": "image", "content": "https://img"},
        {"index": 3, "kind": "text", "content": "Second paragraph. " * 10},
    ]
    chunks = chunk_sections(sections, max_chars=100)
    assert all(c["anchor_type"] == "section" for c in chunks)
    assert chunks[0]["anchor_start"] == 0
    # image sections never enter chunks
    assert all("https://img" not in c["chunk_text"] for c in chunks)


def test_extract_website_parses_sections_and_tags():
    doc = {
        "title": "My Article",
        "text": "# Heading One\nBody paragraph here.\n![alt](https://example.com/pic.png)\nAnother paragraph.",
        "author": "Jane",
        "image": "https://example.com/thumb.png",
    }
    fake_traf = MagicMock()
    fake_traf.fetch_url.return_value = "<html>raw</html>"
    fake_traf.bare_extraction.return_value = doc
    with patch("services.workspace.website.trafilatura", fake_traf):
        from services.workspace.website import extract_website
        data = extract_website("https://example.com/a")

    assert data["title"] == "My Article"
    kinds = [s["kind"] for s in data["sections"]]
    assert kinds == ["heading", "text", "image", "text"]
    assert data["sections"][0]["content"] == "Heading One"
    assert data["sections"][2]["content"] == "https://example.com/pic.png"
    assert "[section 1] Body paragraph here." in data["tagged_text"]
    assert data["meta"]["author"] == "Jane"


# ---- repair_text: PDF glyph-encoding damage --------------------------------
#
# Every string below is a VERBATIM capture from a real PowerPoint-exported
# lecture (Lect10-IML26.pdf), not a constructed example — the whole point of
# this repair is that these encodings are what actually arrives.

def test_repair_decodes_powerpoint_subscripts():
    """PowerPoint's subscript font lands in the Odia block; the run is a clean
    linear offset from U+0B5F, so it decodes exactly rather than by guesswork."""
    assert repair_text("Q(S1, down) \u0b6d\u0b60\u0b71\u0b63\u0b70\u0b74\u0b63\u0b62") == \
        "Q(S1, down) _observed"
    assert repair_text("\u0b63\u0b76\u0b6e\u0b63\u0b61\u0b72\u0b63\u0b62") == "_expected"
    assert repair_text("\u0b5f") == "_a"


def test_repair_normalizes_mathematical_alphanumerics():
    """Bold/italic maths glyphs (𝒎𝒂𝒙, 𝟎.𝟖𝟓) are a Unicode block NFKC maps back."""
    assert repair_text("\U0001d48e\U0001d482\U0001d499") == "max"
    assert repair_text("\U0001d7ce.\U0001d7d6\U0001d7d3") == "0.85"


def test_repair_translates_symbol_font_private_use_glyphs():
    assert repair_text("Actions \uf0e0 Max reward") == "Actions -> Max reward"
    # An unmapped PUA glyph carries no recoverable text — it must not survive
    # into the prompt as a stray box character.
    assert "\uf123" not in repair_text("a \uf123 b")


def test_repair_leaves_ordinary_text_alone():
    """It runs on every extracted string, so being a no-op on clean input is
    the property that matters most."""
    for clean in ["Reinforcement Learning", "TDE = -1.6", "γ = 0.9",
                  "|Application|Why RL?|", "", "Q(s,a) vs V(s)"]:
        assert repair_text(clean) == clean


def test_repair_makes_the_bellman_equation_readable():
    """The end-to-end case this exists for: what the model used to receive."""
    raw = ("Q(S1, down) \u0b6d\u0b60\u0b71\u0b63\u0b70\u0b74\u0b63\u0b62 = "
           "R(S4) + \u03b3 \U0001d48e\U0001d482\U0001d499")
    assert repair_text(raw) == "Q(S1, down) _observed = R(S4) + γ max"


# ---- markdown / plain-text sectioning --------------------------------------
#
# These files used to be tagged "[page 1]" in their entirety, so every chunk,
# anchor and jump chip on a long file pointed at page 1.

from services.workspace.sections import (  # noqa: E402
    sections_as_elements, split_markdown_sections, tag_sections)

_MD = """# Reinforcement Learning

An agent learns by trial and error.
It gets a scalar reward.

## Q-Learning

The Q-table holds one value per state-action pair.

### Bellman

Q(s,a) = R(s') + gamma * max Q(s',a')
"""


def test_split_markdown_sections_splits_on_headings_and_blank_lines():
    secs = split_markdown_sections(_MD)
    assert [s["kind"] for s in secs] == [
        "heading", "text", "heading", "text", "heading", "text"]
    assert secs[0]["content"] == "Reinforcement Learning"
    assert secs[2]["content"] == "Q-Learning"
    # The hash marks are stripped from the heading text, not carried into it.
    assert not any(s["content"].startswith("#") for s in secs)


def test_split_markdown_sections_indexes_are_contiguous_anchors():
    """The index IS the anchor value, so a gap or a repeat silently points a
    jump chip at the wrong place."""
    secs = split_markdown_sections(_MD)
    assert [s["index"] for s in secs] == list(range(len(secs)))


def test_split_markdown_sections_handles_plain_text_with_no_headings():
    secs = split_markdown_sections("First para.\n\nSecond para.\n\n\nThird.")
    assert [s["kind"] for s in secs] == ["text", "text", "text"]
    assert [s["content"] for s in secs] == ["First para.", "Second para.", "Third."]


def test_split_markdown_sections_on_empty_input():
    assert split_markdown_sections("") == []
    assert split_markdown_sections("\n\n   \n") == []


def test_markdown_chunks_are_section_anchored_not_page_anchored():
    """The actual regression this replaced: one page-1 anchor for a whole file."""
    chunks = chunk_sections(split_markdown_sections(_MD * 40))
    assert chunks, "a long markdown file must produce chunks"
    assert {c["anchor_type"] for c in chunks} == {"section"}
    assert len({c["anchor_start"] for c in chunks}) > 1, \
        "every chunk landed on the same anchor — sync would be dead again"


def test_tag_sections_marks_headings_and_drops_images():
    secs = [{"index": 0, "kind": "heading", "content": "Title"},
            {"index": 1, "kind": "text", "content": "Body"},
            {"index": 2, "kind": "image", "content": "https://x/y.png"}]
    tagged = tag_sections(secs)
    assert "[section 0] ## Title" in tagged
    assert "[section 1] Body" in tagged
    assert "y.png" not in tagged


def test_sections_as_elements_preserves_index_as_order():
    els = sections_as_elements(split_markdown_sections(_MD))
    assert [e["order_index"] for e in els] == list(range(len(els)))
    assert {e["element_type"] for e in els} <= {"heading", "text", "image"}
