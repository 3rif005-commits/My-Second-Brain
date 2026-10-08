"""Live probe of Notion API behaviour the Send-to-Notion design depends on.

Settles RESEARCH.md §7 questions T1-T10 against a THROWAWAY workspace.

Safety (ROBUSTNESS.md §6):
  * uses NOTION_TEST_TOKEN only, never a user's real connection
  * refuses to run unless the one page shared with the token is titled SB-TEST-…
  * writes only inside a fresh "probe <timestamp>" page under that root
  * raw responses are saved WITHOUT the token, as evidence and as cassettes

Run:  cd backend && .venv/bin/python -m evals.notion_live_probe [--only T1,T3]
Out:  docs/notion-sync/evidence/live/<run>/T#.json + summary.md
"""
from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from core.config import settings

API = "https://api.notion.com/v1"
VERSION = "2026-03-11"
OUT_ROOT = Path(__file__).resolve().parents[2] / "docs" / "notion-sync" / "evidence" / "live"


class Probe:
    def __init__(self, token: str, out: Path):
        self.c = httpx.Client(timeout=60, headers={
            "Authorization": f"Bearer {token}", "Notion-Version": VERSION})
        self.out = out
        self.log: list[dict] = []          # every call of the current test
        self.requests = 0

    # -- transport: 3 req/s ceiling, honours Retry-After ------------------
    def call(self, method: str, path: str, **kw) -> httpx.Response:
        for attempt in range(6):
            time.sleep(0.4)
            self.requests += 1
            r = self.c.request(method, API + path if path.startswith("/") else path, **kw)
            if r.status_code == 429 or r.status_code in (502, 503, 504, 529):
                time.sleep(float(r.headers.get("Retry-After", 2 ** attempt)))
                continue
            break
        body = None
        try:
            body = r.json()
        except Exception:
            body = r.text[:2000]
        self.log.append({"method": method, "path": path,
                         "request": kw.get("json"), "status": r.status_code, "response": body})
        return r

    def j(self, method, path, **kw) -> dict:
        r = self.call(method, path, **kw)
        try:
            return r.json()
        except Exception:
            return {"_status": r.status_code, "_text": r.text[:500]}

    # -- helpers -------------------------------------------------------------
    @staticmethod
    def text(s: str) -> list[dict]:
        return [{"type": "text", "text": {"content": s}}]

    def page(self, parent_id: str, title: str, children: list | None = None) -> dict:
        body = {"parent": {"type": "page_id", "page_id": parent_id},
                "properties": {"title": {"title": self.text(title)}}}
        if children:
            body["children"] = children
        return self.j("POST", "/pages", json=body)

    def para(self, s: str) -> dict:
        return {"type": "paragraph", "paragraph": {"rich_text": self.text(s)}}

    def children(self, block_id: str) -> list[dict]:
        out, cursor = [], None
        while True:
            q = f"/blocks/{block_id}/children?page_size=100" + (f"&start_cursor={cursor}" if cursor else "")
            j = self.j("GET", q)
            out += j.get("results", [])
            if not j.get("has_more"):
                return out
            cursor = j.get("next_cursor")

    def database(self, parent_id: str, title: str, props: dict, inline: bool = False) -> dict:
        return self.j("POST", "/databases", json={
            "parent": {"type": "page_id", "page_id": parent_id},
            "title": self.text(title), "is_inline": inline,
            "initial_data_source": {"properties": props}})

    @staticmethod
    def ds_id(db: dict) -> str | None:
        ds = db.get("data_sources") or []
        return ds[0]["id"] if ds else None

    def save(self, name: str, result: dict):
        (self.out / f"{name}.json").write_text(json.dumps(
            {"result": result, "calls": self.log}, indent=2, ensure_ascii=False))
        self.log = []


# ---- the tests ---------------------------------------------------------------

def t1_append_atomic(p: Probe, run: str) -> dict:
    """Append 3 blocks where the 3rd is invalid (text > 2,000 chars). Half-applied?"""
    pg = p.page(run, "T1 append atomicity")
    r = p.call("PATCH", f"/blocks/{pg['id']}/children", json={"children": [
        p.para("one"), p.para("two"), p.para("x" * 2001)]})
    kids = p.children(pg["id"])
    return {"status": r.status_code, "error_code": (r.json() or {}).get("code") if r.status_code >= 400 else None,
            "children_after": len(kids),
            "verdict": "ATOMIC (nothing applied)" if r.status_code >= 400 and not kids
                       else "NOT ATOMIC" if kids and r.status_code >= 400 else "request succeeded?!"}


def t2_nested_edit_bumps_page(p: Probe, run: str) -> dict:
    """Does editing a NESTED block bump the page's last_edited_time / _by?
    Bot half only: a human edit must be checked by hand (see summary)."""
    pg = p.page(run, "T2 nested edit", [{"type": "toggle", "toggle": {
        "rich_text": p.text("outer"), "children": [p.para("inner")]}}])
    toggle = p.children(pg["id"])[0]
    inner = p.children(toggle["id"])[0]
    before = p.j("GET", f"/pages/{pg['id']}")
    time.sleep(65)                       # last_edited_time is rounded down to the minute
    p.call("PATCH", f"/blocks/{inner['id']}", json={"paragraph": {"rich_text": p.text("inner edited")}})
    after = p.j("GET", f"/pages/{pg['id']}")
    return {"page_id": pg["id"], "inner_block_id": inner["id"],
            "page_last_edited_before": before.get("last_edited_time"),
            "page_last_edited_after": after.get("last_edited_time"),
            "page_last_edited_by_after": (after.get("last_edited_by") or {}).get("id"),
            "bumped": before.get("last_edited_time") != after.get("last_edited_time")}


def t3_inline_db_position(p: Probe, run: str) -> dict:
    """Where does an inline child_database land in the parent's content order?"""
    pg = p.page(run, "T3 inline db position", [p.para("A"), p.para("B")])
    db = p.database(pg["id"], "T3 inline DB", {"Name": {"title": {}}}, inline=True)
    p.call("PATCH", f"/blocks/{pg['id']}/children", json={"children": [p.para("C")]})
    order = [b["type"] if b["type"] != "paragraph"
             else "".join(t["plain_text"] for t in b["paragraph"]["rich_text"])
             for b in p.children(pg["id"])]
    return {"order": order, "db_created": "id" in db, "db_keys": sorted(db.keys())[:20],
            "verdict": "append-order trick works" if order == ["A", "B", "child_database", "C"] else "different"}


def t4_dual_relation(p: Probe, run: str) -> dict:
    """One data-source update with dual_property: is the reverse property created?"""
    pg = p.page(run, "T4 dual relation")
    x = p.database(pg["id"], "T4 X", {"Name": {"title": {}}})
    y = p.database(pg["id"], "T4 Y", {"Name": {"title": {}}})
    xs, ys = p.ds_id(x), p.ds_id(y)
    upd = p.call("PATCH", f"/data_sources/{xs}", json={"properties": {"Ys": {
        "type": "relation", "relation": {"data_source_id": ys, "type": "dual_property",
                                         "dual_property": {"synced_property_name": "Xs"}}}}})
    yschema = p.j("GET", f"/data_sources/{ys}")
    yprops = {k: v.get("type") for k, v in (yschema.get("properties") or {}).items()}
    return {"x_ds": xs, "y_ds": ys, "update_status": upd.status_code, "y_properties": yprops,
            "reverse_created": yprops.get("Xs") == "relation"}


def t5_formulas(p: Probe, run: str) -> dict:
    """Do our formula expressions (prop("Name")) work verbatim? Which come back unsupported?"""
    pg = p.page(run, "T5 formulas")
    exprs = {
        "F_mul": 'prop("A") * 2',
        "F_if": 'if(prop("A") > 2, "big", "small")',
        "F_concat": 'prop("Name") + " (" + format(prop("A")) + ")"',
        "F_date": 'dateBetween(prop("D"), parseDate("2026-01-01"), "days")',
        "F_let": 'let(x, prop("A") + 1, x * x)',
        "F_map": 'prop("Tags").map(current + "!").join(", ")',
        "F_bad": 'nosuchfunction(prop("A"))',
    }
    props = {"Name": {"title": {}}, "A": {"number": {}}, "D": {"date": {}},
             "Tags": {"multi_select": {"options": [{"name": "x"}, {"name": "y"}]}}}
    db = p.database(pg["id"], "T5 DB", props)
    ds = p.ds_id(db)
    results = {}
    for name, expr in exprs.items():
        r = p.call("PATCH", f"/data_sources/{ds}", json={"properties": {name: {"formula": {"expression": expr}}}})
        results[name] = {"expr": expr, "schema_status": r.status_code,
                         "error": (r.json() or {}).get("message") if r.status_code >= 400 else None}
    row = p.j("POST", "/pages", json={"parent": {"type": "data_source_id", "data_source_id": ds}, "properties": {
        "Name": {"title": p.text("row")}, "A": {"number": 3},
        "D": {"date": {"start": "2026-01-11"}}, "Tags": {"multi_select": [{"name": "x"}, {"name": "y"}]}}})
    rowp = p.j("GET", f"/pages/{row.get('id')}") if row.get("id") else {}
    for name in exprs:
        v = (rowp.get("properties") or {}).get(name)
        if v:
            results[name]["value"] = v.get("formula") if v.get("type") == "formula" else v
    return results


def t6_linked_view(p: Probe, run: str) -> dict:
    """Can a second page show the same database (Views API create_database = linked block)?"""
    home = p.page(run, "T6 home of DB")
    other = p.page(run, "T6 other page")
    db = p.database(home["id"], "T6 DB", {"Name": {"title": {}}, "S": {"select": {"options": [{"name": "a"}]}}})
    ds = p.ds_id(db)
    r = p.call("POST", "/views", json={"data_source_id": ds, "name": "Linked from other page", "type": "table",
                                       "create_database": {"parent": {"type": "page_id", "page_id": other["id"]}}})
    kids = [b["type"] for b in p.children(other["id"])]
    schema = p.j("GET", f"/data_sources/{ds}")
    s_id = (schema.get("properties") or {}).get("S", {}).get("id")
    v2 = p.call("POST", "/views", json={"database_id": db.get("id"), "data_source_id": ds,
                                        "name": "Board", "type": "board",
                                        "configuration": {"type": "board", "group_by": {
                                            "type": "select", "property_id": s_id, "sort": {"type": "manual"}}}})
    return {"linked_status": r.status_code, "linked_error": (r.json() or {}).get("message") if r.status_code >= 400 else None,
            "other_page_children": kids, "board_view_status": v2.status_code,
            "board_error": (v2.json() or {}).get("message") if v2.status_code >= 400 else None}


def _upload(p: Probe, name: str, mime: str, data: bytes) -> tuple[httpx.Response, httpx.Response | None]:
    fu = p.call("POST", "/file_uploads", json={"mode": "single_part", "filename": name, "content_type": mime})
    if fu.status_code >= 400:
        return fu, None
    j = fu.json()
    send_url = j.get("upload_url") or f"{API}/file_uploads/{j['id']}/send"
    time.sleep(0.4)
    p.requests += 1
    s = p.c.post(send_url, files={"file": (name, data, mime)})
    p.log.append({"method": "POST", "path": "/file_uploads/{id}/send", "request": f"<{len(data)} bytes {mime}>",
                  "status": s.status_code, "response": s.json() if s.headers.get("content-type", "").startswith("application/json") else s.text[:500]})
    return fu, s


def t7_file_cap(p: Probe, run: str) -> dict:
    """Free-plan per-file cap: 4.9 MiB vs 5.1 MiB."""
    pg = p.page(run, "T7 file cap")
    out = {}
    for label, size in (("4.9MiB", int(4.9 * 1024 * 1024)), ("5.1MiB", int(5.1 * 1024 * 1024))):
        data = os.urandom(size // 2).hex().encode()[:size]   # plain text: .bin is not an accepted extension
        fu, s = _upload(p, f"cap-{label}.txt", "text/plain", data)
        res = {"create_status": fu.status_code,
               "create_error": (fu.json() or {}).get("message") if fu.status_code >= 400 else None}
        if s is not None:
            res["send_status"] = s.status_code
            sj = s.json() if s.headers.get("content-type", "").startswith("application/json") else {}
            res["send_error"] = sj.get("message") if s.status_code >= 400 else None
            if s.status_code < 400:
                a = p.call("PATCH", f"/blocks/{pg['id']}/children", json={"children": [
                    {"type": "file", "file": {"type": "file_upload", "file_upload": {"id": fu.json()["id"]}}}]})
                res["attach_status"] = a.status_code
        out[label] = res
    return out


def t8_html_embed(p: Probe, run: str) -> dict:
    """Upload a small interactive .html and attach it as an embed. JS behaviour needs a human look."""
    pg = p.page(run, "T8 HTML embed (open me in Notion and click the button)")
    html = (b"<!doctype html><html><body style='font-family:sans-serif'>"
            b"<h3>Disco block probe</h3><button onclick=\"this.textContent='JS works: '+(+new Date())\">"
            b"Click me</button></body></html>")
    fu, s = _upload(p, "disco-probe.html", "text/html", html)
    res = {"create_status": fu.status_code, "send_status": s.status_code if s is not None else None}
    if s is not None and s.status_code < 400:
        a = p.call("PATCH", f"/blocks/{pg['id']}/children", json={"children": [
            {"type": "embed", "embed": {"type": "file_upload", "file_upload": {"id": fu.json()["id"]}}}]})
        res["attach_status"] = a.status_code
        res["attach_error"] = (a.json() or {}).get("message") if a.status_code >= 400 else None
        if a.status_code >= 400:   # fall back to a file block so the page still holds it
            b = p.call("PATCH", f"/blocks/{pg['id']}/children", json={"children": [
                {"type": "file", "file": {"type": "file_upload", "file_upload": {"id": fu.json()["id"]}}}]})
            res["file_block_status"] = b.status_code
        res["readback_types"] = [b["type"] for b in p.children(pg["id"])]
    res["page_url"] = pg.get("url")
    return res


def t9_validation(p: Probe, run: str) -> dict:
    """heading_4, code languages, emoji icons, the 2,000-char limit with emoji."""
    pg = p.page(run, "T9 validation")
    pid = pg["id"]

    def try_append(block):
        r = p.call("PATCH", f"/blocks/{pid}/children", json={"children": [block]})
        return {"status": r.status_code, "error": (r.json() or {}).get("message") if r.status_code >= 400 else None}

    out = {"heading_4": try_append({"type": "heading_4", "heading_4": {"rich_text": p.text("h4")}})}
    for lang in ("python", "latex", "plain text", "jsx", "foo-unknown"):
        out[f"code:{lang}"] = try_append({"type": "code", "code": {"rich_text": p.text("x"), "language": lang}})
    emoji = "😀" * 1000                      # 1000 code points = 2000 UTF-16 units
    out["text_1000_emoji"] = try_append(p.para(emoji))
    out["text_1001_emoji"] = try_append(p.para(emoji + "😀"))
    out["text_2000_ascii"] = try_append(p.para("a" * 2000))
    for label, icon in (("emoji_ok", {"type": "emoji", "emoji": "📄"}),
                        ("emoji_flag", {"type": "emoji", "emoji": "🇲🇦"}),
                        ("not_emoji", {"type": "emoji", "emoji": "abc"})):
        r = p.call("PATCH", f"/pages/{pid}", json={"icon": icon})
        out[f"icon:{label}"] = {"status": r.status_code,
                                "error": (r.json() or {}).get("message") if r.status_code >= 400 else None}
    out["equation_1000"] = try_append({"type": "equation", "equation": {"expression": "x" * 1000}})
    out["equation_1001"] = try_append({"type": "equation", "equation": {"expression": "x" * 1001}})
    out["column_list_single"] = try_append({"type": "column_list", "column_list": {"children": [
        {"type": "column", "column": {"children": [p.para("only column")]}}]}})
    return out


def t10_timestamp_columns(p: Probe, run: str) -> dict:
    """Can created_time / last_edited_time / created_by columns be added to a schema?"""
    pg = p.page(run, "T10 timestamp columns")
    db = p.database(pg["id"], "T10 DB", {"Name": {"title": {}}, "Created": {"created_time": {}},
                                         "Edited": {"last_edited_time": {}}, "By": {"created_by": {}},
                                         "ID": {"unique_id": {"prefix": "SB"}}})
    ds = p.ds_id(db)
    schema = p.j("GET", f"/data_sources/{ds}") if ds else {}
    return {"create_db_status": "ok" if ds else db.get("message"),
            "properties": {k: v.get("type") for k, v in (schema.get("properties") or {}).items()}}


TESTS = {"T1": t1_append_atomic, "T3": t3_inline_db_position, "T4": t4_dual_relation,
         "T5": t5_formulas, "T6": t6_linked_view, "T7": t7_file_cap, "T8": t8_html_embed,
         "T9": t9_validation, "T10": t10_timestamp_columns, "T2": t2_nested_edit_bumps_page}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    token = settings.notion_test_token
    if not token:
        raise SystemExit("NOTION_TEST_TOKEN is not set in backend/.env")

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    out = OUT_ROOT / stamp
    out.mkdir(parents=True, exist_ok=True)
    p = Probe(token, out)

    # Guard: exactly the pages shared with the token, and the root must be SB-TEST-…
    found = p.j("POST", "/search", json={"filter": {"property": "object", "value": "page"}, "page_size": 50})
    roots = [r for r in found.get("results", []) if r.get("parent", {}).get("type") == "workspace"]
    titles = ["".join(t["plain_text"] for pr in r["properties"].values() if pr.get("type") == "title" for t in pr["title"]) for r in roots]
    if len(roots) != 1 or not titles[0].startswith("SB-TEST-"):
        raise SystemExit(f"Refusing to run: the shared root must be one page titled SB-TEST-… (found {titles})")
    root = roots[0]["id"]
    me = p.j("GET", "/users/me")
    p.save("_env", {"root": root, "root_title": titles[0], "bot_id": me.get("id"),
                    "workspace": (me.get("bot") or {}).get("workspace_name"), "version": VERSION})

    run = p.page(root, f"probe {stamp}")["id"]
    wanted = [t.strip() for t in args.only.split(",") if t.strip()] or list(TESTS)
    summary = {}
    for name in wanted:
        print(f"--- {name}", flush=True)
        try:
            res = TESTS[name](p, run)
        except Exception as exc:          # a probe failing must not stop the others
            res = {"probe_error": repr(exc)}
        p.save(name, res)
        summary[name] = res
        print(json.dumps(res, ensure_ascii=False)[:1200], flush=True)

    (out / "summary.json").write_text(json.dumps({"run_page": run, "requests": p.requests,
                                                  "results": summary}, indent=2, ensure_ascii=False))
    print(f"\nrequests used: {p.requests} · evidence: {out}")
    print(f"probe page (left in place for the human checks): https://app.notion.com/p/{run.replace('-', '')}")


if __name__ == "__main__":
    main()
