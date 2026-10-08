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
HUMAN = "human-1111"


def u16(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


class FakeNotion:
    def __init__(self, root_title: str = "SB-TEST-root"):
        self.pages: dict[str, dict] = {}
        self.blocks: dict[str, dict] = {}
        self.dbs: dict[str, dict] = {}
        self.uploads: dict[str, dict] = {}
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
                kids.extend(new)
                if m[1] in self.blocks:
                    self.blocks[m[1]]["has_children"] = True
                self._touch_page(m[1])
                return ok({"object": "list", "results": [self._public(b) for b in new], "has_more": False, "next_cursor": None})
            if method == "GET":
                live = [b for b in kids if not self.blocks[b]["in_trash"]]
                start = int(request.url.params.get("start_cursor") or 0)
                size = min(int(request.url.params.get("page_size") or 100), 100)
                page = live[start:start + size]
                more = start + size < len(live)
                return ok({"object": "list", "results": [self._public(b) for b in page],
                           "has_more": more, "next_cursor": str(start + size) if more else None})
        m = re.fullmatch(r"/blocks/([^/]+)", path)
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
                src["properties"].update(body.get("properties", {}))
            return ok({"object": "data_source", "id": m[1], "properties": {k: {"name": k, **v} for k, v in src["properties"].items()}})
        if method == "POST" and path == "/databases":
            did, sid = self._id(), self._id()
            parent = body["parent"]
            if parent["page_id"] not in self.pages:
                raise _Missing
            t = self.ts()
            self.dbs[did] = {"object": "database", "id": did, "created_time": t, "is_inline": body.get("is_inline"),
                             "title": body["title"], "parent": parent, "data_sources": [{"id": sid, "name": "Notes"}], "in_trash": False}
            self.sources[sid] = {"id": sid, "db": did, "properties": dict(body["initial_data_source"]["properties"])}
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


class _Bad(Exception):
    pass


class _Missing(Exception):
    pass
