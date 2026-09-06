"""Figure crops reaching the model — the second input path beside pages_text."""
import hashlib
import io
from unittest.mock import patch

import pytest
from PIL import Image

from services.workspace import figures


def _png(w: int, h: int, seed: tuple = (120, 30, 200)) -> bytes:
    """A crop with real contrast in it — a flat fill is rejected as a non-figure,
    which is what test_a_flat_filled_panel_is_not_a_figure covers."""
    buf = io.BytesIO()
    im = Image.new("RGB", (w, h), seed)
    inv = Image.new("RGB", (w // 2, h), (255 - seed[0], 255 - seed[1], 255 - seed[2]))
    im.paste(inv, (0, 0))
    im.save(buf, format="PNG")
    return buf.getvalue()


def _unique(path: str) -> bytes:
    """A distinct image per path, so deduplication does not collapse them."""
    h = hashlib.md5(path.encode()).digest()
    # kept dark so the inverted stripes always clear MIN_STDDEV
    return _png(300, 200, (h[0] % 60, h[1] % 60, h[2] % 60))


def _rows(n: int, page_start: int = 1, prefix: str = "r"):
    # `prefix` stands in for the resource id: real object paths are
    # `{user}/{resource}/elements/{i}.png`, so two sources never collide.
    return [{"page": page_start + i, "order_index": i,
             "image_path": f"u/{prefix}/elements/{i}.png"} for i in range(n)]


# ── _downscale ───────────────────────────────────────────────────────────────

def test_a_crop_smaller_than_a_figure_is_dropped_not_sent():
    assert figures._downscale(_png(40, 40)) is None


def test_a_crop_within_the_edge_limit_is_sent_byte_for_byte():
    data = _png(300, 200)
    assert figures._downscale(data) is data


def test_an_oversized_crop_is_downscaled_to_the_long_edge():
    out = figures._downscale(_png(4000, 2000))
    assert Image.open(io.BytesIO(out)).size == (figures.MAX_EDGE, figures.MAX_EDGE // 2)


def test_unreadable_bytes_are_passed_through_rather_than_losing_the_figure():
    assert figures._downscale(b"not a png") == b"not a png"


# ── figure_parts ─────────────────────────────────────────────────────────────

def test_each_figure_is_labelled_with_its_source_and_page_before_the_image():
    with patch.object(figures, "_rows", return_value=_rows(2, page_start=6)), \
         patch.object(figures.storage, "download", side_effect=_unique):
        parts = figures.figure_parts(["src-1"])
    assert [p["type"] for p in parts] == ["text", "image", "text", "image"]
    assert parts[0]["text"] == "[FIGURE — SOURCE 1, page 6]"
    assert parts[2]["text"] == "[FIGURE — SOURCE 1, page 7]"
    assert parts[1]["mime"] == "image/png"


def test_no_sources_means_no_parts_and_no_queries():
    assert figures.figure_parts([]) == []


def test_the_cap_is_counted_in_figures_not_in_content_parts():
    with patch.object(figures, "_rows", return_value=_rows(50)), \
         patch.object(figures.storage, "download", side_effect=_unique):
        parts = figures.figure_parts(["src-1"], limit=5)
    assert len(parts) == 10          # 5 label+image pairs, not 5 parts


def test_the_cap_is_shared_round_robin_so_one_long_pdf_cannot_starve_the_rest():
    # Source 1 has plenty, source 2 has one diagram: that one must still be sent.
    def rows(sid):
        return _rows(20, prefix=sid) if sid == "long" else _rows(1, prefix=sid)
    with patch.object(figures, "_rows", side_effect=rows), \
         patch.object(figures.storage, "download", side_effect=_unique):
        parts = figures.figure_parts(["long", "short"], limit=4)
    labels = [p["text"] for p in parts if p["type"] == "text"]
    assert "[FIGURE — SOURCE 2, page 1]" in labels


# ── deduplication and page furniture ─────────────────────────────────────────

def test_the_same_crop_on_many_pages_is_furniture_and_is_never_sent():
    # A logo on every slide: 8 crops, one image, zero figures.
    with patch.object(figures, "_rows", return_value=_rows(8)), \
         patch.object(figures.storage, "download", return_value=_png(300, 200)):
        assert figures.figure_parts(["src-1"]) == []


def test_a_repeated_crop_does_not_crowd_the_one_real_diagram_out_of_the_cap():
    # The shape of the real lecture: a logo on pages 1-8, a diagram on page 9.
    logo, diagram = _png(300, 200), _png(301, 200)
    rows = _rows(8) + [{"page": 9, "order_index": 8, "image_path": "u/r/elements/d.png"}]
    seq = [logo] * 8 + [diagram]
    with patch.object(figures, "_rows", return_value=rows), \
         patch.object(figures.storage, "download", side_effect=seq):
        parts = figures.figure_parts(["src-1"], limit=4)
    assert [p["text"] for p in parts if p["type"] == "text"] == \
           ["[FIGURE — SOURCE 1, page 9]"]


def test_a_duplicate_below_the_furniture_threshold_is_sent_once_not_twice():
    same = _png(300, 200)
    with patch.object(figures, "_rows", return_value=_rows(2)), \
         patch.object(figures.storage, "download", return_value=same):
        parts = figures.figure_parts(["src-1"])
    assert len([p for p in parts if p["type"] == "image"]) == 1


def test_a_diagram_repeated_on_ONE_page_is_a_figure_not_furniture():
    # FURNITURE_PAGES counts distinct pages, so a busy single page is safe.
    rows = [{"page": 3, "order_index": i, "image_path": f"u/r/{i}.png"}
            for i in range(6)]
    with patch.object(figures, "_rows", return_value=rows), \
         patch.object(figures.storage, "download", side_effect=_unique):
        parts = figures.figure_parts(["src-1"])
    assert len([p for p in parts if p["type"] == "image"]) == 6


def test_the_scan_is_bounded_so_a_huge_pdf_cannot_be_downloaded_whole():
    calls = {"n": 0}

    def counted(_p):
        calls["n"] += 1
        return _unique(_p)

    with patch.object(figures, "_rows", return_value=_rows(5000)), \
         patch.object(figures.storage, "download", side_effect=counted):
        figures.figure_parts(["src-1"])
    assert calls["n"] == figures.SCAN_LIMIT


def test_one_unreadable_crop_does_not_lose_the_others():
    calls = {"n": 0}

    def flaky(_path):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("object missing")
        return _unique(_path)

    with patch.object(figures, "_rows", return_value=_rows(3)), \
         patch.object(figures.storage, "download", side_effect=flaky):
        parts = figures.figure_parts(["src-1"])
    assert len([p for p in parts if p["type"] == "image"]) == 2


def test_a_source_whose_elements_cannot_be_listed_is_skipped_not_fatal():
    with patch.object(figures, "_rows", side_effect=RuntimeError("db down")), \
         patch.object(figures.storage, "download", side_effect=_unique):
        assert figures.figure_parts(["src-1"]) == []


# ── the synthesis wiring ─────────────────────────────────────────────────────

def test_figures_go_out_on_a_vision_job_that_can_never_reach_a_text_only_model():
    from services.workspace import synthesis
    parts = [{"type": "text", "text": "[FIGURE — SOURCE 1, page 2]"},
             {"type": "image", "data": b"png", "mime": "image/png"}]
    with patch.object(synthesis, "complete_with_fallback",
                      return_value="<h1>T</h1><h2>C</h2>" + "x" * 600) as ai:
        synthesis._complete("PROMPT", [], True, "user-1", parts)
    assert ai.call_args.args[0] == "synthesize_vision"
    sent = ai.call_args.args[2][0]["content"]
    assert sent[0] == {"type": "text", "text": "PROMPT"}
    assert sent[1:] == parts


def test_a_failed_vision_call_still_writes_the_note_from_the_text_alone():
    from services.workspace import synthesis
    jobs = []

    def ai(job, *a, **k):
        jobs.append(job)
        if job == "synthesize_vision":
            raise RuntimeError("vision provider down")
        return "<h1>T</h1><h2>C</h2>" + "x" * 600

    with patch.object(synthesis, "complete_with_fallback", side_effect=ai):
        out = synthesis._complete("PROMPT", [], True, "user-1",
                                  [{"type": "image", "data": b"p"}])
    assert jobs == ["synthesize_vision", "summarize_text"]
    assert out.startswith("<h1>T</h1>")


def test_with_no_figures_the_call_is_unchanged_plain_text_on_the_text_job():
    from services.workspace import synthesis
    with patch.object(synthesis, "complete_with_fallback",
                      return_value="<h1>T</h1><h2>C</h2>" + "x" * 600) as ai:
        synthesis._complete("PROMPT", [], True, "user-1", [])
    assert ai.call_args.args[0] == "summarize_text"
    assert ai.call_args.args[2] == [{"role": "user", "content": "PROMPT"}]


def test_the_figure_instructions_are_only_in_the_prompt_when_figures_are_sent():
    from prompts.note_synthesis import build_note_synthesis_prompt, FIGURE_EXTENSION
    src = [{"title": "t", "kind": "pdf", "text": "body", "duration": None}]
    assert FIGURE_EXTENSION in build_note_synthesis_prompt(src, has_figures=True)
    assert FIGURE_EXTENSION not in build_note_synthesis_prompt(src)


def test_the_vision_job_never_ranks_a_text_only_provider():
    from services.ai.router import candidates
    from services.ai.providers import Provider
    pool = [Provider("local", capabilities={"text"}),
            Provider("openai_compatible", capabilities={"text"}),
            Provider("anthropic", capabilities={"text", "vision", "long_context"})]
    assert [p.provider for p in candidates("synthesize_vision", "u", pool)] == ["anthropic"]


def test_a_flat_filled_panel_is_not_a_figure():
    # Slide templates ship solid rectangles as embedded images.
    buf = io.BytesIO()
    Image.new("RGB", (600, 300), (247, 248, 250)).save(buf, format="PNG")
    assert figures._downscale(buf.getvalue()) is None


def test_a_crop_with_a_picture_in_it_survives_the_flatness_test():
    buf = io.BytesIO()
    im = Image.new("RGB", (300, 200), (255, 255, 255))
    im.paste(Image.new("RGB", (150, 200), (0, 0, 0)), (0, 0))   # like a diagram
    im.save(buf, format="PNG")
    assert figures._downscale(buf.getvalue()) is not None


def test_sending_figures_is_off_by_default():
    """Measured, not cautious: on the reference lecture the figures added no
    content the text-only runs missed and cost colour-budget compliance."""
    from core.config import settings
    assert settings.workspace_synthesis_vision is False


def test_run_synthesis_asks_for_figures_when_the_flag_is_on_or_theres_no_text():
    """The flag gates figures for the normal (has-text) case, but a source
    with no extractable text at all — a scanned/image-only PDF — has nothing
    else to synthesize from, so vision fires regardless of the flag."""
    import inspect
    from services.workspace import synthesis
    src = inspect.getsource(synthesis.run_synthesis)
    assert "settings.workspace_synthesis_vision or not has_text" in src
    assert "figure_parts(source_ids)" in src
