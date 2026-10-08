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
        self.sources: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []
        self.faults: list[dict] = []
        self.root = self._new_page(None, root_title)
        self.transport = httpx.MockTransport(self.handle)

    # ---- helpers ------------------------------------------------------------------
    def ts(self) -> str:
        self._n = getattr(self, "_n", 0) + 1
        return f"2026-10-08T10:{self._n // 60:02d}:{self._n % 60:02d}.000Z"

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
            if t == "column_list" and len(body.get("children", [])) < 2:
                raise _Bad("column_list needs ≥ 2 columns")
            if t.startswith("heading_") and body.get("children") and not body.get("is_toggleable"):
                raise _Bad(f"{path}[{i}] heading with children must be toggleable")
            if t in ("divider",) and body.get("children"):
                raise _Bad(f"{path}[{i}] divider cannot have children")
            kids = body.get("children")
            if kids:
                if depth >= 2:
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
        body = json.loads(request.content) if request.content else {}
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
                p["last_edited_time"] = self.ts()
                p["last_edited_by"] = {"object": "user", "id": BOT}
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
            icon = body.get("icon")
            if icon and not (icon["type"] == "emoji" and icon["emoji"] and not icon["emoji"].isascii()):
                raise _Bad("body.icon.emoji invalid")
            props = {k: ({"id": k, "type": "title", **v} if "title" in v else {"id": k, "type": "rich_text", **v})
                     for k, v in body.get("properties", {}).items()}
            if parent["type"] == "page_id":
                props = {"title": {"id": "title", "type": "title", **next(iter(props.values()))}} if props else props
            pid = self._new_page(parent, "", props, icon)
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
        if method == "POST" and path == "/databases":
            did, sid = self._id(), self._id()
            parent = body["parent"]
            if parent["page_id"] not in self.pages:
                raise _Missing
            t = self.ts()
            self.dbs[did] = {"object": "database", "id": did, "created_time": t, "is_inline": body.get("is_inline"),
                             "title": body["title"], "parent": parent, "data_sources": [{"id": sid, "name": "Notes"}], "in_trash": False}
            self.sources[sid] = {"id": sid, "db": did, "properties": body["initial_data_source"]["properties"]}
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
