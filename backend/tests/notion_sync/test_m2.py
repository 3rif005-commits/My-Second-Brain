"""M2: every block type, files, covers, through the engine against the fake Notion."""
import httpx
import pytest

from services.notion_sync.notion.files import FileTooLarge, HttpFileSource
from tests.notion_sync.conftest import T


def B(type_, content=None, props=None, children=None, id_="b"):
    return {"id": id_, "type": type_, "props": props or {}, "content": content if content is not None else [],
            "children": children or []}


def P(text, i="p"):
    return B("paragraph", [T(text)], id_=i)


def sent_tree(world, n):
    pid = world.mapping(n)["notion_id"]
    return world.notion.tree(world.notion.pages[pid]["children"])


def test_table_callout_columns_math_checkpoint_button(world):
    n = world.add_note(content=[
        B("table", {"type": "tableContent", "headerRows": 1, "rows": [
            {"cells": [[T("a")], [T("b")]]}, {"cells": [[T("c")], [T("d")]]}]}),
        B("callout", None, {"calloutType": "TIP"}, [P("tip body")], "c1"),
        B("columnList", None, None, [B("column", None, {"width": 1}, [P("L", "l")], "k1"),
                                      B("column", None, {"width": 1}, [P("R", "r")], "k2")], "cl"),
        B("math", None, {"latex": "x^2"}, id_="m"),
        B("checkpoint", None, {"anchorType": "time", "value": "75", "label": "Idea"}, id_="cp"),
        B("button", None, {"label": "Go", "actionsJson": "[]"}, id_="bt"),
        B("pageBreak", id_="pb"),
    ])
    res, plan = world.send(n)
    assert res.items[0].status == "done", res.items[0].message
    tree = sent_tree(world, n)
    assert [b["type"] for b in tree] == ["table", "callout", "column_list", "equation", "callout", "callout", "divider"]
    assert tree[0]["table"]["children"][0]["table_row"]["cells"][0][0]["text"]["content"] == "a"
    assert tree[0]["table"]["has_column_header"] is True
    assert tree[1]["callout"]["color"] == "green_background"
    assert tree[1]["callout"]["children"][0]["paragraph"]["rich_text"][0]["text"]["content"] == "tip body"
    assert tree[4]["callout"]["rich_text"][0]["text"]["content"] == "Idea · 1:15"
    codes = {loss["code"] for loss in plan.items[0].losses}
    assert {"checkpoint_as_callout", "button_not_runnable", "page_break"} <= codes


def test_public_image_is_linked_not_uploaded(world):
    n = world.add_note(content=[B("image", None, {"url": "https://example.com/a.png", "caption": "Fig"}, id_="i")])
    res, _ = world.send(n)
    assert res.items[0].status == "done"
    img = sent_tree(world, n)[0]["image"]
    assert img["type"] == "external" and img["external"]["url"] == "https://example.com/a.png"
    assert world.files.fetched == [] and world.notion.uploads == {}


def test_own_file_is_downloaded_and_uploaded(world):
    url = "https://files.sb.test/storage/v1/object/sign/x/pic.png?token=abc"
    world.files.blobs[url] = (b"\x89PNG" + b"0" * 1000, "image/png")
    n = world.add_note(content=[B("image", None, {"url": url, "name": "pic.png"}, id_="i"),
                                B("file", None, {"url": url.replace("pic.png", "doc.pdf"), "name": "doc.pdf"}, id_="f")])
    world.files.blobs[url.replace("pic.png", "doc.pdf")] = (b"%PDF" + b"0" * 100, "application/pdf")
    res, plan = world.send(n)
    assert res.items[0].status == "done", res.items[0].message
    tree = sent_tree(world, n)
    assert [b["type"] for b in tree] == ["image", "pdf"]
    assert tree[0]["image"]["type"] == "file_upload"
    up = world.notion.uploads[tree[0]["image"]["file_upload"]["id"]]
    assert up["status"] == "uploaded" and up["filename"] == "pic.png"


def test_second_send_with_files_makes_zero_calls(world):
    url = "https://files.sb.test/p/pic.png?token=abc"
    world.files.blobs[url] = (b"x" * 100, "image/png")
    n = world.add_note(content=[B("image", None, {"url": url, "name": "pic.png"}, id_="i")])
    world.send(n)
    calls, fetched = len(world.notion.calls), len(world.files.fetched)
    res, _ = world.send(n)
    assert len(world.notion.calls) == calls and len(world.files.fetched) == fetched and res.items == []


def test_too_large_unavailable_and_unsupported_become_markers(world):
    big, gone, odd = (f"https://files.sb.test/p/{x}?token=1" for x in ("big.png", "gone.png", "thing.bin"))
    world.files.blobs[big] = (b"x" * (5 * 1024 * 1024 + 10), "image/png")
    world.files.blobs[odd] = (b"x" * 10, "application/octet-stream")
    n = world.add_note(content=[B("image", None, {"url": u, "name": u.split("/")[-1].split("?")[0]}, id_=f"i{k}")
                                for k, u in enumerate((big, gone, odd))])
    res, plan = world.send(n)
    assert res.items[0].status == "done"
    tree = sent_tree(world, n)
    assert [b["type"] for b in tree] == ["callout"] * 3
    assert "could not be copied" in tree[0]["callout"]["rich_text"][0]["text"]["content"]
    codes = {loss["code"] for loss in res.items[0].losses}
    assert {"media_too_large", "media_unavailable", "media_type_unsupported"} <= codes


def test_media_inside_a_callout_and_a_column_is_resolved(world):
    url = "https://files.sb.test/p/pic.png?token=abc"
    world.files.blobs[url] = (b"x" * 10, "image/png")
    img = B("image", None, {"url": url, "name": "pic.png"}, id_="i")
    n = world.add_note(content=[B("callout", None, {}, [img], "c"),
                                B("columnList", None, None, [B("column", None, {}, [img], "k1"), B("column", None, {}, [P("x")], "k2")], "cl")])
    res, _ = world.send(n)
    assert res.items[0].status == "done", res.items[0].message
    tree = sent_tree(world, n)
    assert tree[0]["callout"]["children"][0]["image"]["type"] == "file_upload"


def test_cover_is_uploaded_and_set(world):
    url = "https://files.sb.test/p/cover.jpg?token=abc"
    world.files.blobs[url] = (b"x" * 10, "image/jpeg")
    n = world.add_note(cover_image_url=url)
    res, _ = world.send(n)
    assert res.items[0].status == "done"
    page = world.notion.pages[world.mapping(n)["notion_id"]]
    assert page["cover"]["type"] == "file_upload"


def test_plan_does_not_touch_files_or_notion(world):
    n = world.add_note(content=[B("image", None, {"url": "https://files.sb.test/p/x.png?token=1"}, id_="i")],
                       cover_image_url="https://files.sb.test/c.png?token=1")
    plan = world.plan(n)
    assert world.files.fetched == [] and world.notion.calls == [] and plan.items[0].est_requests >= 6


# ---- the real file source's guard rails -----------------------------------------------

def src(handler, own=("files.sb.test",)):
    return HttpFileSource(set(own), transport=httpx.MockTransport(handler), skip_ip_check=False)


def test_http_source_downloads_own_host():
    s = src(lambda r: httpx.Response(200, content=b"abc", headers={"content-type": "image/png"}))
    f = s.fetch("https://files.sb.test/a/b.png?token=1", 100)
    assert f.data == b"abc" and f.mime == "image/png" and f.name == "b.png"


def test_http_source_refuses_http_and_private_addresses():
    from services.notion_sync.notion.files import FileUnavailable
    s = src(lambda r: httpx.Response(200, content=b"x"))
    for bad in ("http://files.sb.test/a.png", "https://127.0.0.1/a.png", "https://localhost/a.png",
                "https://169.254.169.254/latest/meta-data"):
        with pytest.raises(FileUnavailable):
            s.fetch(bad, 100)


def test_http_source_size_cap_and_errors():
    from services.notion_sync.notion.files import FileUnavailable
    with pytest.raises(FileTooLarge):
        src(lambda r: httpx.Response(200, content=b"x" * 500)).fetch("https://files.sb.test/a", 100)
    with pytest.raises(FileUnavailable):
        src(lambda r: httpx.Response(403)).fetch("https://files.sb.test/a", 100)


def test_http_source_redirect_to_private_is_refused():
    from services.notion_sync.notion.files import FileUnavailable
    s = src(lambda r: httpx.Response(302, headers={"location": "https://127.0.0.1/secret"}))
    with pytest.raises(FileUnavailable):
        s.fetch("https://files.sb.test/a", 100)


def test_public_link_detection():
    s = HttpFileSource({"files.sb.test"})
    assert s.is_public_link("https://example.com/a.png")
    assert not s.is_public_link("https://files.sb.test/a.png")
    assert not s.is_public_link("https://example.com/a.png?X-Amz-Signature=1")
    assert not s.is_public_link("http://example.com/a.png")


# ---- ledger B2: an expired capture URL still works, by its storage path ------------------------------------

def test_storage_path_is_read_out_of_a_signed_url():
    from services.notion_sync.notion.files import storage_path_of
    assert storage_path_of("https://x.supabase.co/storage/v1/object/sign/workspace-resources/u1/r1/frame%201.png?token=abc") == "u1/r1/frame 1.png"
    assert storage_path_of("https://x.supabase.co/storage/v1/object/public/workspace-resources/u1/a.png") == "u1/a.png"
    assert storage_path_of("https://x.supabase.co/storage/v1/object/sign/other-bucket/a.png?token=1") is None
    assert storage_path_of("https://example.com/a.png") is None


def test_an_expired_capture_url_is_fetched_from_storage_by_its_path():
    from services.notion_sync.notion.files import CompositeFiles, HttpFileSource
    dead = httpx.MockTransport(lambda r: httpx.Response(400, json={"error": "token expired"}))
    http = HttpFileSource({"x.supabase.co"}, transport=dead)
    got = CompositeFiles(http, lambda path: b"PIXELS" if path == "u1/r1/frame.png" else (_ for _ in ()).throw(KeyError(path)))
    f = got.fetch("https://x.supabase.co/storage/v1/object/sign/workspace-resources/u1/r1/frame.png?token=EXPIRED", 1000, "frame.png")
    assert f.data == b"PIXELS" and f.name == "frame.png"
    from services.notion_sync.notion.files import FileUnavailable
    with pytest.raises(FileUnavailable):                                      # someone else's host is never rewritten
        got.fetch("https://evil.example/storage/v1/object/sign/workspace-resources/u1/r1/frame.png?token=x", 1000)


# ---- ledger B1: the interactive block is a real block and travels as an uploaded .html embed ----------------

def test_an_interactive_block_is_uploaded_as_html_and_embedded(world):
    n = world.add_note(content=[B("interactive", None, {"title": "Quiz: entropy", "html": "<button onclick=\"this.textContent='ok'\">go</button>"}, id_="i")])
    res, plan = world.send(n)
    assert res.items[0].status == "done", res.items[0].message
    emb = sent_tree(world, n)[0]["embed"]
    assert emb["type"] == "file_upload"
    up = world.notion.uploads[emb["file_upload"]["id"]]
    assert up["filename"] == "Quiz_ entropy.html" or up["filename"].endswith(".html")
    assert up["content_type"] == "text/html" and up["status"] == "uploaded"
    writes = world.notion.writes()
    assert world.send(n)[0].items == [] and world.notion.writes() == writes
    assert world.plan(n).items[0].state == "unchanged"


def test_changing_the_html_of_an_interactive_block_re_uploads_it(world):
    n = world.add_note(content=[B("interactive", None, {"title": "Q", "html": "<p>v1</p>"}, id_="i")])
    world.send(n)
    n["content"][0]["props"]["html"] = "<p>v2</p>"
    assert world.plan(n).items[0].state == "changed"
    res, _ = world.send(n)
    assert res.items[0].status == "done" and len(world.notion.uploads) == 2
