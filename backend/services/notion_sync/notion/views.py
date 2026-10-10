"""Our view definitions -> Notion Views API payloads (pure).

Our `config` already follows Notion's field names for most settings; what differs is how a
property is referenced (our short `key` vs Notion's property id), so this module is mostly
that translation plus honest losses where Notion has no equivalent (form questions, calculations,
"open pages in", conditional colours, map).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from services.portable.losses import Loss

#: our property type -> the key Notion uses for it inside a filter / group_by / axis
FILTER_KEY = {"title": "title", "rich_text": "rich_text", "number": "number", "select": "select",
              "multi_select": "multi_select", "status": "status", "date": "date", "checkbox": "checkbox",
              "url": "url", "email": "email", "phone_number": "phone_number", "relation": "relation",
              "created_time": "date", "last_edited_time": "date"}
GROUP_TYPES = {"select", "multi_select", "status", "checkbox", "date", "title", "rich_text", "number", "url",
               "email", "phone_number", "relation"}
NO_VALUE_OPS = {"is_empty", "is_not_empty"}
DATE_RELATIVE = {"this_week", "past_week", "past_month", "past_year", "next_week", "next_month", "next_year"}
SIZES = {"small", "medium", "large"}
ZOOM = {"hours", "day", "week", "bi_week", "month", "quarter", "year", "5_years"}
CHARTS = {"column", "bar", "line", "donut", "number"}
AGG = {"count", "count_values", "count_unique", "count_empty", "count_not_empty", "percent_empty",
       "percent_not_empty", "sum", "average", "median", "min", "max", "range", "earliest_date", "latest_date",
       "date_range", "checked", "unchecked", "percent_checked", "percent_unchecked", "count_per_group",
       "percent_per_group"}


@dataclass
class ViewCtx:
    ids: dict[str, str]                 # our property key -> Notion property id
    types: dict[str, str]               # our property key -> our type
    options: dict[str, dict[str, str]]  # key -> {option id: option name}
    page_of: object = None              # note id -> Notion page id | None


@dataclass
class Built:
    payload: dict | None
    losses: list[Loss] = field(default_factory=list)
    widgets: list[str] = field(default_factory=list)       # for a dashboard: our view ids


def _opt(ctx: ViewCtx, key: str, v):
    return ctx.options.get(key, {}).get(v, v)


def _cond(c: dict, ctx: ViewCtx, losses: list[Loss]) -> dict | None:
    key, op, val = c.get("property"), c.get("operator"), c.get("value")
    t = ctx.types.get(key)
    if not t or key not in ctx.ids:
        losses.append(Loss("lossy", "A filter on a property that is not in Notion.", "That condition is left out.", "filter_dropped"))
        return None
    nk = FILTER_KEY.get(t)
    if not nk:
        losses.append(Loss("lossy", f"A filter on a {t} property.", "Notion's filter cannot express it; it is left out.", "filter_dropped"))
        return None
    if op in NO_VALUE_OPS:
        cond: dict = {op: True}
    elif op in DATE_RELATIVE:
        cond = {op: {}}
    else:
        if t in ("select", "status", "multi_select"):
            val = _opt(ctx, key, val) if not isinstance(val, list) else [_opt(ctx, key, x) for x in val]
            if isinstance(val, list):
                val = val[0] if val else None
        if t == "relation":
            val = ctx.page_of(val) if ctx.page_of else None
            if not val:
                losses.append(Loss("lossy", "A relation filter on a row that is not in Notion.", "That condition is left out.", "filter_dropped"))
                return None
        cond = {op: val}
    return {"property": ctx.ids[key], nk: cond}


def _node(n, ctx: ViewCtx, losses: list[Loss], depth: int = 0) -> dict | None:
    if not isinstance(n, dict):
        return None
    if n.get("type") == "group":
        kids = [x for x in (_node(c, ctx, losses, depth + 1) for c in n.get("children") or []) if x]
        if not kids:
            return None
        if depth >= 2:
            losses.append(Loss("approximated", "Filter groups nested more than two deep.", "The deepest groups are flattened.", "filter_flattened"))
            return kids[0] if len(kids) == 1 else {n.get("op", "and"): kids}
        return kids[0] if len(kids) == 1 else {n.get("op", "and"): kids}
    return _cond(n, ctx, losses)


def filter_of(view: dict, ctx: ViewCtx, losses: list[Loss]) -> dict | None:
    return _node(view.get("filter"), ctx, losses) if view.get("filter") else None


def sorts_of(view: dict, ctx: ViewCtx, losses: list[Loss]) -> list[dict]:
    out = []
    for s in view.get("sorts") or []:
        k = s.get("property")
        if k in ctx.ids:
            out.append({"property": ctx.ids[k], "direction": "descending" if s.get("direction") in ("desc", "descending") else "ascending"})
        else:
            losses.append(Loss("lossy", "A sort on a property that is not in Notion.", "That sort is left out.", "sort_dropped"))
    return out


def _props(cfg: dict, ctx: ViewCtx, widths: bool) -> list[dict] | None:
    order = [k for k in cfg.get("property_order") or [] if k in ctx.ids]
    hidden = set(cfg.get("hidden_properties") or [])
    w = cfg.get("column_widths") or {}
    if not (order or hidden or w):
        return None
    keys = order + [k for k in list(ctx.ids) if k not in order]
    out = []
    for k in keys:
        if ctx.types.get(k) == "title":
            e = {"property_id": ctx.ids[k], "visible": True}
        else:
            e = {"property_id": ctx.ids[k], "visible": k not in hidden}
        if widths and isinstance(w.get(k), (int, float)) and w[k] >= 0:
            e["width"] = int(w[k])
        out.append(e)
    return out


def _group(g: dict | None, ctx: ViewCtx, losses: list[Loss], required: bool = False) -> dict | None:
    if not g or not g.get("property_key") or g["property_key"] not in ctx.ids:
        return None
    k = g["property_key"]
    t = ctx.types.get(k)
    if t not in GROUP_TYPES:
        losses.append(Loss("lossy", f"Grouping by a {t} property.", "Notion cannot group by it; the view is not grouped.", "group_dropped"))
        return None
    order = g.get("group_order")
    out: dict = {"type": FILTER_KEY.get(t, t), "property_id": ctx.ids[k],
                 "sort": {"type": order if order in ("manual", "ascending", "descending") else "manual"}}
    if g.get("hide_empty_groups") is not None:
        out["hide_empty_groups"] = bool(g["hide_empty_groups"])
    if t == "status":
        out["group_by"] = "option" if g.get("mode") == "option" else "group"
    elif t in ("date", "created_time", "last_edited_time"):
        out["type"] = "date"
        out["group_by"] = g.get("by") if g.get("by") in ("relative", "day", "week", "month", "year") else "month"
    elif t in ("title", "rich_text", "url", "email", "phone_number"):
        out["type"] = {"rich_text": "text"}.get(t, t)
        out["group_by"] = "exact"
    return out


def build(view: dict, ctx: ViewCtx) -> Built:
    losses: list[Loss] = []
    t = view.get("type")
    cfg = dict(view.get("config") or {})
    name = (view.get("name") or "View")[:200]
    payload: dict = {"name": name}
    conf: dict = {}
    if t == "feed":
        losses.append(Loss("approximated", f"The feed view “{name}”.", "Notion cannot create feed views; it is a list view.", "view_feed"))
        t = "list"
    if t == "map":
        losses.append(Loss("lossy", f"The map view “{name}”.", "Notion needs a place property to map; it is sent as a table.", "view_map"))
        t = "table"
    for ui in ("open_pages_in", "calculations", "show_page_icon", "load_limit"):
        if cfg.get(ui):
            losses.append(Loss("lossy", f"“{ui.replace('_', ' ')}” of the view “{name}”.", "It is a Notion screen setting the API cannot set.", "view_ui_only"))
            break
    if t in ("table", "board", "list", "gallery"):
        props = _props(cfg, ctx, widths=t == "table")
        if props:
            conf["properties"] = props
    if t == "table":
        conf["type"] = "table"
        g = _group(cfg.get("group_by"), ctx, losses)
        if g:
            conf["group_by"] = g
        for src, dst in (("show_vertical_lines", "show_vertical_lines"), ("wrap_cells", "wrap_cells"),
                         ("frozen_column_index", "frozen_column_index")):
            if cfg.get(src) is not None:
                conf[dst] = cfg[src]
    elif t == "board":
        conf["type"] = "board"
        g = _group(cfg.get("group_by"), ctx, losses, required=True)
        if not g:
            losses.append(Loss("approximated", f"The board “{name}” has nothing to group by in Notion.", "It is sent as a table.", "view_board_ungrouped"))
            t, conf = "table", {k: v for k, v in conf.items() if k == "properties"} | {"type": "table"}
        else:
            conf["group_by"] = g
            sg = _group(cfg.get("sub_group_by"), ctx, losses)
            if sg:
                conf["sub_group_by"] = sg
            if cfg.get("cover_size") in SIZES:
                conf["cover_size"] = cfg["cover_size"]
    elif t == "list":
        conf["type"] = "list"
    elif t == "gallery":
        conf["type"] = "gallery"
        if cfg.get("cover_size") in SIZES:
            conf["cover_size"] = cfg["cover_size"]
        if cfg.get("card_preview") == "none":
            losses.append(Loss("lossy", f"“No preview” cards of the gallery “{name}”.", "Notion shows its default cover.", "view_ui_only"))
    elif t in ("calendar", "timeline"):
        d = cfg.get("date_property_id") or cfg.get("date_property_key")
        if d not in ctx.ids:
            losses.append(Loss("approximated", f"The {t} “{name}” has no date property in Notion.", "It is sent as a table.", "view_no_date"))
            t, conf = "table", {"type": "table"}
        else:
            conf["type"] = t
            conf["date_property_id"] = ctx.ids[d]
            if t == "calendar" and cfg.get("show_weekends") is not None:
                conf["show_weekends"] = bool(cfg["show_weekends"])
            if t == "timeline":
                e = cfg.get("end_date_property_id") or cfg.get("end_date_property_key")
                if e in ctx.ids:
                    conf["end_date_property_id"] = ctx.ids[e]
                z = (cfg.get("preference") or {}).get("zoom_level")
                if z in ZOOM:
                    conf["preference"] = {"zoom_level": z}
                if cfg.get("arrows_by"):
                    losses.append(Loss("lossy", f"Dependency arrows of the timeline “{name}”.", "They are not set.", "view_ui_only"))
    elif t == "chart":
        ct = cfg.get("chart_type")
        if ct not in CHARTS:
            ct = "column"
        conf["type"] = "chart"
        conf["chart_type"] = ct
        x = cfg.get("x_axis") or {}
        xk = x.get("property_id") or x.get("property_key")
        agg = (cfg.get("y_axis") or {}).get("aggregator", "count")
        agg = agg if agg in AGG else "count"
        yk = (cfg.get("y_axis") or {}).get("property_id") or (cfg.get("y_axis") or {}).get("property_key")
        if ct == "number":
            conf["value"] = {"aggregator": agg, **({"property_id": ctx.ids[yk]} if yk in ctx.ids else {})}
        elif xk in ctx.ids and ctx.types.get(xk) in FILTER_KEY:
            xt = FILTER_KEY[ctx.types[xk]]
            conf["x_axis"] = {"type": xt, "property_id": ctx.ids[xk], "sort": {"type": "manual"}}
            if xt == "date":
                conf["x_axis"]["group_by"] = "month"
                conf["x_axis"]["sort"] = {"type": "ascending"}
            if ct == "donut":
                conf["value"] = {"aggregator": agg, **({"property_id": ctx.ids[yk]} if yk in ctx.ids else {})}
            else:
                conf["y_axis"] = {"aggregator": agg, **({"property_id": ctx.ids[yk]} if yk in ctx.ids else {})}
        else:
            losses.append(Loss("approximated", f"The chart “{name}” has no usable x axis in Notion.", "It is sent as a single number.", "view_chart_axis"))
            conf = {"type": "chart", "chart_type": "number", "value": {"aggregator": "count"}}
        if cfg.get("stack_by"):
            losses.append(Loss("lossy", f"Stacking of the chart “{name}”.", "It is not set.", "view_ui_only"))
    elif t == "form":
        conf["type"] = "form"
        if cfg.get("is_form_closed") is not None:
            conf["is_form_closed"] = bool(cfg["is_form_closed"])
        if cfg.get("questions"):
            losses.append(Loss("lossy", f"The questions of the form “{name}”.", "Notion's API cannot set them; the form shows its properties.", "view_form_questions"))
    elif t == "dashboard":
        widgets = [w.get("view_id") for row in cfg.get("rows") or [] for w in row.get("widgets") or [] if w.get("view_id")]
        payload["type"] = "dashboard"
        if len(widgets):
            losses.append(Loss("approximated", f"The layout (rows and widths) of the dashboard “{name}”.", "Widgets are added in order; Notion lays them out.", "view_dashboard_layout"))
        return Built(payload, losses, widgets)
    else:
        losses.append(Loss("lossy", f"A view of type “{t}”.", "It is not sent.", "view_unknown"))
        return Built(None, losses)
    payload["type"] = t
    if conf:
        payload["configuration"] = conf
    f = filter_of(view, ctx, losses)
    if f:
        payload["filter"] = f
    s = sorts_of(view, ctx, losses)
    if s:
        payload["sorts"] = s
    return Built(payload, losses)
