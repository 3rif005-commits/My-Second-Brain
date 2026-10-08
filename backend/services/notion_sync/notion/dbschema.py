"""Database property definitions and row values -> Notion payloads (pure, no I/O).

One module because schema and values share the naming rules (Notion property names are
unique per data source; ours need not be). Formulas and rollups are pushed live AND as a
"<name> (SB value)" snapshot (decision D3), so the mirror holds our computed value even
where Notion computes differently or refuses the expression.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from services.portable.losses import Loss

from .properties import SB_ID_PROP
from .richtext import plain_rich

NOTION_COLORS = {"default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"}
NUMBER_FORMATS = {
    "number", "number_with_commas", "percent", "dollar", "canadian_dollar", "singapore_dollar", "euro", "pound",
    "yen", "ruble", "rupee", "won", "yuan", "real", "lira", "rupiah", "franc", "hong_kong_dollar",
    "new_zealand_dollar", "krona", "norwegian_krone", "mexican_peso", "rand", "new_taiwan_dollar",
    "danish_krone", "zloty", "baht", "forint", "koruna", "shekel", "chilean_peso", "philippine_peso", "dirham",
    "colombian_peso", "riyal", "ringgit", "leu", "argentine_peso", "uruguayan_peso", "peruvian_sol"}
SCALAR = {"rich_text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email",
          "phone_number", "place"}
SKIP = {"people", "created_by", "last_edited_by", "verification", "button", "files"}
SKIP_WORDS = {"people": "People", "created_by": "Created by", "last_edited_by": "Last edited by",
              "verification": "Verification", "button": "Button", "files": "Files"}
SNAPSHOT_SUFFIX = " (SB value)"
ID_SUFFIX = " (Second Brain)"
MAX_NAME = 100


@dataclass
class Layout:
    """Everything the engine needs to create/maintain one data source."""
    names: dict[str, str]                        # our key -> Notion property name
    title_key: str | None
    initial: dict[str, dict]                     # name -> schema, created with the data source
    relations: list[dict] = field(default_factory=list)   # {"key","name","relation_id","side","target"}
    rollups: list[dict] = field(default_factory=list)     # {"key","name","relation_key","target_key","target_ds","function"}
    formulas: list[dict] = field(default_factory=list)    # {"key","name","expression"}
    snapshots: dict[str, str] = field(default_factory=dict)  # key -> snapshot property name
    status_groups: dict[str, dict[str, str]] = field(default_factory=dict)  # key -> {option name: group}
    skipped: list[str] = field(default_factory=list)
    losses: list[Loss] = field(default_factory=list)


def _clean_option(name: str) -> str:
    return str(name).replace(",", ";").strip()[:100] or "(empty)"


def unique_names(defs: list[dict]) -> dict[str, str]:
    """Notion needs unique property names (case-insensitively) and ours may repeat; also keep
    clear of the names we add ourselves."""
    taken = {SB_ID_PROP.lower()}
    out: dict[str, str] = {}
    for d in defs:
        base = (d["name"] or "Property").strip()[:MAX_NAME - 14] or "Property"
        name, n = base, 1
        while name.lower() in taken or name.lower() + SNAPSHOT_SUFFIX.lower() in taken:
            n += 1
            name = f"{base} ({n})"
        taken.add(name.lower())
        out[d["key"]] = name
    return out


def _options(cfg: dict, status: bool = False) -> tuple[list[dict], dict[str, str], list[Loss]]:
    opts, seen, groups, losses = [], set(), {}, []
    for o in cfg.get("options") or []:
        name = _clean_option(o.get("name", ""))
        if name.lower() in seen:
            losses.append(Loss("approximated", f"Two options both called “{name}”.", "The second is renamed.", "option_renamed"))
            name = f"{name} (2)"
        seen.add(name.lower())
        color = o.get("color") if o.get("color") in NOTION_COLORS else "default"
        opts.append({"name": name, "color": color})
        if status:
            groups[name] = o.get("group") or "To-do"
    if len(opts) > 100:
        losses.append(Loss("lossy", "More than 100 options.", "Only the first 100 exist in Notion.", "options_capped"))
        opts = opts[:100]
    return opts, groups, losses


def layout(defs: list[dict]) -> Layout:
    names = unique_names(defs)
    L = Layout(names, None, {})
    for d in defs:
        k, t, cfg, name = d["key"], d["type"], d.get("config") or {}, names[d["key"]]
        if t == "title":
            if L.title_key is None:
                L.title_key = k
                L.initial[name] = {"title": {}}
            continue
        if t in SKIP:
            L.skipped.append(name)
            L.losses.append(Loss("lossy", f"The {SKIP_WORDS[t].lower()} property “{name}”.",
                                 "It is not created in Notion." + (" Files in properties come in a later update." if t == "files" else ""),
                                 f"property_{t}_skipped"))
            continue
        if t == "rich_text":
            L.initial[name] = {"rich_text": {}}
        elif t == "number":
            fmt = cfg.get("format", "number")
            if fmt not in NUMBER_FORMATS:
                L.losses.append(Loss("approximated", f"The number format “{fmt}” of “{name}”.", "Shown as a plain number.", "number_format"))
                fmt = "number"
            L.initial[name] = {"number": {"format": fmt}}
        elif t in ("select", "multi_select"):
            opts, _, ls = _options(cfg)
            L.losses += ls
            L.initial[name] = {t: {"options": opts}}
        elif t == "status":
            opts, groups, ls = _options(cfg, status=True)
            L.losses += ls
            L.initial[name] = {"status": {"options": opts}}
            L.status_groups[k] = groups
        elif t in ("date", "checkbox", "url", "email", "phone_number", "place"):
            L.initial[name] = {t: {}}
        elif t in ("created_time", "last_edited_time"):
            L.initial[name] = {"date": {}}
            L.losses.append(Loss("approximated", f"The “{name}” timestamp.",
                                 "Notion's own time is the moment of sending, so your real value is a date column.", "timestamp_as_date"))
        elif t == "unique_id":
            prefix = cfg.get("prefix") or None
            L.initial[name] = {"unique_id": {**({"prefix": prefix} if prefix else {})}}
            L.initial[name + ID_SUFFIX] = {"rich_text": {}}
            L.snapshots[k] = name + ID_SUFFIX
        elif t == "relation":
            L.relations.append({"key": k, "name": name, "relation_id": cfg.get("relation_id"), "side": cfg.get("side"),
                                "target": cfg.get("target_data_source_id")})
        elif t == "rollup":
            L.rollups.append({"key": k, "name": name, "relation_key": cfg.get("relation_key"),
                              "target_key": cfg.get("target_key"), "target_ds": cfg.get("target_data_source_id"),
                              "function": cfg.get("function") or "count"})
            _snapshot(L, d, name)
        elif t == "formula":
            L.formulas.append({"key": k, "name": name, "expression": cfg.get("expression") or ""})
            _snapshot(L, d, name)
        else:
            L.losses.append(Loss("approximated", f"The property type “{t}” of “{name}”.", "Its text is sent as a text column.", "property_unknown"))
            L.initial[name] = {"rich_text": {}}
    L.initial[SB_ID_PROP] = {"rich_text": {}}
    return L


def _snapshot(L: Layout, d: dict, name: str) -> None:
    rt = d.get("result_type")
    sname = name + SNAPSHOT_SUFFIX
    L.snapshots[d["key"]] = sname
    L.initial[sname] = ({"number": {}} if rt == "number" else {"checkbox": {}} if rt in ("boolean", "checkbox")
                        else {"date": {}} if rt == "date" else {"rich_text": {}})


def rewrite_expression(expr: str, names: dict[str, str], defs: list[dict]) -> str:
    """Our formulas reference properties as prop("Name"); point them at the Notion names."""
    ours = {d["name"]: names[d["key"]] for d in defs if d["name"] != names.get(d["key"])}
    if not ours:
        return expr
    return re.sub(r'prop\(\s*"((?:[^"\\]|\\.)*)"\s*\)',
                  lambda m: f'prop("{ours.get(m.group(1), m.group(1))}")', expr)


# ---- row values -------------------------------------------------------------------------------

def _date(v: dict | str | None) -> dict | None:
    if not v:
        return None
    if isinstance(v, str):
        return {"start": v}
    start, end, tz = v.get("start"), v.get("end"), v.get("time_zone")
    if not start:
        return None
    if tz:
        try:
            z = ZoneInfo(tz)

            def local(s):
                dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
                return dt.astimezone(z).replace(tzinfo=None).isoformat(timespec="seconds") if dt.tzinfo else dt.isoformat()
            return {"start": local(start), "end": local(end) if end else None, "time_zone": tz}
        except Exception:
            pass
    return {"start": start, **({"end": end} if end else {})}


def _text(s) -> list[dict]:
    return plain_rich(str(s)) if s not in (None, "") else []


def _display(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (list, tuple)):
        return ", ".join(_display(x) for x in v)
    if isinstance(v, dict):
        return " → ".join(str(x) for x in (v.get("start"), v.get("end")) if x)
    return str(v)


def row_values(L: Layout, defs: list[dict], values: dict, page_of, losses: list[Loss]) -> dict:
    """Notion property values for one row. EVERY property is written (an empty one is an
    explicit clear), so removing a value here removes it in Notion on the next send.
    `page_of(note_id)` -> Notion page id | None."""
    out: dict = {}
    for d in defs:
        k, t, name = d["key"], d["type"], L.names[d["key"]]
        if t == "title" or t in SKIP:
            continue
        v = (values.get(k) or {}).get("value")
        if t in ("formula", "rollup"):
            snap = L.snapshots[k]
            rt = d.get("result_type")
            if rt == "number":
                out[snap] = {"number": v if isinstance(v, (int, float)) and not isinstance(v, bool) else None}
            elif rt in ("boolean", "checkbox"):
                out[snap] = {"checkbox": bool(v)}
            elif rt == "date":
                out[snap] = {"date": _date(v)}
            else:
                out[snap] = {"rich_text": _text(_display(v))}
            continue
        if t == "rich_text":
            out[name] = {"rich_text": _text(v)}
        elif t == "number":
            out[name] = {"number": v if isinstance(v, (int, float)) and not isinstance(v, bool) else None}
        elif t == "select":
            out[name] = {"select": {"name": _clean_option(v)} if v else None}
        elif t == "multi_select":
            out[name] = {"multi_select": [{"name": _clean_option(x)} for x in (v or [])][:100]}
        elif t == "status":
            out[name] = {"status": {"name": _clean_option(v)} if v else None}
        elif t == "date":
            out[name] = {"date": _date(v)}
        elif t in ("created_time", "last_edited_time"):
            out[name] = {"date": _date(v)}
        elif t == "checkbox":
            out[name] = {"checkbox": bool(v)}
        elif t == "url":
            ok = isinstance(v, str) and len(v) <= 2000
            out[name] = {"url": v if ok else None}
            if v and not ok:
                losses.append(Loss("lossy", f"A link in “{name}” that is too long.", "The cell is left empty.", "url_too_long"))
        elif t == "email":
            out[name] = {"email": v if isinstance(v, str) and len(v) <= 200 else None}
        elif t == "phone_number":
            out[name] = {"phone_number": v if isinstance(v, str) and len(v) <= 200 else None}
        elif t == "place":
            ok = isinstance(v, dict) and "lat" in v and "lon" in v
            out[name] = {"place": {k2: v[k2] for k2 in ("lat", "lon", "name", "address") if v.get(k2) is not None} if ok else None}
            if v and not ok:
                losses.append(Loss("approximated", f"A place in “{name}” without coordinates.", "The cell is left empty.", "place_no_coords"))
        elif t == "unique_id":
            out[L.snapshots[k]] = {"rich_text": _text(_display(v))}
        elif t == "relation":
            ids, missing = [], 0
            for tid in v or []:
                pid = page_of(tid)
                if pid:
                    ids.append({"id": pid})
                else:
                    missing += 1
            if missing:
                losses.append(Loss("approximated", f"{missing} link(s) in “{name}” to rows that are not in Notion yet.",
                                   "They are added when those rows are sent.", "relation_target_unmirrored"))
            if len(ids) > 100:
                losses.append(Loss("lossy", f"More than 100 links in “{name}”.", "Only the first 100 are sent.", "relation_capped"))
            out[name] = {"relation": ids[:100]}
        else:
            out[name] = {"rich_text": _text(_display(v))}
    return out
