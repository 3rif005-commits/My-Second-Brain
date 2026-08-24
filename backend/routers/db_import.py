"""CSV import (Milestone 14, Task 47): `POST /db/import/csv` — the "Import → CSV" flow
research §7.1 documents ("CSV imports create a new Notion database (rows → items/pages,
columns → properties)"). Always creates a BRAND NEW database from the uploaded file.

Scope decision (recorded in task-47-report.md, made by the controller — not relitigated
here): Notion has two distinct CSV flows. This endpoint implements only "Import → CSV"
(new database). "••• → Merge with CSV" onto an EXISTING database's existing properties
(exact header-name matching, adds rows only, no new properties) is explicitly OUT OF
SCOPE — a disclosed gap for a future task, not a bug. Research itself leaves the mapping
UX for that second flow `UNRESOLVED` (research line ~5947/6212), so this keeps scope to
what's actually inferable from a plain CSV with no prior schema to map onto.

Kept as its own router (rather than added to the already-3000-line `routers/databases.py`)
per task-47-brief.md's own "or a new routers/db_import.py if you prefer" — registered in
`main.py` next to the existing `databases` router include. Reuses `create_database`,
`create_property`, `update_property` (routers/databases.py) and `create_row_core`
(services/db/rows.py) *directly*, exactly as the brief specifies, rather than
reimplementing any of their transactional logic here.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from models.database import DatabaseCreate, PropertyCreate, PropertyUpdate
from routers.databases import create_database, create_property, update_property
from routers.notes import get_user_id
from services.db.connection import get_conn
from services.db.keys import mint_key
from services.db.properties.choice import SelectConfig, SelectOption
from services.db.rows import create_row_core

router = APIRouter(prefix="/db/import", tags=["db-import"])


# ---------------------------------------------------------------------------
# Per-column type inference
# ---------------------------------------------------------------------------
#
# Deliberately narrow set (task-47-brief.md): none of relation/formula/rollup/button/
# people/files/created_time/created_by/last_edited_time/last_edited_by/unique_id/place/
# verification are attempted — none has a plain-text CSV representation this app can
# construct unambiguously, and research confirms CSV import can't create new
# relations/formulas/rollups anyway. `multi_select` and `status` are also deliberately
# NOT auto-inferred (disclosed gaps, see module-level report) — a status-shaped column
# degrades to `select`, which is a reasonable approximation, not silently wrong.
#
# Priority order below matters: checkbox's token set is a subset of what would also
# satisfy "few distinct values", so it must be checked before select, and a
# numeric-looking column must be checked before select for the same reason.

# Judgment call (documented in task-47-report.md): this exact token set, case-insensitive.
_TRUE_TOKENS = {"true", "1", "yes"}
_FALSE_TOKENS = {"false", "0", "no"}
_CHECKBOX_TOKENS = _TRUE_TOKENS | _FALSE_TOKENS

# Judgment call: select's distinct-value cutoff. The brief's own example number (20),
# adopted as-is — generous enough for real tag-like columns (priority, category, status)
# while still meaningfully narrower than "every row has a different value", which is the
# rich_text case this cutoff exists to distinguish from a select-shaped column.
SELECT_MAX_DISTINCT = 20

_URL_RE = re.compile(r"^https?://", re.IGNORECASE)


def _is_empty_cell(value: str | None) -> bool:
    return value is None or value.strip() == ""


def _looks_like_email(value: str) -> bool:
    # "a simple @-containing check" (brief) -- deliberately not a heavy validation
    # library or a strict RFC regex: worst case a real email is inferred as rich_text
    # instead, never a hard failure.
    if value.count("@") != 1:
        return False
    local, _, domain = value.partition("@")
    return bool(local) and bool(domain)


def _parse_number(value: str) -> int | float | None:
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return None


def _ordered_unique(values: list[str]) -> list[str]:
    seen: dict[str, None] = {}
    for v in values:
        seen.setdefault(v, None)
    return list(seen.keys())


@dataclass
class ColumnInference:
    """Internal result of inferring one non-title column -- `config` is the exact dict
    passed to `PropertyCreate.config`; `value_to_option_id` is populated only for
    `select` (maps a raw, stripped cell value to the `SelectOption.id` minted for it),
    reused when building each row's wrapper so the option id is only ever minted once
    per distinct value. A plain dataclass (not a pydantic BaseModel, unlike the two
    response models below) -- purely internal, positional-construction is convenient
    at each of `infer_column`'s five return sites, and pydantic v2 BaseModels reject
    positional args by default."""

    inferred_type: str
    config: dict[str, Any]
    value_to_option_id: dict[str, str] | None
    non_empty_count: int
    empty_count: int


def infer_column(raw_values: list[str | None]) -> ColumnInference:
    nonempty = [v.strip() for v in raw_values if not _is_empty_cell(v)]
    empty_count = len(raw_values) - len(nonempty)

    if not nonempty:
        # "A column of all-empty cells falls back to rich_text" (brief) -- checked
        # first and explicitly, since every all()-based check below is vacuously
        # True over an empty list and would otherwise misclassify this as checkbox.
        return ColumnInference("rich_text", {}, None, 0, empty_count)

    if all(v.lower() in _CHECKBOX_TOKENS for v in nonempty):
        return ColumnInference("checkbox", {}, None, len(nonempty), empty_count)

    if all(_parse_number(v) is not None for v in nonempty):
        return ColumnInference("number", {}, None, len(nonempty), empty_count)

    if all(_is_iso_date(v) for v in nonempty):
        return ColumnInference("date", {}, None, len(nonempty), empty_count)

    if all(_URL_RE.match(v) for v in nonempty):
        return ColumnInference("url", {}, None, len(nonempty), empty_count)

    if all(_looks_like_email(v) for v in nonempty):
        return ColumnInference("email", {}, None, len(nonempty), empty_count)

    distinct = _ordered_unique(nonempty)
    # Judgment call (documented in task-47-report.md), beyond the brief's literal
    # "<= 20 distinct values" wording: also require at least one REPEATED value
    # (len(distinct) < len(nonempty)) before inferring select. Without this, any
    # small CSV (or any column where every cell just happens to be unique, e.g. free-
    # form notes) would trivially satisfy "<= 20 distinct" and always win over
    # rich_text -- which directly contradicts the brief's own worked example ("42"
    # and "hello" in the same column "falls back to rich_text": 2 values, 2 distinct,
    # <= 20, but plainly not select-shaped). Requiring a repeat is what actually
    # distinguishes "categorical, like a tag" from "prose that happens to be short" --
    # the same intuition a person applies when eyeballing a spreadsheet column.
    has_repeat = len(distinct) < len(nonempty)
    if has_repeat and len(distinct) <= SELECT_MAX_DISTINCT:
        options = [SelectOption(id=mint_key(), name=v, color="default") for v in distinct]
        config = SelectConfig(options=options).model_dump(mode="json")
        value_to_option_id = {opt.name: opt.id for opt in options}
        return ColumnInference("select", config, value_to_option_id, len(nonempty), empty_count)

    return ColumnInference("rich_text", {}, None, len(nonempty), empty_count)


def _is_iso_date(value: str) -> bool:
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True


def _wrap_value(prop_type: str, cell: str, value_to_option_id: dict[str, str] | None) -> dict[str, Any]:
    """Builds the spec §3.3 write wrapper for one non-empty cell, matching this
    codebase's existing convention exactly (`{"type": <key>, <key>: <value>}`,
    verified against `tests/test_databases_router.py`/`test_databases_query_endpoint.py`
    call sites rather than invented from scratch)."""
    if prop_type == "checkbox":
        return {"type": "checkbox", "checkbox": cell.lower() in _TRUE_TOKENS}
    if prop_type == "number":
        return {"type": "number", "number": _parse_number(cell)}
    if prop_type == "date":
        return {"type": "date", "date": {"start": cell, "end": None, "time_zone": None}}
    if prop_type == "url":
        return {"type": "url", "url": cell}
    if prop_type == "email":
        return {"type": "email", "email": cell}
    if prop_type == "select":
        assert value_to_option_id is not None
        return {"type": "select", "select": value_to_option_id[cell]}
    if prop_type == "title":
        return {"type": "title", "title": cell}
    return {"type": "rich_text", "rich_text": cell}


def _is_title_header(header: str, working_title: str) -> bool:
    h = header.strip().lower()
    return h in ("title", "name") or h == working_title.strip().lower()


# ---------------------------------------------------------------------------
# Response shape
# ---------------------------------------------------------------------------


class ColumnImportReport(BaseModel):
    header: str
    inferred_type: str
    non_empty_count: int
    empty_count: int


class CsvImportResponse(BaseModel):
    database_id: str
    row_count: int
    columns: list[ColumnImportReport]


@router.post("/csv", response_model=CsvImportResponse, status_code=status.HTTP_201_CREATED)
async def import_csv(
    file: UploadFile = File(...),
    database_title: str | None = Form(None),
    user_id: str = Depends(get_user_id),
    conn: asyncpg.Connection = Depends(get_conn),
) -> CsvImportResponse:
    """Parses the uploaded CSV, infers one property type per column, and writes a brand
    new database + properties + rows in a single request. No confirm-before-commit step
    (that would be the out-of-scope "merge/mapping" UX) -- import is a single POST/
    response round trip, and the response IS the "here's what I did" summary the
    frontend renders back to the user.

    Judgment call (documented in task-47-report.md): the whole import (database +
    properties + every row) is wrapped in one outer transaction for atomicity, even
    though the brief says a partial/partially-applied import would be acceptable to
    leave behind. `create_database`/`create_property`/`update_property`/
    `create_row_core` each already open their own `conn.transaction()` block internally
    -- asyncpg nests these as SAVEPOINTs when already inside a transaction, so wrapping
    this whole handler is safe and free, and matches this codebase's own standing
    preference (every other multi-step write in this router is transactional) over
    leaving a half-imported database behind on, e.g., a single malformed row.
    """
    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        # Research §7.1's own documented failure mode ("garbled characters: re-export
        # as UTF-8") -- a clear 400, never a silently-swallowed guess at another
        # encoding, and never a 500.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "CSV file is not valid UTF-8 -- re-export the file as UTF-8 and try again.",
        ) from exc

    title = (database_title or "").strip()
    if not title:
        title = Path(file.filename).stem if file.filename else "Untitled"

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = list(reader.fieldnames or [])
    if not fieldnames:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV file has no header row.")
    csv_rows = list(reader)

    title_idx = next(
        (i for i, h in enumerate(fieldnames) if _is_title_header(h, title)), 0
    )

    async with conn.transaction():
        created = await create_database(DatabaseCreate(title=title), user_id=user_id, conn=conn)
        data_source_id = created.data_source.id
        title_property = created.properties[0]

        header_to_key: dict[str, str] = {}
        header_to_type: dict[str, str] = {}
        header_to_value_map: dict[str, dict[str, str]] = {}
        column_reports: list[ColumnImportReport] = []

        for i, header in enumerate(fieldnames):
            values = [row.get(header) for row in csv_rows]
            if i == title_idx:
                # Reuse the auto-created title property (step 1 of create_database) --
                # never create a second title-type property; the compiler/UI assume
                # exactly one.
                await update_property(
                    title_property.id, PropertyUpdate(name=header), user_id=user_id, conn=conn
                )
                header_to_key[header] = title_property.key
                header_to_type[header] = "title"
                nonempty = sum(1 for v in values if not _is_empty_cell(v))
                column_reports.append(
                    ColumnImportReport(
                        header=header, inferred_type="title",
                        non_empty_count=nonempty, empty_count=len(values) - nonempty,
                    )
                )
                continue

            inference = infer_column(values)
            prop = await create_property(
                data_source_id,
                PropertyCreate(name=header, type=inference.inferred_type, config=inference.config),
                user_id=user_id,
                conn=conn,
            )
            header_to_key[header] = prop.key
            header_to_type[header] = inference.inferred_type
            if inference.value_to_option_id:
                header_to_value_map[header] = inference.value_to_option_id
            column_reports.append(
                ColumnImportReport(
                    header=header, inferred_type=inference.inferred_type,
                    non_empty_count=inference.non_empty_count, empty_count=inference.empty_count,
                )
            )

        row_count = 0
        for row in csv_rows:
            properties: dict[str, Any] = {}
            for header in fieldnames:
                cell = row.get(header)
                if _is_empty_cell(cell):
                    # Spec §3.3: "Absent key ≡ empty" -- never a bare scalar. Empty
                    # cells never veto a type; they just contribute no wrapper.
                    continue
                assert cell is not None
                key = header_to_key[header]
                ptype = header_to_type[header]
                properties[key] = _wrap_value(ptype, cell.strip(), header_to_value_map.get(header))
            # A bulk import firing N page_added automations once per imported row is
            # very likely not what a user importing hundreds of rows wants -- a
            # deliberate choice, distinct from the ordinary "+ New row" button, which
            # keeps trigger_automations=True (create_row_core's existing default).
            await create_row_core(
                conn, user_id, data_source_id, properties=properties, trigger_automations=False
            )
            row_count += 1

    return CsvImportResponse(database_id=created.database.id, row_count=row_count, columns=column_reports)
