"""Databases -> IR. A database is an Obj(kind="database") carrying its first data
source's property definitions; a row is a note whose `props["db"]` holds typed values
(select values resolved from option ids to names, relations as note ids).

Values are IR values: {"type": <property type>, "value": <plain python>} so nothing here
or downstream depends on how the editor stores them.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from services.portable import ir
from services.portable.losses import Loss

#: property types with no representation in Notion's API (see FIDELITY_MATRIX §5)
UNSENDABLE = {"people": "people", "created_by": "created-by", "last_edited_by": "last-edited-by",
              "verification": "verification", "button": "button"}


@dataclass
class Bundle:
    database: dict
    sources: list[dict]                       # real data sources, in order
    props: dict[str, list[dict]]              # data_source_id -> property rows (by position)
    virtual: int = 0                          # "All notes" sources, which are views, not databases
    losses: list[Loss] = field(default_factory=list)


def load_database(db, user_id: str, database_id: str) -> Bundle | None:
    rows = (db.table("db_databases").select("*").eq("id", database_id).eq("user_id", user_id)
            .execute().data or [])
    if not rows or rows[0].get("deleted_at"):
        return None
    srcs = (db.table("db_data_sources").select("*").eq("database_id", database_id).eq("user_id", user_id)
            .order("position").execute().data or [])
    real = [s for s in srcs if not s.get("system_kind")]
    props: dict[str, list[dict]] = {}
    for s in real:
        props[s["id"]] = (db.table("db_properties").select("*").eq("data_source_id", s["id"])
                          .order("position").execute().data or [])
    b = Bundle(rows[0], real, props, virtual=len(srcs) - len(real))
    if len(real) > 1:
        b.losses.append(Loss("lossy", f"{len(real) - 1} more data source(s) in this database.",
                             "Only the first is sent.", "extra_data_sources"))
    if b.virtual:
        b.losses.append(Loss("approximated", "The built-in “All notes” source.",
                             "It is a view over every note, not data; it is not sent as a table.", "virtual_source"))
    if rows[0].get("is_locked"):
        b.losses.append(Loss("lossy", "The database lock.", "Notion's lock cannot be set through the API.", "db_locked"))
    return b


def _text(rich) -> str:
    if isinstance(rich, str):
        return rich
    return "".join(str(i.get("text", i.get("plain_text", ""))) if isinstance(i, dict) else str(i) for i in rich or [])


def prop_def(p: dict) -> dict:
    return {"key": p["key"], "name": p["name"], "type": p["type"], "config": p.get("config") or {},
            "result_type": p.get("result_type"), "storage": p.get("storage") or "jsonb",
            "column_name": p.get("column_name"), "description": p.get("description")}


def database_to_ir(b: Bundle) -> ir.Obj:
    d = b.database
    src = b.sources[0] if b.sources else None
    defs = [prop_def(p) for p in b.props.get(src["id"], [])] if src else []
    return ir.Obj(
        kind="database", ref=ir.Ref("database", str(d["id"])),
        parent=ir.Ref("note", str(d["parent_note_id"])) if d.get("parent_note_id") else None,
        title=[ir.Text((d.get("title") or "Untitled").strip() or "Untitled")], icon=d.get("icon") or None,
        cover=d.get("cover_url") or None,
        props={"description": _text(d.get("description")), "inline": bool(d.get("is_inline")),
               "data_source": {"id": str(src["id"]), "name": src.get("name") or "Default", "properties": defs} if src else None},
        losses=list(b.losses))


def _option_names(cfg: dict) -> dict[str, str]:
    return {o.get("id"): o.get("name") for o in cfg.get("options") or [] if isinstance(o, dict)}


def _unwrap(w, typ):
    return w.get(typ) if isinstance(w, dict) and w.get("type") in (typ, None) else None


def _choice(name_by_id: dict, v):
    return name_by_id.get(v, v) if isinstance(v, str) else v


def value_to_ir(p: dict, note_row: dict, row_props: dict, computed: dict, links: dict[str, list[str]]) -> dict | None:
    """-> {"type", "value"} for one property of one row, or None when it has no value."""
    t, key, cfg = p["type"], p["key"], p.get("config") or {}
    if p.get("storage") == "column" and p.get("column_name"):
        v = note_row.get(p["column_name"])
        if t == "multi_select":
            return {"type": t, "value": list(v or [])} if v else None
        return {"type": t, "value": v} if v not in (None, "", []) else None
    if t == "title":
        return None
    if t in ("formula", "rollup"):
        w = computed.get(key)
        if not isinstance(w, dict):
            return None
        rt = w.get("type")
        return {"type": t, "result": rt, "value": w.get(rt)} if rt else None
    if t == "relation":
        return {"type": t, "value": links.get(key, [])}
    if t in ("created_time", "last_edited_time"):
        v = note_row.get("created_at" if t == "created_time" else "updated_at")
        return {"type": t, "value": v} if v else None
    w = row_props.get(key)
    if not isinstance(w, dict):
        return None
    raw = w.get(w.get("type") or t)
    if raw in (None, "", []):
        return None
    if t == "select":
        return {"type": t, "value": _choice(_option_names(cfg), raw)}
    if t in ("multi_select",):
        names = _option_names(cfg)
        return {"type": t, "value": [_choice(names, x) for x in raw]}
    if t == "status":
        return {"type": t, "value": _choice(_option_names(cfg), raw)}
    return {"type": t, "value": raw}


def row_to_ir(note_obj: ir.Obj, b: Bundle, note_row: dict, rp: dict | None, links_by_key: dict[str, list[str]]) -> ir.Obj:
    """Adds `props["db"]` to a note's IR: the typed values of its database row."""
    src = b.sources[0]
    defs = b.props[src["id"]]
    row_props = (rp or {}).get("properties") or {}
    computed = (rp or {}).get("computed") or {}
    values, losses = {}, list(note_obj.losses)
    for p in defs:
        if p["type"] in UNSENDABLE:
            continue
        v = value_to_ir(p, note_row, row_props, computed, links_by_key)
        if v is not None:
            values[p["key"]] = v
    note_obj.props = {**note_obj.props, "db": {"database": str(b.database["id"]), "data_source": str(src["id"]),
                                               "values": values}}
    note_obj.losses = losses
    return note_obj


def relation_values(db, user_id: str, defs: list[dict], note_id: str) -> dict[str, list[str]]:
    """Relation values of one row by property key. The forward side of a pair reads `to_row`,
    the reverse side reads `from_row` (one link row serves both, migration 015)."""
    out: dict[str, list[str]] = {}
    for p in defs:
        cfg = p.get("config") or {}
        if p["type"] != "relation" or not cfg.get("relation_id"):
            continue
        own, other = ("to_row_id", "from_row_id") if cfg.get("side") == "reverse" else ("from_row_id", "to_row_id")
        rows = (db.table("db_relation_links").select(f"{other}, position").eq("relation_id", cfg["relation_id"])
                .eq("user_id", user_id).eq(own, note_id).execute().data or [])
        out[p["key"]] = [str(r[other]) for r in sorted(rows, key=lambda r: r.get("position") or 0)]
    return out


def relation_targets(defs: list[dict]) -> list[str]:
    """Data sources this one has relations to."""
    return sorted({(p.get("config") or {}).get("target_data_source_id") for p in defs
                   if p["type"] == "relation" and (p.get("config") or {}).get("target_data_source_id")})


def database_of_source(db, ds_id: str) -> str | None:
    rows = db.table("db_data_sources").select("database_id, system_kind").eq("id", ds_id).execute().data or []
    return str(rows[0]["database_id"]) if rows and not rows[0].get("system_kind") else None
