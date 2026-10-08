"""The adapter: the engine's only door to Notion.

The engine hands it IR and ids; it returns plain dataclasses. Every Notion
shape (payloads, property names, parents, block ids) stays in this package.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from services.portable import ir
from services.portable.losses import Loss, dedupe

import copy

from .chunker import plan_steps
from .client import NotionClient
from .adapter_emoji import looks_like_emoji
from .errors import AmbiguousWrite, NotionError
from .files import (DEFAULT_CAP, FileSource, FileTooLarge, FileUnavailable, HttpFileSource,
                    upload_name)
from .richtext import plain_rich, rich_text, split_units
from .writers.rich import SB_FILE
from .writers import write_block

TITLE_PROP = "Name"
SB_ID_PROP = "SB ID"
NOTES_DB_TITLE = "Notes"


# ---- results the engine sees ------------------------------------------------

@dataclass
class BotInfo:
    bot_id: str
    workspace_id: str | None
    workspace_name: str | None
    is_bot: bool
    max_upload_bytes: int | None = None


@dataclass
class PageInfo:
    id: str
    title: str
    url: str
    last_edited_time: str | None = None
    last_edited_by: str | None = None
    unreachable: bool = False
    icon: str | None = None
    top: bool = False              # directly under the workspace (a good root)


@dataclass
class DbInfo:
    database_id: str
    data_source_id: str
    created_time: str | None = None


@dataclass
class Rendered:
    """Everything needed to write one page, computed with no I/O."""
    title: list[dict]
    icon: dict | None
    blocks: list[dict]
    block_src: list[str]               # IR src_id of each top-level block
    losses: list[Loss] = field(default_factory=list)
    cover_url: str | None = None       # resolved into `cover` by materialize()
    cover: dict | None = None
    pending_files: int = 0


def page_url(page_id: str) -> str:
    return "https://www.notion.so/" + page_id.replace("-", "")


def _plain(rt: list[dict]) -> str:
    return "".join(t.get("plain_text", "") for t in rt or [])


class NotionAdapter:
    def __init__(self, client: NotionClient, files: FileSource | None = None):
        self.c = client
        self.files = files or HttpFileSource()
        self._cap: int | None = None

    # ---- connect ---------------------------------------------------------------
    def whoami(self) -> BotInfo:
        me = self.c.get("/users/me")
        bot = me.get("bot") or {}
        return BotInfo(
            bot_id=me.get("id", ""), is_bot=me.get("type") == "bot",
            workspace_id=bot.get("workspace_id"), workspace_name=bot.get("workspace_name"),
            max_upload_bytes=(bot.get("workspace_limits") or {}).get("max_file_upload_size_in_bytes"))

    def list_shared_pages(self) -> list[PageInfo]:
        """Pages the connection can see, top-level first (the ones to pick as root)."""
        out: list[PageInfo] = []
        cursor = None
        while True:
            body: dict = {"filter": {"property": "object", "value": "page"}, "page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            res = self.c.post("/search", body, read=True)
            for p in res.get("results", []):
                if p.get("in_trash") or p.get("archived"):
                    continue
                out.append(self._page_info(p, top=p.get("parent", {}).get("type") == "workspace"))
            if not res.get("has_more"):
                break
            cursor = res.get("next_cursor")
        out.sort(key=lambda p: (not p.top, p.title.lower()))
        return out

    def _page_info(self, p: dict, top: bool = False) -> PageInfo:
        title = ""
        for prop in (p.get("properties") or {}).values():
            if prop.get("type") == "title":
                title = _plain(prop.get("title"))
        icon = p.get("icon") or {}
        return PageInfo(
            id=p["id"], title=title or "Untitled", url=p.get("url") or page_url(p["id"]),
            last_edited_time=p.get("last_edited_time"),
            last_edited_by=(p.get("last_edited_by") or {}).get("id"),
            unreachable=bool(p.get("in_trash") or p.get("archived")),
            icon=icon.get("emoji") if icon.get("type") == "emoji" else None, top=top)

    def get_page(self, page_id: str) -> PageInfo:
        """-> PageInfo; `unreachable` when deleted/unshared."""
        try:
            return self._page_info(self.c.get(f"/pages/{page_id}"))
        except NotionError as e:
            if e.code in ("object_not_found", "restricted_resource") or e.status == 404:
                return PageInfo(page_id, "", page_url(page_id), unreachable=True)
            raise

    # ---- render (pure) -----------------------------------------------------------
    def render(self, obj: ir.Obj) -> Rendered:
        losses: list[Loss] = list(obj.losses)
        title = rich_text(obj.title, losses) or plain_rich("Untitled")
        icon = None
        if obj.icon:
            if looks_like_emoji(obj.icon):
                icon = {"type": "emoji", "emoji": obj.icon}
            else:
                losses.append(Loss("approximated", f"The icon “{obj.icon}”.",
                                   "The page has no icon.", "icon_dropped"))
        blocks: list[dict] = []
        src: list[str] = []
        for node in obj.body:
            r = write_block(node)
            blocks += r.blocks
            src += [node.src_id] * len(r.blocks)
            losses += r.losses
        pending = sum(1 for b in _walk(blocks) if SB_FILE in (b.get(b.get("type", ""), {}) or {}))
        pending += 1 if obj.cover else 0
        return Rendered(title, icon, blocks, src, dedupe(losses), cover_url=obj.cover, pending_files=pending)

    def estimate_requests(self, r: Rendered, *, create: bool, old_blocks: int = 0) -> int:
        n = len(plan_steps(r.blocks))
        n += sum(len(s.deferred) for s in plan_steps(r.blocks))
        n += 2 * r.pending_files
        return n + (1 if create else 1 + old_blocks)

    # ---- files (the only part of a send that reads other things) ------------------
    def materialize(self, r: Rendered) -> Rendered:
        """Resolve file placeholders: link public files, upload our own. Returns a
        new Rendered (the pure one is untouched, so a retry starts clean)."""
        if not r.pending_files:
            return r
        out = copy.copy(r)
        out.blocks = copy.deepcopy(r.blocks)
        out.losses = list(r.losses)
        cache: dict[str, object] = {}
        for b in _walk(out.blocks):
            body = b.get(b.get("type", ""))
            if isinstance(body, dict) and SB_FILE in body:
                self._resolve_block(b, body, out.losses, cache)
        if out.cover_url:
            out.cover = self._resolve_cover(out.cover_url, out.losses, cache)
        out.losses = dedupe(out.losses)
        out.pending_files = 0
        return out

    def _cap_bytes(self) -> int:
        if self._cap is None:
            try:
                self._cap = self.whoami().max_upload_bytes or DEFAULT_CAP
            except NotionError:
                self._cap = DEFAULT_CAP
        return self._cap

    def _file_ref(self, url: str, name: str, losses: list[Loss], cache: dict) -> dict | None:
        """-> {"type": "external", ...} | {"type": "file_upload", ...} | None (a note is shown)."""
        if self.files.is_public_link(url):
            return {"type": "external", "external": {"url": url}}
        cap = self._cap_bytes()
        key = f"{url}"
        try:
            f = cache.get(key) or self.files.fetch(url, cap, name)
            cache[key] = f
        except FileTooLarge as e:
            size = f" ({e.size / 1048576:.1f} MB)" if e.size else ""
            losses.append(Loss("lossy", f"A file{size} larger than your Notion plan accepts ({cap // 1048576} MB).",
                               "A note marks where it was.", "media_too_large"))
            return None
        except FileUnavailable:
            losses.append(Loss("lossy", "A file that could not be fetched (its link may have expired).",
                               "A note marks where it was.", "media_unavailable"))
            return None
        try:
            up = self.c.post("/file_uploads", {"mode": "single_part", "filename": upload_name(f.name, f.mime),
                                               "content_type": f.mime}, create=True)
            self.c.request("POST", f"/file_uploads/{up['id']}/send",
                           files={"file": (upload_name(f.name, f.mime), f.data, f.mime)}, create=True)
        except NotionError as e:
            if e.code == "validation_error":
                losses.append(Loss("lossy", "A file type Notion does not accept for upload.",
                                   "A note marks where it was.", "media_type_unsupported"))
                return None
            raise
        return {"type": "file_upload", "file_upload": {"id": up["id"]}}

    def _marker(self, text: str) -> dict:
        return {"type": "callout", "callout": {"rich_text": plain_rich(text), "color": "gray_background",
                                                "icon": {"type": "emoji", "emoji": "⚠️"}}}

    def _resolve_block(self, block: dict, body: dict, losses: list[Loss], cache: dict) -> None:
        ph = body.pop(SB_FILE)
        ref = self._file_ref(ph["url"], ph.get("name", ""), losses, cache)
        if ref is None:
            label = ph.get("name") or ph["url"].rsplit("/", 1)[-1].split("?")[0] or ph["kind"]
            block.clear()
            block.update(self._marker(f"Not fully represented: the {ph['kind']} “{label}” could not be copied to Notion."))
            return
        body.update(ref)

    def _resolve_cover(self, url: str, losses: list[Loss], cache: dict) -> dict | None:
        ref = self._file_ref(url, "cover", losses, cache)
        if ref is None:
            losses.append(Loss("approximated", "The note's cover image.", "The page has no cover.", "cover_dropped"))
        return ref

    # ---- the Notes database ------------------------------------------------------
    def create_notes_database(self, root_page_id: str) -> DbInfo:
        db = self.c.post("/databases", {
            "parent": {"type": "page_id", "page_id": root_page_id},
            "title": plain_rich(NOTES_DB_TITLE), "is_inline": True,
            "initial_data_source": {"properties": {
                TITLE_PROP: {"title": {}}, SB_ID_PROP: {"rich_text": {}}}}}, create=True)
        return DbInfo(db["id"], (db.get("data_sources") or [{}])[0].get("id", ""),
                      db.get("created_time"))

    def find_notes_databases(self, root_page_id: str) -> list[DbInfo]:
        """Reconcile: databases titled "Notes" directly under the root, oldest first."""
        found: list[DbInfo] = []
        for b in self._children(root_page_id):
            if b.get("type") == "child_database" and \
                    (b.get("child_database") or {}).get("title") == NOTES_DB_TITLE:
                db = self.c.get(f"/databases/{b['id']}")
                found.append(DbInfo(db["id"], (db.get("data_sources") or [{}])[0].get("id", ""),
                                    db.get("created_time") or b.get("created_time")))
        return sorted(found, key=lambda d: d.created_time or "")

    # ---- rows ---------------------------------------------------------------------
    def create_row(self, data_source_id: str, r: Rendered, sb_id: str) -> str:
        """Create the (empty) row. Returns the page id. Never retried blindly:
        an unknown outcome raises AmbiguousWrite and the engine reconciles."""
        body: dict = {"parent": {"type": "data_source_id", "data_source_id": data_source_id},
                      "properties": {TITLE_PROP: {"title": r.title},
                                     SB_ID_PROP: {"rich_text": plain_rich(sb_id)}}}
        if r.icon:
            body["icon"] = r.icon
        if r.cover:
            body["cover"] = r.cover
        return self.c.post("/pages", body, create=True)["id"]

    def find_rows(self, data_source_id: str, sb_id: str) -> list[tuple[str, str]]:
        """Reconcile: [(page_id, created_time)] of rows whose SB ID matches, oldest first."""
        res = self.c.post(f"/data_sources/{data_source_id}/query", {
            "filter": {"property": SB_ID_PROP, "rich_text": {"equals": sb_id}},
            "page_size": 100}, read=True)
        rows = [(p["id"], p.get("created_time", "")) for p in res.get("results", [])
                if not (p.get("in_trash") or p.get("archived"))]
        return sorted(rows, key=lambda x: x[1])

    def update_properties(self, page_id: str, r: Rendered) -> None:
        body: dict = {"properties": {TITLE_PROP: {"title": r.title}}}
        if r.icon:
            body["icon"] = r.icon
        if r.cover:
            body["cover"] = r.cover
        self.c.patch(f"/pages/{page_id}", body)

    # ---- bodies --------------------------------------------------------------------
    def append_body(self, page_id: str, r: Rendered, on_blocks=None) -> list[dict]:
        """Append the whole body. `on_blocks(entries)` is called after every
        request with [{"id", "src"}] of the top-level blocks that landed, so a
        crash leaves an exact record of what is on the page."""
        placed: list[dict] = []
        i = 0
        for step in plan_steps(r.blocks):
            ids = self._append(page_id, step.blocks, {e["id"] for e in placed})
            entries = [{"id": bid, "src": r.block_src[i + k]} for k, bid in enumerate(ids)]
            i += len(step.blocks)
            placed += entries
            if on_blocks:
                on_blocks(entries)
            for d in step.deferred:
                self._append_tree(self._resolve(ids, d.path), d.children)
        return placed

    def _append(self, parent_id: str, blocks: list[dict], known: set[str]) -> list[str]:
        """Append one request. An append is atomic (T1) but a timeout or 5xx
        leaves its outcome unknown, and repeating it could duplicate the
        blocks: so first look at what is on the parent (`known` = ids we have
        already placed there) and only re-send when it provably did not land."""
        try:
            return self._append_once(parent_id, blocks)
        except AmbiguousWrite:
            landed = self._landed(parent_id, blocks, known)
            if landed is not None:
                return landed
            return self._append_once(parent_id, blocks)       # confirmed absent: safe

    def _append_once(self, parent_id: str, blocks: list[dict]) -> list[str]:
        res = self.c.patch(f"/blocks/{parent_id}/children", {"children": blocks}, create=True)
        ids = [b["id"] for b in res.get("results", [])]
        if len(ids) != len(blocks):
            raise NotionError(502, "unexpected_response",
                              f"appended {len(blocks)} blocks, got {len(ids)} back")
        return ids

    def _landed(self, parent_id: str, blocks: list[dict], known: set[str]) -> list[str] | None:
        """The ids of `blocks` if they are the last children of the parent."""
        kids = self._children(parent_id)
        tail = kids[-len(blocks):] if blocks else []
        if len(tail) == len(blocks) and all(
                b["id"] not in known and b.get("type") == w.get("type")
                for b, w in zip(tail, blocks)):
            return [b["id"] for b in tail]
        return None

    def _append_tree(self, parent_id: str, blocks: list[dict]) -> None:
        known: set[str] = set()
        for step in plan_steps(blocks):
            ids = self._append(parent_id, step.blocks, known)
            known.update(ids)
            for d in step.deferred:
                self._append_tree(self._resolve(ids, d.path), d.children)

    def _resolve(self, ids: list[str], path: tuple[int, ...]) -> str:
        node = ids[path[0]]
        for j in path[1:]:
            node = self._children(node)[j]["id"]
        return node

    def delete_blocks(self, ids: list[str], on_deleted=None) -> None:
        """Delete only blocks WE created (ids come from our own block index)."""
        for bid in ids:
            try:
                self.c.delete(f"/blocks/{bid}")
            except NotionError as e:
                if not (e.status == 404 or e.code == "object_not_found"):
                    raise
            if on_deleted:
                on_deleted(bid)

    def _children(self, block_id: str) -> list[dict]:
        out, cursor = [], None
        while True:
            params = {"page_size": 100, **({"start_cursor": cursor} if cursor else {})}
            res = self.c.get(f"/blocks/{block_id}/children", params=params)
            out += res.get("results", [])
            if not res.get("has_more"):
                return out
            cursor = res.get("next_cursor")


def _walk(blocks):
    for b in blocks:
        yield b
        body = b.get(b.get("type", ""))
        kids = body.get("children") if isinstance(body, dict) else None
        if kids:
            yield from _walk(kids)
