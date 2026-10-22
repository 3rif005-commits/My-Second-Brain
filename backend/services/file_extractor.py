"""Multi-format file extractor.

Supported formats:
  .pdf            → PyMuPDF
  .txt .md .rst   → plain text decode
  .docx .pptx .xlsx → services.office_extract (headings, lists, tables in place,
                      slide titles/notes/charts, sheets as tables)
"""

import os


def extract_file(path: str, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".pdf":
        from services.pdf_extractor import extract_pdf
        return extract_pdf(path)

    if ext in {".txt", ".md", ".rst", ".csv"}:
        return _extract_text(path)

    if ext in {".docx", ".pptx", ".xlsx"}:
        from services.office_extract import office_to_markdown
        return office_to_markdown(path, ext)

    raise ValueError(f"Unsupported file type: {ext}")


def _extract_text(path: str) -> str:
    with open(path, "rb") as f:
        raw = f.read()
    for enc in ("utf-8", "utf-16", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("Could not decode text file — unknown encoding.")
