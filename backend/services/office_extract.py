"""Word, PowerPoint and Excel files → clean markdown (ArtCraft study item 4).

The PDF path learned to keep tables and headings in 2026-09; Office files never did. These
readers follow what WordCraft / DeckCraft / GridCraft do (ideas only, written here from the
public OOXML structure):

- .docx: walk the body IN ORDER (paragraphs and tables interleaved, as the author placed them);
  a heading is a paragraph whose *resolved* outline level says so — direct, or inherited
  through the style's `basedOn` chain — not one whose style happens to be named "Heading 1",
  so custom and localized heading styles still count; list items keep their indent level;
  equations are handed to `math` (plain text by default, so no words are lost).
- .pptx: one `## ` heading per slide (its title placeholder), shapes top-to-bottom, group shapes
  opened, tables as markdown tables, charts as "Chart:" + the numbers they carry, picture alt
  text, then the speaker notes. Reading the .pptx avoids the PowerPoint→PDF glyph mojibake.
- .xlsx: one `## ` heading per visible sheet; each block of cells separated by blank rows is a
  markdown table; cells read as Excel *displays* them (cached values, dates as dates, percents
  as percents), blank outer rows/columns trimmed.

Every reader is bounded (rows, columns, characters, nesting) and turns a malformed file into a
ValueError, never a crash. Unknown elements keep their text.
"""
from __future__ import annotations

import datetime as _dt
import re
from typing import Callable

MAX_CHARS = 2_000_000
MAX_SHEET_ROWS = 2_000
MAX_SHEET_COLS = 50
MAX_DEPTH = 20

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
_W = lambda t: f"{{{W_NS}}}{t}"  # noqa: E731
_M = lambda t: f"{{{M_NS}}}{t}"  # noqa: E731


def office_to_markdown(path: str, ext: str) -> str:
    """Dispatch on extension. Raises ValueError for an unreadable or empty file."""
    ext = ext.lower()
    readers = {".docx": docx_to_markdown, ".pptx": pptx_to_markdown, ".xlsx": xlsx_to_markdown}
    if ext not in readers:
        raise ValueError(f"Unsupported Office file type: {ext}")
    try:
        md = readers[ext](path)
    except ValueError:
        raise
    except Exception as e:  # a damaged or hostile file is an error, not a crash
        raise ValueError(f"Could not read this {ext} file ({type(e).__name__}).") from e
    md = md.strip("\n")  # not strip(): a leading indented list item keeps its indent
    if not md.strip():
        raise ValueError(f"No readable text found in the {ext} file.")
    return md[:MAX_CHARS]


# ── shared ──────────────────────────────────────────────────────────────────

def _cell(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().replace("|", "\\|")


def markdown_table(rows: list[list[str]]) -> str:
    """Rows of cell strings → a markdown table, first row as the header."""
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [[_cell(c) for c in r] + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def _join_blocks(blocks: list[tuple[str, str]]) -> str:
    """Blocks are separated by a blank line (one section each), except consecutive list items,
    which stay together so a list is one section."""
    out: list[str] = []
    prev = ""
    for kind, text in blocks:
        if not text.strip():
            continue
        if out and not (kind == "list" and prev == "list"):
            out.append("")
        out.append(text)
        prev = kind
    return "\n".join(out)


# ── .docx ───────────────────────────────────────────────────────────────────

def _omml_plain(el) -> str:
    """Default equation handling: its text, so no words are lost."""
    return "".join(t.text or "" for t in el.iter(_M("t")))


def _run_text(el, math: Callable, depth: int = 0) -> str:
    """Text of a paragraph (or any run container) in document order."""
    if depth > MAX_DEPTH:
        return ""
    out: list[str] = []
    for ch in el:
        tag = ch.tag
        if tag in (_M("oMath"), _M("oMathPara")):
            out.append(math(ch))
        elif tag == _W("t"):
            out.append(ch.text or "")
        elif tag == _W("tab"):
            out.append("\t")
        elif tag in (_W("br"), _W("cr")):
            out.append(" ")
        elif tag in (_W("del"), _W("instrText"), _W("delText"), _W("pPr"), _W("rPr")):
            continue  # deleted tracked changes, field codes, formatting
        else:
            out.append(_run_text(ch, math, depth + 1))
    return "".join(out)


def _outline_from_ppr(ppr) -> int | None:
    if ppr is None:
        return None
    ol = ppr.find(_W("outlineLvl"))
    if ol is None:
        return None
    try:
        v = int(ol.get(_W("val")))
    except (TypeError, ValueError):
        return None
    return v if 0 <= v < 9 else None  # 9 = body text


def _numbered_ilvl(ppr) -> int | None:
    if ppr is None:
        return None
    num = ppr.find(_W("numPr"))
    if num is None:
        return None
    num_id = num.find(_W("numId"))
    if num_id is not None and num_id.get(_W("val")) == "0":
        return None  # numId 0 = numbering explicitly removed
    ilvl = num.find(_W("ilvl"))
    try:
        return max(0, min(int(ilvl.get(_W("val"))), 8)) if ilvl is not None else 0
    except (TypeError, ValueError):
        return 0


def _style_chain(style):
    seen = 0
    while style is not None and seen < MAX_DEPTH:
        yield style
        style = getattr(style, "base_style", None)
        seen += 1


def docx_heading_level(paragraph) -> int | None:
    """0-based outline level of a paragraph, or None for body text.

    Direct formatting first, then the style and everything it is based on. Names are only a
    fallback for files whose built-in styles carry no outline level.
    """
    direct = _outline_from_ppr(paragraph._p.pPr)
    if direct is not None:
        return direct
    for st in _style_chain(paragraph.style):
        lvl = _outline_from_ppr(st.element.pPr)
        if lvl is not None:
            return lvl
        name = (st.name or "").strip().lower()
        if name == "title":
            return 0
        m = re.fullmatch(r"heading ([1-9])", name)
        if m:
            return int(m.group(1)) - 1
    return None


def docx_list_level(paragraph) -> int | None:
    direct = _numbered_ilvl(paragraph._p.pPr)
    if direct is not None:
        return direct
    for st in _style_chain(paragraph.style):
        lvl = _numbered_ilvl(st.element.pPr)
        if lvl is not None:
            # "List Bullet 2" / "List Number 3" indent with a separate list, not with ilvl.
            m = re.fullmatch(r"list (?:bullet|number|continue) ([2-9])", (st.name or "").strip().lower())
            return max(lvl, int(m.group(1)) - 1) if m else lvl
    return None


def _docx_table(tbl, parent) -> str:
    from docx.table import Table
    rows: list[list[str]] = []
    for row in Table(tbl, parent).rows:
        cells, prev = [], None
        for c in row.cells:
            if c._tc is prev:  # a horizontally merged cell repeats; keep it once
                continue
            prev = c._tc
            cells.append(c.text)
        rows.append(cells)
    return markdown_table(rows)


def docx_to_markdown(path: str, math: Callable = _omml_plain) -> str:
    from docx import Document
    from docx.text.paragraph import Paragraph

    doc = Document(path)
    blocks: list[tuple[str, str]] = []

    def walk(container, depth: int = 0) -> None:
        if depth > MAX_DEPTH:
            return
        for el in container.iterchildren():
            if el.tag == _W("p"):
                para = Paragraph(el, doc)
                text = _run_text(el, math).strip()
                if not text:
                    continue
                level = docx_heading_level(para)
                if level is not None and len(text) < 300:
                    blocks.append(("heading", "#" * min(level + 1, 6) + " " + text))
                    continue
                ilvl = docx_list_level(para)
                if ilvl is not None:
                    blocks.append(("list", "  " * ilvl + "- " + text))
                else:
                    blocks.append(("text", text))
            elif el.tag == _W("tbl"):
                blocks.append(("table", _docx_table(el, doc)))
            elif el.tag == _W("sdt"):  # content controls wrap ordinary paragraphs/tables
                content = el.find(_W("sdtContent"))
                if content is not None:
                    walk(content, depth + 1)

    walk(doc.element.body)
    return _join_blocks(blocks)


# ── .pptx ───────────────────────────────────────────────────────────────────

def _pptx_shapes(shapes, depth: int = 0):
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    if depth > MAX_DEPTH:
        return
    for sh in sorted(shapes, key=lambda s: ((s.top or 0), (s.left or 0))):
        if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from _pptx_shapes(sh.shapes, depth + 1)
        else:
            yield sh


def _is_title(sh) -> bool:
    from pptx.enum.shapes import PP_PLACEHOLDER
    if not getattr(sh, "is_placeholder", False):
        return False
    try:
        return sh.placeholder_format.type in (PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE)
    except Exception:
        return False


def _chart_markdown(chart) -> str:
    title = ""
    try:
        if chart.has_title and chart.chart_title.has_text_frame:
            title = chart.chart_title.text_frame.text.strip()
    except Exception:
        pass
    rows: list[list[str]] = []
    try:
        plot = chart.plots[0]
        cats = [str(c) for c in plot.categories]
        series = [s for p in chart.plots for s in p.series]
        rows.append([""] + [str(s.name or f"Series {i + 1}") for i, s in enumerate(series)])
        values = [list(s.values) for s in series]
        for r, cat in enumerate(cats):
            rows.append([cat] + [_num(v[r]) if r < len(v) else "" for v in values])
    except Exception:
        rows = []
    head = f"Chart: {title}" if title else "Chart"
    table = markdown_table(rows) if len(rows) > 1 else ""
    return head + ("\n" + table if table else "")


def _alt_text(sh) -> str:
    try:
        for el in sh._element.iter():
            if el.tag.endswith("}cNvPr"):
                return (el.get("descr") or el.get("title") or "").strip()
    except Exception:
        pass
    return ""


def pptx_to_markdown(path: str) -> str:
    from pptx import Presentation

    prs = Presentation(path)
    out: list[str] = []
    for i, slide in enumerate(prs.slides, 1):
        shapes = list(_pptx_shapes(slide.shapes))
        title_shape = next((s for s in shapes if _is_title(s) and s.has_text_frame
                            and s.text_frame.text.strip()), None)
        title = re.sub(r"\s+", " ", title_shape.text_frame.text).strip() if title_shape else ""
        blocks: list[tuple[str, str]] = [("heading", f"## {title or f'Slide {i}'}")]
        for sh in shapes:
            if sh is title_shape:
                continue
            if getattr(sh, "has_table", False) and sh.has_table:
                rows = [[c.text for c in row.cells] for row in sh.table.rows]
                blocks.append(("table", markdown_table(rows)))
            elif getattr(sh, "has_chart", False) and sh.has_chart:
                blocks.append(("table", _chart_markdown(sh.chart)))
            elif getattr(sh, "has_text_frame", False) and sh.has_text_frame:
                for p in sh.text_frame.paragraphs:
                    text = re.sub(r"\s+", " ", p.text.replace("\v", " ")).strip()
                    if not text:
                        continue
                    if p.level > 0:
                        blocks.append(("list", "  " * (p.level - 1) + "- " + text))
                    else:
                        blocks.append(("text", text))
            elif sh.shape_type is not None and "PICTURE" in str(sh.shape_type):
                alt = _alt_text(sh)
                if alt:
                    blocks.append(("text", f"[Image: {alt}]"))
        try:
            if slide.has_notes_slide:
                notes = slide.notes_slide.notes_text_frame.text.strip()
                if notes:
                    blocks.append(("text", "Speaker notes: " + re.sub(r"\s+", " ", notes)))
        except Exception:
            pass
        out.append(_join_blocks(blocks))
    return "\n\n".join(out)


# ── .xlsx ───────────────────────────────────────────────────────────────────

def _num(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        return f"{v:.10g}"
    return str(v)


def xlsx_display(value, number_format: str = "General") -> str:
    """A cell as Excel shows it, for the formats that change meaning: dates, times, percents."""
    if value is None:
        return ""
    if isinstance(value, _dt.datetime):
        if value.time() == _dt.time(0, 0):
            return value.date().isoformat()
        return value.isoformat(sep=" ", timespec="minutes")
    if isinstance(value, (_dt.date, _dt.time)):
        return value.isoformat()
    fmt = number_format or "General"
    if isinstance(value, (int, float)) and not isinstance(value, bool) and "%" in fmt:
        decimals = len(fmt.split(".")[1].split("%")[0]) if "." in fmt else 0
        return f"{value * 100:.{decimals}f}%"
    return _num(value)


def sheet_islands(grid: list[list[str]]) -> list[list[list[str]]]:
    """Blocks of rows separated by fully blank rows, each trimmed of blank outer columns."""
    islands: list[list[list[str]]] = []
    cur: list[list[str]] = []
    for row in grid + [[]]:
        if any(c.strip() for c in row):
            cur.append(row)
        elif cur:
            islands.append(cur)
            cur = []
    trimmed = []
    for isl in islands:
        width = max(len(r) for r in isl)
        rows = [r + [""] * (width - len(r)) for r in isl]
        used = [j for j in range(width) if any(r[j].strip() for r in rows)]
        lo, hi = min(used), max(used)
        trimmed.append([r[lo:hi + 1] for r in rows])
    return trimmed


def xlsx_to_markdown(path: str) -> str:
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out: list[str] = []
    try:
        for ws in wb.worksheets:
            if getattr(ws, "sheet_state", "visible") != "visible":
                continue
            grid: list[list[str]] = []
            truncated = False
            for r, row in enumerate(ws.iter_rows(max_col=MAX_SHEET_COLS)):
                if r >= MAX_SHEET_ROWS:
                    truncated = True
                    break
                grid.append([xlsx_display(c.value, getattr(c, "number_format", "General"))
                             for c in row])
            tables = [markdown_table(isl) for isl in sheet_islands(grid)]
            tables = [t for t in tables if t]
            if not tables:
                continue
            body = "\n\n".join(tables)
            if truncated:
                body += f"\n\n(First {MAX_SHEET_ROWS} rows of this sheet.)"
            out.append(f"## {ws.title}\n\n{body}")
    finally:
        wb.close()
    return "\n\n".join(out)
