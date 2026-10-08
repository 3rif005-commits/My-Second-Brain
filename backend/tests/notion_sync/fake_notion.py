"""An in-memory Notion for engine tests, served through httpx.MockTransport.

It enforces the limits we verified live (RESULTS.md): 2,000 UTF-16 units per
text object, 100 children per array, two nesting levels per request, 100
rich-text objects, strict code-language enum, atomic append. A chunker bug
therefore fails here the way it would fail against Notion.

Fault injection: `fail(match, mode)` where mode is
  "500"            the request is NOT applied, answered 500
  "timeout_after"  the request IS applied, then the connection times out
  "timeout_before" the request is not applied, then the connection times out
  "429"            answered 429 with Retry-After: 1 (not applied)
"""
from __future__ import annotations

import json
import re
import uuid

import httpx

from services.notion_sync.notion.languages import NOTION_LANGUAGES

BOT = "bot-0000"
Crash = None  # set below
HUMAN = "human-1111"


def u16(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


class FakeNotion:
    def __init__(self, root_title: str = "SB-TEST-root"):
        self.pages: dict[str, dict] = {}
        self.blocks: dict[str, dict] = {}
        self.dbs: dict[str, dict] = {}
        self.uploads: dict[str, dict] = {}
        self.views: dict[str, dict] = {}
        self.upload_cap = 5 * 1024 * 1024
        self.sources: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []
        self.faults: list[dict] = []
        self.root = self._new_page(None, root_title)
        self.transport = httpx.MockTransport(self.handle)

    # ---- helpers ------------------------------------------------------------------
    def ts(self) -> str:
        """Real time (so reconcile windows behave), strictly increasing."""
        from datetime import datetime, timedelta, timezone
        self._n = getattr(self, "_n", 0) + 1
        return (datetime.now(timezone.utc) + timedelta(microseconds=self._n)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    def _id(self) -> str:
        return str(uuid.uuid4())

    def _new_page(self, parent, title, props=None, icon=None) -> str:
        pid = self._id()
        t = self.ts()
        self.pages[pid] = {
            "object": "page", "id": pid, "created_time": t, "last_edited_time": t,
            "created_by": {"object": "user", "id": BOT}, "last_edited_by": {"object": "user", "id": BOT},
            "icon": icon, "cover": None, "parent": parent or {"type": "workspace", "workspace": True},
            "in_trash": False, "archived": False, "url": f"https://www.notion.so/{pid.replace('-', '')}",
            "properties": props or {"title": {"id": "title", "type": "title", "title": [
                {"type": "text", "text": {"content": title}, "plain_text": title}]}},
            "children": []}
        return pid

    def fail(self, match: str, mode: str, times: int = 1):
        """match: 'METHOD path-regex'."""
        self.faults.append({"match": match, "mode": mode, "left": times})

    def human_edit(self, page_id: str):
        p = self.pages[page_id]
        p["last_edited_by"] = {"object": "user", "id": HUMAN}
        p["last_edited_time"] = self.ts()

    def writes(self) -> int:
        return sum(1 for m, p in self.calls if m in ("PATCH", "DELETE") or
                   (m == "POST" and not (p == "/search" or p.endswith("/query"))))

    def page_ids_in(self, ds_id: str) -> list[str]:
        return [p["id"] for p in self.pages.values()
                if p["parent"].get("data_source_id") == ds_id]

    def top_blocks(self, page_id: str) -> list[dict]:
        return [self.blocks[b] for b in self.pages[page_id]["children"]]

    def tree(self, parent_children: list[str]) -> list[dict]:
        out = []
        for bid in parent_children:
            b = json.loads(json.dumps(self.blocks[bid]))
            b.pop("children_ids", None)
            kids = self.tree(self.blocks[bid]["children_ids"])
            if kids:
                b[b["type"]]["children"] = kids
            out.append(b)
        return out

    # ---- validation (mirrors verified Notion behaviour) -----------------------------
    def _validate_blocks(self, blocks, depth=1, path="children"):
        if len(blocks) > 100:
            raise _Bad(f"{path}.length should be ≤ 100, instead was {len(blocks)}")
        for i, b in enumerate(blocks):
            t = b.get("type")
            body = b.get(t)
            if body is None:
                raise _Bad(f"{path}[{i}] missing body for {t}")
            self._validate_rich(body.get("rich_text", []), f"{path}[{i}].{t}.rich_text")
            self._validate_rich(body.get("caption", []), f"{path}[{i}].{t}.caption")
            if t == "code" and body.get("language") not in NOTION_LANGUAGES:
                raise _Bad(f"{path}[{i}].code.language should be one of the enum, instead was {body.get('language')}")
            if t == "column_list":
                cols = body.get("children", [])
                if len(cols) < 2:
                    raise _Bad("column_list needs ≥ 2 columns")
                if any(not c["column"].get("children") for c in cols):
                    raise _Bad("each column needs ≥ 1 child")
            if t == "table":
                w = body.get("table_width")
                rows = body.get("children", [])
                if not rows or any(len(r["table_row"]["cells"]) != w for r in rows):
                    raise _Bad("table rows must all have table_width cells")
            if t in ("image", "video", "audio", "file", "pdf", "embed"):
                if body.get("type") == "file_upload":
                    up = self.uploads.get(body["file_upload"]["id"])
                    if not up or up["status"] != "uploaded":
                        raise _Bad("file_upload not uploaded")
                elif body.get("type") != "external":
                    raise _Bad(f"{t} needs type external or file_upload")
            if t == "callout" and body.get("icon") and body["icon"].get("type") == "emoji" and body["icon"]["emoji"].isascii():
                raise _Bad("callout icon emoji invalid")
            if t.startswith("heading_") and body.get("children") and not body.get("is_toggleable"):
                raise _Bad(f"{path}[{i}] heading with children must be toggleable")
            if t in ("divider",) and body.get("children"):
                raise _Bad(f"{path}[{i}] divider cannot have children")
            kids = body.get("children")
            if kids:
                if depth >= 3:
                    raise _Bad(f"{path}[{i}] exceeds two levels of nesting")
                self._validate_blocks(kids, depth + 1, f"{path}[{i}].{t}.children")

    def _validate_rich(self, rt, path):
        if len(rt) > 100:
            raise _Bad(f"{path}.length should be ≤ 100, instead was {len(rt)}")
        for j, o in enumerate(rt):
            if o.get("type") == "text":
                c = o["text"]["content"]
                if u16(c) > 2000:
                    raise _Bad(f"{path}[{j}].text.content.length should be ≤ `2000`, instead was `{u16(c)}`.")
                lk = o["text"].get("link")
                if lk and not re.match(r"(https?://|mailto:|tel:)", lk["url"]):
                    raise _Bad(f"{path}[{j}].text.link.url invalid")
            if o.get("type") == "equation" and len(o["equation"]["expression"]) > 1000:
                raise _Bad(f"{path}[{j}] equation too long")

    # ---- block storage -----------------------------------------------------------------
    def _store_blocks(self, blocks, parent_id, parent_kind) -> list[str]:
        ids = []
        for b in blocks:
            bid = self._id()
            t = b["type"]
            body = json.loads(json.dumps(b[t]))
            kids = body.pop("children", [])
            tm = self.ts()
            self.blocks[bid] = {
                "object": "block", "id": bid, "type": t, t: body, "parent": {"type": parent_kind, "id": parent_id},
                "created_time": tm, "last_edited_time": tm, "has_children": bool(kids), "in_trash": False,
                "children_ids": []}
            self.blocks[bid]["children_ids"] = self._store_blocks(kids, bid, "block_id")
            ids.append(bid)
        return ids

    def _new_view(self, did, sid, name, type_, **extra) -> dict:
        vid = self._id()
        v = {"object": "view", "id": vid, "parent": {"type": "database_id", "database_id": did}, "data_source_id": sid,
             "name": name, "type": type_, "created_time": self.ts(), **extra}
        self.views[vid] = v
        return v

    def _check_view(self, body):
        cfg = body.get("configuration") or {}
        t = body.get("type")
        src = self.sources.get(body.get("data_source_id")) if body.get("data_source_id") else None
        ids = set(src.get("ids", {}).values()) if src else set()

        def known(pid, where):
            if pid not in ids:
                raise _Bad(f"{where} property \"{pid}\" not found.")
        if cfg and cfg.get("type") != t:
            raise _Bad("configuration.type must match type")
        for p in cfg.get("properties", []) or []:
            known(p["property_id"], "view")
        for key in ("group_by", "sub_group_by"):
            if cfg.get(key):
                known(cfg[key]["property_id"], "Group-by")
                if "type" not in cfg[key] or "sort" not in cfg[key]:
                    raise _Bad("group_by needs type and sort")
        if t == "board" and not cfg.get("group_by"):
            raise _Bad("board views require group_by")
        if t in ("calendar", "timeline"):
            known(cfg.get("date_property_id"), "date")
        if t == "chart":
            if cfg.get("chart_type") not in ("column", "bar", "line", "donut", "number"):
                raise _Bad("chart_type invalid")
            if cfg.get("x_axis") and "type" not in cfg["x_axis"]:
                raise _Bad("body.configuration.x_axis.type should be defined")
            if cfg.get("x_axis"):
                known(cfg["x_axis"]["property_id"], "x axis")

        def walk(f):
            if not f:
                return
            for k in ("and", "or"):
                for x in f.get(k, []) or []:
                    walk(x)
            if "property" in f:
                known(f["property"], "filter")
        walk(body.get("filter"))
        for s_ in body.get("sorts") or []:
            known(s_["property"], "sort")

    def _prop_id(self, sid: str, name: str) -> str:
        ids = self.sources[sid].setdefault("ids", {})
        if name not in ids:
            ids[name] = f"p{len(ids)}{uuid.uuid4().hex[:3]}"
        return ids[name]

    def _source_view(self, sid: str) -> dict:
        src = self.sources[sid]
        props = {}
        for name, schema in src["properties"].items():
            t = next(iter(schema))
            props[name] = {"id": self._prop_id(sid, name), "name": name, "type": t, **schema}
            if t == "status":
                props[name]["status"] = self._status_view(sid, name)
        return {"object": "data_source", "id": sid, "properties": props}

    def _status_view(self, sid: str, name: str) -> dict:
        st = self.sources[sid]["properties"][name]["status"]
        opts = [{"id": f"o-{o['name']}", "name": o["name"], "color": o.get("color", "default")} for o in st.get("options", [])]
        groups = st.get("groups") or [{"name": g, "option_ids": ([o["id"] for o in opts] if g == "To-do" else [])}
                                      for g in ("To-do", "In progress", "Complete")]
        return {"options": opts, "groups": groups}

    def _patch_source(self, sid: str, props: dict):
        src = self.sources[sid]
        for key, spec in props.items():
            by_id = {v: k for k, v in src.get("ids", {}).items()}
            name = by_id.get(key, key)
            if spec is None:
                src["properties"].pop(name, None)
                continue
            if set(spec) == {"name"}:                                   # rename by property id
                if name not in src["properties"]:
                    raise _Bad(f"property {key} does not exist")
                src["properties"][spec["name"]] = src["properties"].pop(name)
                src["ids"][spec["name"]] = src["ids"].pop(name)
                continue
            t = next(iter(spec))
            if t == "relation":
                rel = spec["relation"]
                tgt = self.sources.get(rel["data_source_id"])
                if tgt is None:
                    raise _Bad("relation target data source not found")
                src["properties"][name] = {"relation": rel}
                if rel.get("type") == "dual_property":
                    back = rel["dual_property"]["synced_property_name"]
                    tgt["properties"][back] = {"relation": {"data_source_id": sid, "type": "dual_property",
                                                            "dual_property": {"synced_property_name": name}}}
                continue
            if t == "rollup":
                r = spec["rollup"]
                rel = src["properties"].get(r["relation_property_name"], {}).get("relation")
                if not rel:
                    raise _Bad("rollup relation property does not exist")
                if r["rollup_property_name"] not in self.sources[rel["data_source_id"]]["properties"]:
                    raise _Bad("rollup property does not exist in the related data source")
            if t == "formula":
                for ref in re.findall(r'prop\("((?:[^"\\]|\\.)*)"\)', spec["formula"]["expression"]):
                    if ref not in src["properties"] and ref != name:
                        raise _Bad(f"Type error with formula: unknown property {ref}")
            if t == "status" and name in src["properties"] and "options" not in spec["status"]:
                src["properties"][name]["status"] = {**src["properties"][name]["status"], **spec["status"]}
                continue
            src["properties"][name] = spec

    def _validate_row(self, ds_id: str, props: dict):
        src = self.sources[ds_id]
        for name, val in props.items():
            schema = src["properties"].get(name)
            if schema is None:
                raise _Bad(f"{name} is not a property that exists.")
            t = next(iter(schema))
            if t in ("created_time", "last_edited_time", "formula", "rollup", "unique_id"):
                raise _Bad(f"{name} is read-only")
            if next(iter(val)) != t:
                raise _Bad(f"property {name} should be {t}")
            if t == "relation":
                for r in val["relation"]:
                    if r["id"] not in self.pages:
                        raise _Bad("relation target page does not exist")
            if t == "title":
                self._validate_rich(val["title"], f"properties.{name}")
            if t == "rich_text":
                self._validate_rich(val["rich_text"], f"properties.{name}")
            if t in ("select", "status") and val[t] and "," in val[t]["name"]:
                raise _Bad("select option names cannot contain commas")
            if t == "multi_select" and any("," in o["name"] for o in val["multi_select"]):
                raise _Bad("select option names cannot contain commas")

    def _title_of(self, pid: str) -> str:
        p = self.pages[pid]["properties"]
        t = p.get("title") or next((v for v in p.values() if v.get("type") == "title"), {})
        return "".join(x["text"]["content"] for x in t.get("title", []))

    def _register_child_page(self, pid: str, parent_id: str):
        self.blocks[pid] = {"object": "block", "id": pid, "type": "child_page", "in_trash": False,
                            "created_time": self.pages[pid]["created_time"], "has_children": False,
                            "child_page": {"title": self._title_of(pid)}, "children_ids": [],
                            "parent": {"type": "page_id", "id": parent_id}}
        self.pages[parent_id]["children"].append(pid)

    def _public(self, bid: str) -> dict:
        b = dict(self.blocks[bid])
        b.pop("children_ids", None)
        return b

    def _container(self, pid):
        if pid in self.pages:
            return self.pages[pid]["children"], self.pages[pid]
        if pid in self.blocks:
            return self.blocks[pid]["children_ids"], self.blocks[pid]
        return None, None

    def _touch_page(self, pid, by=BOT):
        node = pid
        while node in self.blocks:
            node = self.blocks[node]["parent"]["id"]
        if node in self.pages:
            self.pages[node]["last_edited_time"] = self.ts()
            self.pages[node]["last_edited_by"] = {"object": "user", "id": by}

    # ---- HTTP -----------------------------------------------------------------------------
    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["Notion-Version"] == "2026-03-11"
        assert request.headers["Authorization"].startswith("Bearer ")
        path = request.url.path.removeprefix("/v1")
        method = request.method
        self.calls.append((method, path))
        ctype = request.headers.get("content-type", "")
        body = json.loads(request.content) if request.content and "json" in ctype else {}
        fault = next((f for f in self.faults if f["left"] > 0 and f["match"].split(" ", 1)[0] == method
                      and re.fullmatch(f["match"].split(" ", 1)[1], path)), None)
        if fault:
            fault["left"] -= 1
            mode = fault["mode"]
            if mode == "500":
                return httpx.Response(500, json={"object": "error", "status": 500, "code": "internal_server_error", "message": "x"})
            if mode == "429":
                return httpx.Response(429, headers={"Retry-After": "1"}, json={"object": "error", "status": 429, "code": "rate_limited", "message": "slow"})
            if mode == "timeout_before":
                raise httpx.ReadTimeout("timeout", request=request)
            if mode == "crash_after":          # the whole process dies right after the write applied
                self._route(method, path, body, request)
                raise _Crash()
            if mode == "timeout_after":
                try:
                    self._route(method, path, body, request)
                finally:
                    pass
                raise httpx.ReadTimeout("timeout", request=request)
        return self._route(method, path, body, request)

    def _route(self, method, path, body, request) -> httpx.Response:
        try:
            return self._route_inner(method, path, body, request)
        except _Bad as e:
            return httpx.Response(400, json={"object": "error", "status": 400, "code": "validation_error",
                                              "message": "body failed validation: " + str(e)})
        except _Missing:
            return httpx.Response(404, json={"object": "error", "status": 404, "code": "object_not_found", "message": "Could not find"})

    def _route_inner(self, method, path, body, request):
        ok = lambda j: httpx.Response(200, json=j)
        if method == "GET" and path == "/users/me":
            return ok({"object": "user", "id": BOT, "type": "bot", "name": "Second Brain mirror",
                       "bot": {"owner": {"type": "workspace"}, "workspace_name": "Test WS",
                               "workspace_id": "ws-1", "workspace_limits": {"max_file_upload_size_in_bytes": 5242880}}})
        if method == "POST" and path == "/search":
            res = [self._public_page(p) for p in self.pages.values() if not p["in_trash"]]
            return ok({"object": "list", "results": res, "has_more": False, "next_cursor": None})
        m = re.fullmatch(r"/pages/([^/]+)", path)
        if m:
            p = self.pages.get(m[1])
            if p is None or p["in_trash"]:
                raise _Missing
            if method == "GET":
                return ok(self._public_page(p))
            if method == "PATCH":
                if "properties" in body and p["parent"].get("type") == "data_source_id":
                    self._validate_row(p["parent"]["data_source_id"], body["properties"])
                if "properties" in body:
                    for k, v in body["properties"].items():
                        if "title" in v:
                            self._validate_rich(v["title"], "properties.title")
                        p["properties"][k] = {"type": "title" if "title" in v else "rich_text", **v}
                if body.get("icon"):
                    p["icon"] = body["icon"]
                if body.get("cover"):
                    p["cover"] = body["cover"]
                p["last_edited_time"] = self.ts()
                p["last_edited_by"] = {"object": "user", "id": BOT}
                if m[1] in self.blocks and self.blocks[m[1]]["type"] == "child_page":
                    self.blocks[m[1]]["child_page"]["title"] = self._title_of(m[1])
                return ok(self._public_page(p))
        if method == "POST" and path == "/pages":
            parent = body["parent"]
            if parent["type"] == "data_source_id" and parent["data_source_id"] not in self.sources:
                raise _Missing
            if parent["type"] == "page_id" and parent["page_id"] not in self.pages:
                raise _Missing
            if parent["type"] == "data_source_id":
                self._validate_row(parent["data_source_id"], body.get("properties", {}))
            for v in body.get("properties", {}).values():
                self._validate_rich(v.get("title", v.get("rich_text", [])), "properties")
            if body.get("children"):
                self._validate_blocks(body["children"])
            if body.get("cover"):
                cv = body["cover"]
                if cv.get("type") == "file_upload" and self.uploads.get(cv["file_upload"]["id"], {}).get("status") != "uploaded":
                    raise _Bad("cover upload missing")
            icon = body.get("icon")
            if icon and not (icon["type"] == "emoji" and icon["emoji"] and not icon["emoji"].isascii()):
                raise _Bad("body.icon.emoji invalid")
            props = {k: ({"id": k, "type": "title", **v} if "title" in v else {"id": k, "type": "rich_text", **v})
                     for k, v in body.get("properties", {}).items()}
            if parent["type"] == "page_id":
                props = {"title": {"id": "title", "type": "title", **next(iter(props.values()))}} if props else props
            pid = self._new_page(parent, "", props, icon)
            self.pages[pid]["cover"] = body.get("cover")
            if parent["type"] == "page_id":
                self._register_child_page(pid, parent["page_id"])
            if body.get("children"):
                self.pages[pid]["children"] = self._store_blocks(body["children"], pid, "page_id")
            return ok(self._public_page(self.pages[pid]))
        m = re.fullmatch(r"/blocks/([^/]+)/children", path)
        if m:
            kids, owner = self._container(m[1])
            if kids is None:
                raise _Missing
            if method == "PATCH":
                self._validate_blocks(body["children"])
                new = self._store_blocks(body["children"], m[1], "page_id" if m[1] in self.pages else "block_id")
                pos = body.get("position")
                if pos and pos["type"] == "start":
                    kids[0:0] = new
                elif pos and pos["type"] == "after_block":
                    ref = pos["after_block"]["id"]
                    if ref not in kids:
                        raise _Bad("after_block is not a child of this parent")
                    at = kids.index(ref) + 1
                    kids[at:at] = new
                else:
                    kids.extend(new)
                if m[1] in self.blocks:
                    self.blocks[m[1]]["has_children"] = True
                self._touch_page(m[1])
                shown = new
                if pos:                    # like the real API: the new blocks, then every later sibling
                    shown = kids[kids.index(new[0]):]
                return ok({"object": "list", "results": [self._public(b) for b in shown], "has_more": False, "next_cursor": None})
            if method == "GET":
                live = [b for b in kids if not self.blocks[b]["in_trash"]]
                start = int(request.url.params.get("start_cursor") or 0)
                size = min(int(request.url.params.get("page_size") or 100), 100)
                page = live[start:start + size]
                more = start + size < len(live)
                return ok({"object": "list", "results": [self._public(b) for b in page],
                           "has_more": more, "next_cursor": str(start + size) if more else None})
        m = re.fullmatch(r"/blocks/([^/]+)", path)
        if m and method == "PATCH":
            b = self.blocks.get(m[1])
            if b is None or b["in_trash"]:
                raise _Missing
            t = b["type"]
            if t not in body:
                raise _Bad(f"body.{t} missing")
            patch = body[t]
            if "children" in patch or "is_toggleable" in patch:
                raise _Bad("children / is_toggleable cannot be patched")
            self._validate_blocks([{"type": t, t: patch}])
            b[t].update(patch)
            self._touch_page(m[1])
            return ok(self._public(m[1]))
        if m and method == "DELETE":
            b = self.blocks.get(m[1])
            if b is None or b["in_trash"]:
                raise _Missing
            b["in_trash"] = True
            parent = b["parent"]["id"]
            kids, _ = self._container(parent)
            if kids is not None and m[1] in kids:
                kids.remove(m[1])
            self._touch_page(parent)
            return ok(self._public(m[1]))
        if method == "POST" and path == "/file_uploads":
            name = body["filename"]
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if ext in ("", "bin", "exe"):
                raise _Bad("Provided `filename` has an extension that is not supported for the File Upload API.")
            uid = self._id()
            self.uploads[uid] = {"id": uid, "status": "pending", "filename": name, "content_type": body.get("content_type")}
            return ok({"object": "file_upload", **self.uploads[uid]})
        m = re.fullmatch(r"/file_uploads/([^/]+)/send", path)
        if m and method == "POST":
            up = self.uploads.get(m[1])
            if up is None:
                raise _Missing
            size = len(request.content)
            if size > self.upload_cap + 2000:
                raise _Bad(f"File size exceeds the limit of {self.upload_cap // 1048576} MiB.")
            up["status"] = "uploaded"
            up["size"] = size
            return ok({"object": "file_upload", **up})
        m = re.fullmatch(r"/pages/([^/]+)/markdown", path)
        if m and method == "GET":
            p = self.pages.get(m[1])
            if p is None or p["in_trash"]:
                raise _Missing
            lines = []
            for b in self.tree(p["children"]):
                body = b.get(b["type"], {})
                text = "".join(t.get("text", {}).get("content", "") for t in body.get("rich_text", []))
                lines.append(("## " if b["type"].startswith("heading") else "") + text)
            return ok({"object": "page_markdown", "id": m[1], "markdown": "\n".join(lines), "truncated": False,
                       "unknown_block_ids": []})
        m = re.fullmatch(r"/pages/([^/]+)/move", path)
        if m and method == "POST":
            p = self.pages.get(m[1])
            if p is None or p["in_trash"]:
                raise _Missing
            new = body["parent"]
            if new["type"] == "data_source_id" and new["data_source_id"] not in self.sources:
                raise _Missing
            if new["type"] == "page_id" and new["page_id"] not in self.pages:
                raise _Missing
            old = p["parent"]
            if old.get("type") == "page_id" and m[1] in self.pages[old["page_id"]]["children"]:
                self.pages[old["page_id"]]["children"].remove(m[1])
                self.blocks.pop(m[1], None)
            p["parent"] = new if new["type"] == "page_id" else {**new, "database_id": self.sources[new["data_source_id"]]["db"]}
            if new["type"] == "page_id":
                self._register_child_page(m[1], new["page_id"])
            p["last_edited_time"] = self.ts()
            return ok(self._public_page(p))
        m = re.fullmatch(r"/data_sources/([^/]+)", path)
        if m and method in ("GET", "PATCH"):
            src = self.sources.get(m[1])
            if src is None:
                raise _Missing
            if method == "PATCH":
                self._patch_source(m[1], body.get("properties", {}))
            return ok(self._source_view(m[1]))
        if path == "/views" and method == "GET":
            did = request.url.params.get("database_id")
            return ok({"object": "list", "results": [{"object": "view", "id": v["id"]} for v in self.views.values()
                                                       if v["parent"]["database_id"] == did and not v.get("deleted")],
                       "has_more": False, "next_cursor": None})
        if path == "/views" and method == "POST":
            if body["database_id"] not in self.dbs:
                raise _Missing
            if not body.get("data_source_id"):
                raise _Bad("body.data_source_id should be defined")
            self._check_view(body)
            extra = {k: body[k] for k in ("configuration", "filter", "sorts", "dashboard_view_id") if k in body}
            return ok(self._new_view(body["database_id"], body.get("data_source_id"), body["name"], body["type"], **extra))
        m = re.fullmatch(r"/views/([^/]+)", path)
        if m:
            v = self.views.get(m[1])
            if v is None or v.get("deleted"):
                raise _Missing
            if method == "GET":
                return ok(v)
            if method == "PATCH":
                merged = {"type": v["type"], "data_source_id": v["data_source_id"], **{k: v[k] for k in ("configuration", "filter", "sorts") if k in v}, **body}
                self._check_view(merged)
                v.update({k: body[k] for k in ("name", "configuration", "filter", "sorts") if k in body})
                return ok(v)
            if method == "DELETE":
                if len([x for x in self.views.values() if x["parent"]["database_id"] == v["parent"]["database_id"]
                        and not x.get("deleted") and not x.get("dashboard_view_id")]) <= 1:
                    raise _Bad("A database must keep at least one view.")
                v["deleted"] = True
                return ok(v)
        if method == "POST" and path == "/databases":
            did, sid = self._id(), self._id()
            parent = body["parent"]
            if parent["page_id"] not in self.pages:
                raise _Missing
            t = self.ts()
            self.dbs[did] = {"object": "database", "id": did, "created_time": t, "is_inline": body.get("is_inline"),
                             "title": body["title"], "parent": parent, "data_sources": [{"id": sid, "name": "Notes"}], "in_trash": False}
            self.sources[sid] = {"id": sid, "db": did, "properties": dict(body["initial_data_source"]["properties"])}
            for n in self.sources[sid]["properties"]:
                self._prop_id(sid, n)
            self._new_view(did, sid, "Default view", "table")
            bid = did
            self.blocks[bid] = {"object": "block", "id": bid, "type": "child_database", "created_time": t,
                                "child_database": {"title": "".join(x["text"]["content"] for x in body["title"])},
                                "parent": {"type": "page_id", "id": parent["page_id"]}, "in_trash": False,
                                "has_children": False, "children_ids": []}
            self.pages[parent["page_id"]]["children"].append(bid)
            return ok(self.dbs[did])
        m = re.fullmatch(r"/databases/([^/]+)", path)
        if m and method == "GET":
            if m[1] not in self.dbs:
                raise _Missing
            return ok(self.dbs[m[1]])
        if m and method == "PATCH":
            d = self.dbs.get(m[1])
            if d is None:
                raise _Missing
            for k in ("title", "icon", "description", "cover"):
                if k in body:
                    d[k] = body[k]
            if "title" in body and m[1] in self.blocks:
                self.blocks[m[1]]["child_database"]["title"] = "".join(t["text"]["content"] for t in body["title"])
            return ok(d)
        m = re.fullmatch(r"/data_sources/([^/]+)/query", path)
        if m and method == "POST":
            if m[1] not in self.sources:
                raise _Missing
            f = body.get("filter", {})
            prop, want = f["property"], f["rich_text"]["equals"]
            res = []
            for p in self.pages.values():
                if p["parent"].get("data_source_id") != m[1] or p["in_trash"]:
                    continue
                rt = p["properties"].get(prop, {}).get("rich_text", [])
                if "".join(x["text"]["content"] for x in rt) == want:
                    res.append(self._public_page(p))
            return ok({"object": "list", "results": res, "has_more": False, "next_cursor": None})
        return httpx.Response(404, json={"object": "error", "status": 404, "code": "object_not_found", "message": f"unrouted {method} {path}"})

    def _public_page(self, p):
        out = {k: v for k, v in p.items() if k != "children"}
        for prop in out["properties"].values():
            for t in prop.get("title", prop.get("rich_text", [])):
                t.setdefault("plain_text", t.get("text", {}).get("content", ""))
        return out


class _Crash(BaseException):
    """Not an Exception: nothing in the engine may catch it, like a kill -9."""


class _Bad(Exception):
    pass


class _Missing(Exception):
    pass


Crash = _Crash
