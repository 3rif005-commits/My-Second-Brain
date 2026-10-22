"""Scanned PDF pages read by a vision model (ArtCraft study item 13)."""
import pytest

from services.workspace import scanned
from services.workspace.scanned import MAX_PAGES, NoVision, read_scanned_pages


def test_no_vision_provider_raises(monkeypatch):
    import services.ai.router as r
    monkeypatch.setattr(r, "candidates", lambda task, uid: [])
    with pytest.raises(NoVision):
        read_scanned_pages("x.pdf", [1], "u1", render=lambda p, n: b"", ask=lambda png: "x")


def test_reads_pages_skips_failures_unwraps_fences_and_caps(monkeypatch):
    import services.ai.router as r
    monkeypatch.setattr(r, "candidates", lambda task, uid: ["p"])
    asked = []

    def ask(png):
        n = int(png.decode())
        asked.append(n)
        if n == 2:
            raise RuntimeError("provider hiccup")
        if n == 3:
            return "```markdown\n## Page three\n```"
        return f"text {n}" if n != 4 else "   "
    got = read_scanned_pages("x.pdf", list(range(1, 60)), "u1",
                             render=lambda path, n: str(n).encode(), ask=ask)
    assert got[1] == "text 1" and 2 not in got and got[3] == "## Page three" and 4 not in got
    assert len(asked) == MAX_PAGES


def test_empty_page_list_asks_nothing():
    assert read_scanned_pages("x.pdf", [], "u1") == {}


fitz = pytest.importorskip("fitz")
real_fitz = pytest.mark.skipif(type(fitz).__name__ == "MagicMock" or not hasattr(fitz, "Document"),
                               reason="PyMuPDF not installed in this venv (run with backend/.venv)")


@real_fitz
def test_extract_marks_only_image_only_pages_as_scanned(tmp_path):
    from services.workspace.pdf_elements import extract_pdf
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "A real text page.")          # 1: text
    doc.new_page()                                                      # 2: blank
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 400, 500), False)
    pix.set_rect(pix.irect, (240, 240, 240))
    p3 = doc.new_page()
    p3.insert_image(p3.rect, pixmap=pix)                                # 3: full-page image
    path = tmp_path / "scan.pdf"
    doc.save(path)
    assert extract_pdf(str(path))["textless_pages"] == [3]
