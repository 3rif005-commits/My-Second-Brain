"""Word / PowerPoint / Excel → markdown (ArtCraft study item 4). Every fixture is built in the
test itself (no binary files, no real notes). Needs python-docx, python-pptx and openpyxl —
installed in backend/.venv; skipped in a venv without them."""
import datetime as dt

import pytest

docx = pytest.importorskip("docx")
pptx = pytest.importorskip("pptx")
openpyxl = pytest.importorskip("openpyxl")

from services.office_extract import (  # noqa: E402
    markdown_table, office_to_markdown, sheet_islands, xlsx_display,
)


# ── docx ────────────────────────────────────────────────────────────────────

def _docx(tmp_path, build):
    d = docx.Document()
    build(d)
    p = tmp_path / "doc.docx"
    d.save(p)
    return str(p)


def test_docx_keeps_order_headings_lists_and_tables(tmp_path):
    def build(d):
        d.add_heading("Report", level=0)          # Title style
        d.add_heading("Introduction", level=1)
        d.add_paragraph("First paragraph.")
        t = d.add_table(rows=2, cols=2)
        t.cell(0, 0).text, t.cell(0, 1).text = "Name", "Score"
        t.cell(1, 0).text, t.cell(1, 1).text = "Ada", "9|10"
        d.add_paragraph("After the table.")
        d.add_heading("Details", level=2)
        d.add_paragraph("one", style="List Bullet")
        d.add_paragraph("two", style="List Bullet 2")
    md = office_to_markdown(_docx(tmp_path, build), ".docx")
    lines = md.splitlines()
    assert lines[0] == "# Report"
    assert "# Introduction" in lines and "## Details" in lines
    # The table sits between the paragraphs around it, not at the end.
    assert md.index("First paragraph.") < md.index("| Name | Score |") < md.index("After the table.")
    assert "| Ada | 9\\|10 |" in md
    assert "- one" in lines and "  - two" in lines
    # A list stays one block (no blank line between its items).
    assert md.index("- one") + len("- one\n") == md.index("  - two")


def test_docx_direct_indent_level(tmp_path):
    from docx.oxml import parse_xml

    def build(d):
        para = d.add_paragraph("nested", style="List Bullet")
        para._p.get_or_add_pPr().append(parse_xml(
            '<w:numPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:ilvl w:val="2"/><w:numId w:val="1"/></w:numPr>'))
    md = office_to_markdown(_docx(tmp_path, build), ".docx")
    assert md == "    - nested"


def test_docx_custom_style_based_on_heading_is_a_heading(tmp_path):
    from docx.enum.style import WD_STYLE_TYPE

    def build(d):
        st = d.styles.add_style("My Chapter", WD_STYLE_TYPE.PARAGRAPH)
        st.base_style = d.styles["Heading 1"]
        d.add_paragraph("Custom chapter", style="My Chapter")
        d.add_paragraph("Body.")
    md = office_to_markdown(_docx(tmp_path, build), ".docx")
    assert md.splitlines()[0] == "# Custom chapter"


def test_docx_merged_cells_appear_once(tmp_path):
    def build(d):
        t = d.add_table(rows=2, cols=3)
        a = t.cell(0, 0).merge(t.cell(0, 1))
        a.text = "Wide"
        t.cell(0, 2).text = "C"
        for i, v in enumerate(["1", "2", "3"]):
            t.cell(1, i).text = v
    md = office_to_markdown(_docx(tmp_path, build), ".docx")
    assert "| Wide | C |" in md


# ── pptx ────────────────────────────────────────────────────────────────────

def _pptx(tmp_path, build):
    from pptx import Presentation
    prs = Presentation()
    build(prs)
    p = tmp_path / "deck.pptx"
    prs.save(p)
    return str(p)


def test_pptx_titles_bullets_tables_charts_notes(tmp_path):
    from pptx.chart.data import CategoryChartData
    from pptx.enum.chart import XL_CHART_TYPE
    from pptx.util import Inches

    def build(prs):
        s = prs.slides.add_slide(prs.slide_layouts[1])  # title + content
        s.shapes.title.text = "Gradient descent"
        body = s.placeholders[1].text_frame
        body.text = "Minimise the loss"
        p = body.add_paragraph()
        p.text = "step size matters"
        p.level = 1
        s.notes_slide.notes_text_frame.text = "Say this slowly."

        s2 = prs.slides.add_slide(prs.slide_layouts[6])  # blank: no title
        tbl = s2.shapes.add_table(2, 2, Inches(1), Inches(1), Inches(4), Inches(1)).table
        tbl.cell(0, 0).text, tbl.cell(0, 1).text = "k", "acc"
        tbl.cell(1, 0).text, tbl.cell(1, 1).text = "1", "0.9"
        cd = CategoryChartData()
        cd.categories = ["2024", "2025"]
        cd.add_series("Users", (10, 25))
        ch = s2.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(3),
                                 Inches(4), Inches(3), cd).chart
        ch.has_title = True
        ch.chart_title.text_frame.text = "Growth"
    md = office_to_markdown(_pptx(tmp_path, build), ".pptx")
    lines = md.splitlines()
    assert "## Gradient descent" in lines
    assert "Minimise the loss" in lines and "- step size matters" in lines
    assert "Speaker notes: Say this slowly." in lines
    assert "## Slide 2" in lines
    assert "| k | acc |" in md and "| 1 | 0.9 |" in md
    assert "Chart: Growth" in md and "| 2025 | 25 |" in md
    assert md.index("## Gradient descent") < md.index("## Slide 2")


# ── xlsx ────────────────────────────────────────────────────────────────────

def test_xlsx_display_values():
    assert xlsx_display(dt.datetime(2026, 3, 4)) == "2026-03-04"
    assert xlsx_display(dt.datetime(2026, 3, 4, 9, 30)) == "2026-03-04 09:30"
    assert xlsx_display(0.256, "0.0%") == "25.6%"
    assert xlsx_display(0.5, "0%") == "50%"
    assert xlsx_display(1 / 3) == "0.3333333333"
    assert xlsx_display(None) == "" and xlsx_display(True) == "TRUE"


def test_sheet_islands_split_on_blank_rows_and_trim_columns():
    grid = [["", "", ""], ["", "a", "b"], ["", "1", "2"], ["", "", ""], ["x", "", ""]]
    assert sheet_islands(grid) == [[["a", "b"], ["1", "2"]], [["x"]]]


def test_xlsx_sheets_tables_dates_hidden(tmp_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Grades"
    ws.append(["Student", "Score", "Date"])
    ws.append(["Ada", 0.91, dt.datetime(2026, 1, 15)])
    ws["B2"].number_format = "0%"
    ws.append([])
    ws.append(["Average", 0.91])
    hidden = wb.create_sheet("Secret")
    hidden["A1"] = "do not show"
    hidden.sheet_state = "hidden"
    p = tmp_path / "book.xlsx"
    wb.save(p)
    md = office_to_markdown(str(p), ".xlsx")
    assert md.splitlines()[0] == "## Grades"
    assert "| Ada | 91% | 2026-01-15 |" in md
    assert "| Average | 0.91 |" in md          # a second table: the blank row split them
    assert "do not show" not in md


# ── hostile input ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("ext", [".docx", ".pptx", ".xlsx"])
def test_garbage_file_is_a_value_error_not_a_crash(tmp_path, ext):
    p = tmp_path / f"junk{ext}"
    p.write_bytes(b"PK\x03\x04 this is not really a zip" * 10)
    with pytest.raises(ValueError):
        office_to_markdown(str(p), ext)


def test_empty_document_is_reported(tmp_path):
    p = _docx(tmp_path, lambda d: None)
    with pytest.raises(ValueError, match="No readable text"):
        office_to_markdown(p, ".docx")


def test_markdown_table_pads_ragged_rows():
    assert markdown_table([["a", "b"], ["1"]]) == "| a | b |\n|---|---|\n| 1 |  |"


# ── the Workspace path ──────────────────────────────────────────────────────

def test_workspace_processor_reads_docx_as_sections(tmp_path, monkeypatch):
    """A .docx source goes through office_to_markdown and reaches the chunk rows (the only
    path to the model) with its heading and table, section-anchored."""
    from unittest.mock import MagicMock

    from services.workspace import processor

    d = docx.Document()
    d.add_heading("Week 3", level=1)
    d.add_paragraph("Entropy measures disorder.")
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text, t.cell(0, 1).text = "Term", "Meaning"
    t.cell(1, 0).text, t.cell(1, 1).text = "S", "entropy"
    path = tmp_path / "w3.docx"
    d.save(path)

    resource = {"id": "r1", "note_id": "n1", "user_id": "u1", "kind": "document",
                "storage_path": "u1/r1/w3.docx", "meta": {}, "title": "w3"}
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [resource]
    monkeypatch.setattr(processor, "get_supabase", lambda: db)
    monkeypatch.setattr(processor.storage, "download", lambda p: path.read_bytes())
    monkeypatch.setattr(processor, "touch_settle", lambda *a, **k: None, raising=False)
    got = {}
    monkeypatch.setattr(processor, "_insert_elements", lambda r, els: got.setdefault("els", els))
    monkeypatch.setattr(processor, "_insert_chunks", lambda r, ch: got.setdefault("chunks", ch))
    statuses = []
    monkeypatch.setattr(processor, "_set_status", lambda rid, st, *a, **k: statuses.append(st))

    processor._process_resource("r1")

    text = "\n".join(c["chunk_text"] for c in got["chunks"])
    assert "Week 3" in text and "| Term | Meaning |" in text and "Entropy measures disorder." in text
    assert all(c["anchor_type"] == "section" for c in got["chunks"])
    assert any(e["element_type"] == "heading" and e["content"] == "Week 3" for e in got["els"])
    assert "failed" not in statuses


# ── Word equations → LaTeX (item 8) ─────────────────────────────────────────

M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'


def _omml(inner: str, para: bool = False):
    from lxml import etree
    xml = f"<m:oMath {M}>{inner}</m:oMath>"
    if para:
        xml = f"<m:oMathPara {M}>{xml}</m:oMathPara>"
    return etree.fromstring(xml)


def r(t: str) -> str:
    return f"<m:r><m:t>{t}</m:t></m:r>"


def test_omml_fraction_scripts_radical():
    from services.office_extract import omml_math
    frac = f"<m:f><m:num>{r('a')}</m:num><m:den>{r('b')}</m:den></m:f>"
    assert omml_math(_omml(frac)) == r"$\frac{a}{b}$"
    sup = f"<m:sSup><m:e>{r('x')}</m:e><m:sup>{r('2')}</m:sup></m:sSup>"
    assert omml_math(_omml(sup)) == "${x}^{2}$"
    both = f"<m:sSubSup><m:e>{r('x')}</m:e><m:sub>{r('i')}</m:sub><m:sup>{r('2')}</m:sup></m:sSubSup>"
    assert omml_math(_omml(both)) == "${x}_{i}^{2}$"
    rad = f"<m:rad><m:radPr><m:degHide m:val='1'/></m:radPr><m:deg/><m:e>{r('y')}</m:e></m:rad>"
    assert omml_math(_omml(rad)) == r"$\sqrt{y}$"
    cube = f"<m:rad><m:deg>{r('3')}</m:deg><m:e>{r('y')}</m:e></m:rad>"
    assert omml_math(_omml(cube)) == r"$\sqrt[3]{y}$"


def test_omml_sum_delimiters_functions_matrix_display():
    from services.office_extract import omml_math
    nary = (f"<m:nary><m:naryPr><m:chr m:val='∑'/></m:naryPr><m:sub>{r('i=1')}</m:sub>"
            f"<m:sup>{r('n')}</m:sup><m:e>{r('i')}</m:e></m:nary>")
    assert omml_math(_omml(nary)) == r"$\sum_{i=1}^{n} i$"
    d = f"<m:d><m:e>{r('a+b')}</m:e></m:d>"
    assert omml_math(_omml(d)) == r"$\left( a+b \right)$"
    abs_ = f"<m:d><m:dPr><m:begChr m:val='|'/><m:endChr m:val='|'/></m:dPr><m:e>{r('x')}</m:e></m:d>"
    assert omml_math(_omml(abs_)) == r"$\left| x \right|$"
    func = f"<m:func><m:fName>{r('sin')}</m:fName><m:e>{r('θ')}</m:e></m:func>"
    assert omml_math(_omml(func)) == r"$\sin θ$"
    mat = (f"<m:m><m:mr><m:e>{r('1')}</m:e><m:e>{r('0')}</m:e></m:mr>"
           f"<m:mr><m:e>{r('0')}</m:e><m:e>{r('1')}</m:e></m:mr></m:m>")
    assert omml_math(_omml(mat)) == r"$\begin{matrix} 1 & 0 \\ 0 & 1 \end{matrix}$"
    assert omml_math(_omml(r("E=mc"), para=True)) == "$$E=mc$$"


def test_omml_escapes_and_keeps_unknown_content():
    from services.office_extract import omml_math
    assert omml_math(_omml(r("50%"))) == r"$50\%$"
    assert omml_math(_omml(f"<m:groupChr><m:e>{r('z')}</m:e></m:groupChr>")) == "$z$"
    assert omml_math(_omml("")) == ""


def test_docx_equation_becomes_latex_in_its_paragraph(tmp_path):
    from docx.oxml import parse_xml

    def build(d):
        p = d.add_paragraph("Energy is ")
        p._p.append(parse_xml(
            f"<m:oMath {M}><m:r><m:t>E=m</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e>"
            f"<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>"))
        p.add_run(" exactly.")
    md = office_to_markdown(_docx(tmp_path, build), ".docx")
    assert md == "Energy is $E=m{c}^{2}$ exactly."


def test_docx_equation_inside_a_table_cell_is_kept(tmp_path):
    from docx.oxml import parse_xml

    def build(d):
        t = d.add_table(rows=1, cols=2)
        t.cell(0, 0).text = "Delay"
        t.cell(0, 1).paragraphs[0]._p.append(parse_xml(
            f"<m:oMath {M}><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num>"
            f"<m:den><m:r><m:t>2f</m:t></m:r></m:den></m:f></m:oMath>"))
    md = office_to_markdown(_docx(tmp_path, build), ".docx")
    assert r"| Delay | $\frac{1}{2f}$ |" in md
