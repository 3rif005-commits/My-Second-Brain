"""The adapter: the engine's only door to Notion.

The engine hands it IR and ids; it returns plain dataclasses. Every Notion
shape (payloads, property names, parents, block ids) stays in this package.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from services.portable import ir
from services.portable.canonical import digest
from services.portable.losses import Loss, dedupe

import copy

from .chunker import children_of, plan_steps
from .client import NotionClient
from .adapter_emoji import looks_like_emoji
from .errors import AmbiguousWrite, NotionError
from .files import (DEFAULT_CAP, FileSource, FileTooLarge, FileUnavailable, HttpFileSource,
                    upload_name)
from .richtext import plain_rich, rich_text, split_units
from .writers.rich import SB_FILE
from .writers import write_block

from .properties import (SB_ID_PROP, SCHEMA, TITLE_PROP, row_properties, sb_id_value,
                         title_value)
from .richtext import DB_RESOLVER, RESOLVER
from .writers.rich import DB_EMBED

NOTES_DB_TITLE = "Notes"
ARCHIVE_TITLE = "🗄 Deleted in Second Brain"


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
    props: dict = field(default_factory=dict)      # a note's database properties


def page_url(page_id: str) -> str:
    return "https://www.notion.so/" + page_id.replace("-", "")


def _plain(rt: list[dict]) -> str:
    return "".join(t.get("plain_text", "") for t in rt or [])


class NotionAdapter:
    def __init__(self, client: NotionClient, files: FileSource | None = None):
        self.c = client
        self.files = files or HttpFileSource()
        self._cap: int | None = None
        self._cache: dict[str, object] = {}              # files fetched during this send
        self._run_losses: list[Loss] = []                # losses found while writing (files)

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
    def render(self, obj: ir.Obj, resolver=None, db_page=None) -> Rendered:
        """Pure. `resolver(note_id)` says how a link to another note is written; `db_page(database_id)`
        says whether an embedded database already exists in Notion (and its id)."""
        token, token2 = RESOLVER.set(resolver), DB_RESOLVER.set(db_page)
        try:
            return self._render(obj)
        finally:
            RESOLVER.reset(token)
            DB_RESOLVER.reset(token2)

    def _render(self, obj: ir.Obj) -> Rendered:
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
        _drop_nested_anchors(blocks, losses)
        pending = sum(1 for b in _walk(blocks) if SB_FILE in (b.get(b.get("type", ""), {}) or {}))
        pending += 1 if obj.cover else 0
        props = row_properties(obj, losses) if obj.kind == "page" else {}
        return Rendered(title, icon, blocks, src, dedupe(losses), cover_url=obj.cover, pending_files=pending,
                        props=props)

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

    def take_losses(self) -> list[Loss]:
        out, self._run_losses = self._run_losses, []
        return out

    def materialize_cover(self, r: Rendered) -> Rendered:
        """Resolve only the cover. Bodies are resolved block by block as they are written, so a
        block that did not change is never fetched or uploaded again."""
        if not r.cover_url or r.cover:
            return r
        out = copy.copy(r)
        out.losses = list(r.losses)
        out.cover = self._resolve_cover(r.cover_url, out.losses, self._cache)
        out.losses = dedupe(out.losses)
        return out

    def materialize_blocks(self, blocks: list[dict]) -> list[dict]:
        out = copy.deepcopy(blocks)
        for b in _walk(out):
            body = b.get(b.get("type", ""))
            if isinstance(body, dict) and SB_FILE in body:
                self._resolve_block(b, body, self._run_losses, self._cache)
        return out

    def _cap_bytes(self) -> int:
        if self._cap is None:
            try:
                self._cap = self.whoami().max_upload_bytes or DEFAULT_CAP
            except NotionError:
                self._cap = DEFAULT_CAP
        return self._cap

    def _file_ref(self, url: str, name: str, losses: list[Loss], cache: dict, inline: str | None = None,
                  mime: str = "") -> dict | None:
        """-> {"type": "external", ...} | {"type": "file_upload", ...} | None (a note is shown).
        `inline` is content we hold ourselves (an interactive block's HTML): uploaded, never fetched."""
        if inline is None and self.files.is_public_link(url):
            return {"type": "external", "external": {"url": url}}
        cap = self._cap_bytes()
        key = f"{url}"
        try:
            if inline is not None:
                from .files import Fetched
                data = inline.encode("utf-8")
                if len(data) > cap:
                    raise FileTooLarge(len(data))
                f = Fetched(data, mime or "text/html", name)
            else:
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
        ref = self._file_ref(ph.get("url", ""), ph.get("name", ""), losses, cache, ph.get("inline"), ph.get("mime", ""))
        if ref is None:
            label = ph.get("name") or ph.get("url", "").rsplit("/", 1)[-1].split("?")[0] or ph["kind"]
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
    def create_notes_database(self, parent_page_id: str) -> DbInfo:
        db = self.c.post("/databases", {
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": plain_rich(NOTES_DB_TITLE), "is_inline": True,
            "initial_data_source": {"properties": SCHEMA}}, create=True)
        return DbInfo(db["id"], (db.get("data_sources") or [{}])[0].get("id", ""),
                      db.get("created_time"))

    def ensure_schema(self, data_source_id: str) -> int:
        """Keep the Notes schema in step: add any property it lacks (an older
        database made before a property existed). One read; a write only when
        something is missing. -> number of properties added."""
        have = self.c.get(f"/data_sources/{data_source_id}").get("properties") or {}
        missing = {k: v for k, v in SCHEMA.items() if k not in have}
        if missing:
            self.c.patch(f"/data_sources/{data_source_id}", {"properties": missing})
        return len(missing)

    def find_notes_databases(self, root_page_id: str) -> list[DbInfo]:
        return self.find_databases(root_page_id, NOTES_DB_TITLE)

    def find_databases(self, page_id: str, title: str) -> list[DbInfo]:
        """Reconcile: databases with this title directly under a page, oldest first."""
        found: list[DbInfo] = []
        for b in self._children(page_id):
            if b.get("type") == "child_database" and (b.get("child_database") or {}).get("title") == title:
                db = self.c.get(f"/databases/{b['id']}")
                found.append(DbInfo(db["id"], (db.get("data_sources") or [{}])[0].get("id", ""),
                                    db.get("created_time") or b.get("created_time")))
        return sorted(found, key=lambda d: d.created_time or "")

    # ---- rows ---------------------------------------------------------------------
    # ---- user databases (M6) ------------------------------------------------------------
    def create_database(self, parent_page_id: str, r: Rendered, props: dict, *, inline: bool,
                        description: list[dict] | None = None) -> DbInfo:
        """A database with its first data source and the scalar properties. Relations,
        rollups and formulas are added afterwards (they need the other data sources)."""
        body: dict = {"parent": {"type": "page_id", "page_id": parent_page_id}, "title": r.title,
                      "is_inline": inline, "initial_data_source": {"properties": props}}
        if r.icon:
            body["icon"] = r.icon
        if r.cover:
            body["cover"] = r.cover
        if description:
            body["description"] = description
        db = self.c.post("/databases", body, create=True)
        return DbInfo(db["id"], (db.get("data_sources") or [{}])[0].get("id", ""), db.get("created_time"))

    def data_source_props(self, ds_id: str) -> dict[str, dict]:
        """name -> {"id", "type"} of the properties a data source has right now."""
        have = self.c.get(f"/data_sources/{ds_id}").get("properties") or {}
        return {n: {"id": p.get("id"), "type": p.get("type")} for n, p in have.items()}

    def patch_data_source(self, ds_id: str, props: dict) -> dict:
        return self.c.patch(f"/data_sources/{ds_id}", {"properties": props})

    def patch_database(self, database_id: str, r: Rendered, description: list[dict] | None = None) -> None:
        body: dict = {"title": r.title}
        if r.icon:
            body["icon"] = r.icon
        if description is not None:
            body["description"] = description
        self.c.patch(f"/databases/{database_id}", body)

    # ---- views (M7) --------------------------------------------------------------------------
    def list_view_ids(self, database_id: str) -> list[str]:
        out, cursor = [], None
        while True:
            params = {"database_id": database_id, **({"start_cursor": cursor} if cursor else {})}
            res = self.c.get("/views", params=params)
            out += [v["id"] for v in res.get("results", [])]
            if not res.get("has_more"):
                return out
            cursor = res.get("next_cursor")

    def get_view(self, view_id: str) -> dict:
        return self.c.get(f"/views/{view_id}")

    def create_view(self, database_id: str, data_source_id: str, payload: dict, *, dashboard_id: str | None = None) -> str:
        body = {"database_id": database_id, "data_source_id": data_source_id, **payload}
        if dashboard_id:
            body["dashboard_view_id"] = dashboard_id
        return self.c.post("/views", body, create=True)["id"]

    def create_dashboard(self, database_id: str, data_source_id: str, payload: dict) -> str:
        """A dashboard needs a data source too (verified live), though its widgets carry their own."""
        return self.c.post("/views", {"database_id": database_id, "data_source_id": data_source_id, **payload}, create=True)["id"]

    def patch_view(self, view_id: str, payload: dict) -> None:
        body = {k: v for k, v in payload.items() if k != "type"}
        self.c.patch(f"/views/{view_id}", body)

    def delete_view(self, view_id: str) -> None:
        self.c.delete(f"/views/{view_id}")

    def create_row(self, data_source_id: str, r: Rendered, sb_id: str, title_prop: str = TITLE_PROP) -> str:
        """Create the (empty) row. Returns the page id. Never retried blindly:
        an unknown outcome raises AmbiguousWrite and the engine reconciles."""
        body: dict = {"parent": {"type": "data_source_id", "data_source_id": data_source_id},
                      "properties": {title_prop: {"title": r.title}, SB_ID_PROP: sb_id_value(sb_id), **r.props}}
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

    def update_properties(self, page_id: str, r: Rendered, *, row: bool = True, title_prop: str = TITLE_PROP) -> None:
        body: dict = {"properties": {(title_prop if row else "title"): {"title": r.title}, **r.props}}
        if r.icon:
            body["icon"] = r.icon
        if r.cover:
            body["cover"] = r.cover
        self.c.patch(f"/pages/{page_id}", body)

    def page_markdown(self, page_id: str) -> str:
        """What the page looks like in Notion right now, as markdown (one read)."""
        return self.c.get(f"/pages/{page_id}/markdown").get("markdown", "")

    def top_level_ids(self, page_id: str, *, content_only: bool = False) -> list[str]:
        """Ids of a page's top-level blocks. `content_only` leaves out the sub-pages and
        databases that sit on a collection's page: those are structure we manage."""
        return [b["id"] for b in self._children(page_id)
                if not (content_only and b.get("type") in ("child_page", "child_database"))]

    def delete_all_top_level(self, page_id: str) -> int:
        """Overwrite only: removes EVERY top-level block, including ones a person added in
        Notion. Reached only after the user chose Overwrite (and confirmed it)."""
        ids = self.top_level_ids(page_id)
        self.delete_blocks(ids)
        return len(ids)

    # ---- plain pages: collections and the archive -------------------------------------
    def create_page(self, parent_page_id: str, r: Rendered) -> str:
        body: dict = {"parent": {"type": "page_id", "page_id": parent_page_id},
                      "properties": {"title": {"title": r.title}}}
        if r.icon:
            body["icon"] = r.icon
        if r.cover:
            body["cover"] = r.cover
        return self.c.post("/pages", body, create=True)["id"]

    def find_child_pages(self, parent_page_id: str, title: str) -> list[tuple[str, str]]:
        """Reconcile: child pages of `parent` with this title, oldest first."""
        out = [(b["id"], b.get("created_time", "")) for b in self._children(parent_page_id)
               if b.get("type") == "child_page" and (b.get("child_page") or {}).get("title") == title]
        return sorted(out, key=lambda x: x[1])

    def move_page(self, page_id: str, *, under_page: str | None = None, under_source: str | None = None) -> None:
        """Move a page (a row, a collection page) to a new parent. Repeating it is harmless."""
        parent = ({"type": "page_id", "page_id": under_page} if under_page
                  else {"type": "data_source_id", "data_source_id": under_source})
        self.c.post(f"/pages/{page_id}/move", {"parent": parent}, idempotent=True)

    # ---- bodies --------------------------------------------------------------------
    def append_body(self, page_id: str, r: Rendered, on_blocks=None, on_pending=None) -> list[dict]:
        """Append the whole body. `on_blocks(entries)` is called after every
        request with the top-level blocks that landed, so a crash leaves an exact
        record of what is on the page."""
        return self._append_blocks(page_id, r.blocks, r.block_src, on_blocks, on_pending)

    def _append_blocks(self, page_id: str, blocks: list[dict], block_src: list[str], on_blocks=None,
                       on_pending=None, after: str | None = None) -> list[dict]:
        """`after`: None = the end of the page; "start" = the top; an id = right behind that block."""
        placed: list[dict] = []
        i = 0
        for step in plan_steps(blocks):
            if on_pending:       # write-ahead: what is about to land, so a crash can be reconciled
                on_pending({"count": len(step.blocks), "types": [b.get("type") for b in step.blocks]})
            anchor = (placed[-1]["id"] if placed else (None if after is None else after if after != "start" else "start"))
            ids = self._append(page_id, self.materialize_blocks(step.blocks), {e["id"] for e in placed}, anchor)
            entries = [{"id": bid, "src": block_src[i + k], **_fingerprint(blocks[i + k])}
                       for k, bid in enumerate(ids)]
            i += len(step.blocks)
            placed += entries
            if on_blocks:
                on_blocks(entries)
            for d in step.deferred:
                self._append_tree(self._resolve(ids, d.path), self.materialize_blocks(d.children))
        return placed

    def _sync_with_anchors(self, page_id: str, r: Rendered, old: list[dict], on_top=None) -> list[dict]:
        """A page with an embedded database: the database block is an anchor we do not own. Our
        own blocks are replaced around it: what comes before it is inserted at the start (or after
        the previous anchor), what comes after it right behind it (T3: the position is exact)."""
        top = [dict(e) for e in old if e.get("t") == "child_database"]          # anchors stay
        mine = [e for e in old if e.get("t") != "child_database"]

        def gone(bid):
            if on_top:
                on_top(top + [e for e in mine if e["id"] != bid], None)
            mine[:] = [e for e in mine if e["id"] != bid]
        self.delete_blocks([e["id"] for e in mine], on_deleted=gone)
        # segments of blocks between anchors
        segs: list[tuple[list[dict], list[str], str | None]] = []   # (blocks, src, id of the anchor BEFORE them)
        cur_b: list[dict] = []
        cur_s: list[str] = []
        prev_anchor: str | None = None
        order: list[dict] = []                                       # final order of our index entries
        for b, src in zip(r.blocks, r.block_src):
            if b.get("type") == DB_EMBED:
                segs.append((cur_b, cur_s, prev_anchor))
                prev_anchor = b[DB_EMBED]["database_id"]
                cur_b, cur_s = [], []
            else:
                cur_b.append(b)
                cur_s.append(src)
        segs.append((cur_b, cur_s, prev_anchor))
        placed_order: list[dict] = []
        known_anchor = {e["id"] for e in top}
        for blocks, srcs, anchor in segs:
            if anchor is not None:
                if anchor not in known_anchor:
                    top.append({"id": anchor, "src": "", "t": "child_database", "h": "anchor", "ch": None, "tg": False})
                    known_anchor.add(anchor)
                placed_order.append(next(e for e in top if e["id"] == anchor))
            if not blocks:
                continue
            entries: list[dict] = []

            def landed(es):
                entries.extend(es)
                if on_top:
                    on_top(placed_order + entries, None)
            self._append_blocks(page_id, blocks, srcs, landed,
                                (lambda p: on_top(placed_order + entries, {**p, "after": anchor})) if on_top else None,
                                after=anchor if anchor else "start")
            placed_order += entries
        if on_top:
            on_top(placed_order, None)
        return placed_order

    # Block types whose text/flags can be changed in place (no children, nothing immutable).
    _PATCHABLE = {"paragraph", "heading_1", "heading_2", "heading_3", "heading_4", "bulleted_list_item",
                  "numbered_list_item", "to_do", "quote", "code", "toggle", "divider"}

    def _patch_payload(self, block: dict) -> dict | None:
        t = block["type"]
        body = dict(block.get(t) or {})
        body.pop("children", None)
        if t == "divider":
            return None
        body.pop("is_toggleable", None)          # cannot be changed in place (a change makes a rebuild)
        if t != "code":
            body.setdefault("color", "default")          # an omitted colour would leave the old one
        else:
            body.setdefault("caption", [])
        return {t: body}

    def sync_body(self, page_id: str, r: Rendered, old: list[dict], on_top=None) -> list[dict]:
        """Bring the page's body to `r` touching as little as possible (ADR-06): blocks
        whose hash is unchanged are left alone, a changed text block is PATCHed in place
        (its Notion id, and so any comment on it, survives; its children are untouched when
        they did not change), blocks added at the end are appended, blocks removed from the
        end are deleted. Anything else (a block inserted in the middle, a type change, nested
        content that changed) rebuilds the body. Only blocks WE created (the ids in `old`)
        are ever deleted or patched."""
        new = r.blocks
        if any(b.get("type") == DB_EMBED for b in new):
            return self._sync_with_anchors(page_id, r, old, on_top)
        fps = [_fingerprint(b) for b in new]
        top = [dict(e) for e in old]
        n = min(len(top), len(new))
        patches: list[int] = []
        keep = 0
        while keep < n:
            o, f = top[keep], fps[keep]
            if o.get("h") == f["h"] and o.get("ch") == f["ch"]:
                pass
            elif (o.get("h") is not None and o.get("t") == f["t"] and o.get("ch") == f["ch"]
                  and o.get("tg") == f["tg"] and f["t"] in self._PATCHABLE
                  and self._patch_payload(new[keep]) is not None):
                patches.append(keep)
            else:
                break
            keep += 1
        if keep < n:                                     # structure changed: rebuild
            def gone(bid):
                top[:] = [e for e in top if e["id"] != bid]
                if on_top:
                    on_top(top, None)
            self.delete_blocks([e["id"] for e in top], on_deleted=gone)
            top.clear()
            patches, keep = [], 0
        for i in patches:
            self.c.patch(f"/blocks/{top[i]['id']}", self._patch_payload(new[i]))
            top[i].update(fps[i], src=r.block_src[i])
            if on_top:
                on_top(top, None)
        if len(top) > len(new):                          # blocks removed at the end
            def gone2(bid):
                top[:] = [e for e in top if e["id"] != bid]
                if on_top:
                    on_top(top, None)
            self.delete_blocks([e["id"] for e in top[len(new):]], on_deleted=gone2)
        if len(new) > len(top):                          # blocks added at the end (or everything)
            start = len(top)

            def landed(entries):
                top.extend(entries)
                if on_top:
                    on_top(top, None)
            self._append_blocks(page_id, new[start:], r.block_src[start:], landed,
                                (lambda p: on_top(top, p)) if on_top else None)
        return top

    def _append(self, parent_id: str, blocks: list[dict], known: set[str], after: str | None = None) -> list[str]:
        """Append one request. An append is atomic (T1) but a timeout or 5xx
        leaves its outcome unknown, and repeating it could duplicate the
        blocks: so first look at what is on the parent (`known` = ids we have
        already placed there) and only re-send when it provably did not land."""
        try:
            return self._append_once(parent_id, blocks, after)
        except AmbiguousWrite:
            landed = self._landed(parent_id, blocks, known, after)
            if landed is not None:
                return landed
            return self._append_once(parent_id, blocks, after)   # confirmed absent: safe

    def _append_once(self, parent_id: str, blocks: list[dict], after: str | None = None) -> list[str]:
        body: dict = {"children": blocks}
        if after == "start":
            body["position"] = {"type": "start"}
        elif after:
            body["position"] = {"type": "after_block", "after_block": {"id": after}}
        res = self.c.patch(f"/blocks/{parent_id}/children", body, create=True)
        results = res.get("results", [])
        if after:          # VERIFIED live: a positioned insert returns the new blocks FOLLOWED BY every later sibling
            results = results[:len(blocks)]
        ids = [b["id"] for b in results]
        if len(ids) != len(blocks):
            raise NotionError(502, "unexpected_response",
                              f"appended {len(blocks)} blocks, got {len(ids)} back")
        return ids

    def _landed(self, parent_id: str, blocks: list[dict], known: set[str], after: str | None = None) -> list[str] | None:
        """The ids of `blocks` if they sit where they were being inserted (the end, the start, or
        right behind `after`)."""
        kids = self._children(parent_id)
        if after == "start":
            tail = kids[:len(blocks)]
        elif after:
            ids = [k["id"] for k in kids]
            at = ids.index(after) + 1 if after in ids else len(kids)
            tail = kids[at:at + len(blocks)]
        else:
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

    def reclaim_pending(self, page_id: str, pending: dict, known: set[str]) -> list[dict]:
        """A previous send died between an append landing and its bookkeeping. If the
        last children of the page are exactly the blocks it was about to write (and we
        have no record of them), they are ours: hand their ids back so they are replaced
        instead of duplicated."""
        n, types = int(pending.get("count") or 0), list(pending.get("types") or [])
        if n <= 0:
            return []
        kids = self._children(page_id)
        after = pending.get("after")
        if after == "start" or (after is None and "after" in pending):
            tail = kids[:n]
        elif after:
            ids = [k["id"] for k in kids]
            at = ids.index(after) + 1 if after in ids else len(kids)
            tail = kids[at:at + n]
        else:
            tail = kids[-n:]
        if len(tail) == n and all(b["id"] not in known and b.get("type") == t for b, t in zip(tail, types)):
            return [{"id": b["id"], "src": ""} for b in tail]
        return []

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


def _fingerprint(block: dict) -> dict:
    """What we remember about a top-level block we wrote: a hash of the block itself, one of
    what is nested inside it, its type, and whether a heading is a toggle."""
    t = block.get("type", "")
    body = block.get(t) if isinstance(block.get(t), dict) else {}
    kids = body.get("children")
    own = {**block, t: {k: v for k, v in body.items() if k != "children"}}
    return {"t": t, "h": digest(own), "ch": digest(kids) if kids else None, "tg": bool(body.get("is_toggleable"))}


def _drop_nested_anchors(blocks: list[dict], losses: list[Loss]) -> None:
    """An embedded database can only be anchored between top-level blocks."""
    def clean(lst: list[dict], top: bool) -> None:
        for b in list(lst):
            if b.get("type") == DB_EMBED and not top:
                lst.remove(b)
                losses.append(Loss("approximated", "An embedded database inside another block.",
                                   "It is placed on the page instead.", "db_embed_nested"))
                continue
            body = b.get(b.get("type", ""))
            kids = body.get("children") if isinstance(body, dict) else None
            if kids:
                clean(kids, False)
    clean(blocks, True)
