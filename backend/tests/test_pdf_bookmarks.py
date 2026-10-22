"""PDF bookmarks become the note's chapters (ArtCraft study item 3, after pdfcraft's
headings-from-structure). Builds real PDFs in PyMuPDF; no fixture files."""
import pytest

fitz = pytest.importorskip("fitz")
# Some test modules replace `fitz` with a MagicMock in sys.modules; PDFs can't be built then.
real_fitz = pytest.mark.skipif(type(fitz).__name__ == "MagicMock" or not hasattr(fitz, "Document"),
                               reason="PyMuPDF not installed in this venv (run with backend/.venv)")

from services.workspace.pdf_elements import (
    extract_pdf, heading_marker, match_toc, norm_heading, toc_by_page,
)


def _pdf(tmp_path, pages, toc=None):
    doc = fitz.open()
    for lines in pages:
        page = doc.new_page()
        y = 72
        for text in lines:
            page.insert_text((72, y), text, fontsize=11)  # all one size: no font-size headings
            y += 20
    if toc:
        doc.set_toc(toc)
    path = tmp_path / "book.pdf"
    doc.save(path)
    doc.close()
    return str(path)


def test_norm_heading_ignores_numbering_case_and_punctuation():
    assert norm_heading("2.3 Gradient Descent:") == norm_heading("gradient descent")
    assert norm_heading("IV. Results") == norm_heading("Results")
    assert norm_heading("") == ""


def test_heading_marker_levels():
    assert [heading_marker(n) for n in (1, 2, 3, 7)] == ["# ", "## ", "### ", "### "]


def test_toc_by_page_drops_junk_and_out_of_range():
    toc = [[1, "Intro", 1], [2, "", 1], [1, "Far", 99], ["x", "Bad", 1], [1, "Two", 2]]
    got = toc_by_page(toc, page_count=2)
    assert [e["title"] for e in got[0]] == ["Intro"]
    assert [e["title"] for e in got[1]] == ["Two"]


def test_match_toc_uses_each_bookmark_once():
    entries = toc_by_page([[1, "Methods", 1]], 1)[0]
    first = match_toc(entries, "3 Methods")
    assert first is not None
    first["used"] = True
    assert match_toc(entries, "Methods") is None


@real_fitz
def test_bookmarks_mark_headings_with_levels(tmp_path):
    path = _pdf(tmp_path,
                [["1 Introduction", "Plain body text about the topic."],
                 ["1.1 Background", "More body text here.", "2 Results", "Numbers."]],
                toc=[[1, "Introduction", 1], [2, "Background", 2], [1, "Results", 2]])
    data = extract_pdf(path)
    p1, p2 = data["pages_text"]
    assert "# 1 Introduction" in p1.splitlines()
    assert "## 1.1 Background" in p2.splitlines()
    assert "# 2 Results" in p2.splitlines()
    assert "Plain body text about the topic." in p1.splitlines()  # body stays body
    headings = [e["content"] for e in data["elements"] if e["element_type"] == "heading"]
    assert {"1 Introduction", "1.1 Background", "2 Results"} <= set(headings)


@real_fitz
def test_bookmark_without_matching_text_still_starts_its_chapter(tmp_path):
    path = _pdf(tmp_path, [["Only body text on this page."]], toc=[[1, "Chapter One", 1]])
    lines = extract_pdf(path)["pages_text"][0].splitlines()
    assert lines[:2] == ["[page 1]", "# Chapter One"]


@real_fitz
def test_no_bookmarks_changes_nothing(tmp_path):
    path = _pdf(tmp_path, [["Same size line one.", "Same size line two."]])
    text = extract_pdf(path)["pages_text"][0]
    assert "#" not in text
