"""Build and verify a backup archive.

second-brain-backup-2026-10-08T03-00Z.sbz   (a zip)
  manifest.json      {format: "sbz", format_version: 1, ir_version, created_at, counts, files: {path: sha256}}
  README.md          how to read it without the app
  collections.json   the folder tree
  notes/<id>.json    the note exactly as stored (raw BlockNote JSON + its columns): lossless
  notes/<id>.ir.json the same note in the portable IR
  notes/<id>.md      the same note as readable markdown
  databases/<id>/{schema.json, views.json, rows.jsonl, rows.csv}
  threads/<id>.json  chat threads (messages marked private ARE kept: the archive stays on this machine)
  skills/<name>/...  every skill file
  files/<sha256>     every stored source file, deduplicated; manifest.files_index maps them to notes
Secrets (AI provider keys, MCP servers, grants) are never read.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from services.portable import ir, markdown
from services.portable.canonical import canonical

FORMAT = "sbz"
FORMAT_VERSION = 1
MAX_FILE_BYTES = 50 * 1024 * 1024

README = """# Second Brain backup

This is a zip file. You do not need the app to read it.

- `notes/<id>.md`    each note as plain markdown, to read
- `notes/<id>.json`  each note exactly as the app stores it (the original; use this to restore)
- `notes/<id>.ir.json` each note in a neutral format (blocks, text, marks) that does not depend on the editor
- `collections.json` your folders and how they nest (`parent_id`)
- `databases/<id>/rows.csv` every database as a spreadsheet; `schema.json` and `views.json` describe it
- `threads/` your chats, `skills/` your skills
- `files/<sha256>` the files attached to notes, named by their content; `manifest.json` says which note each belongs to
- `manifest.json` lists every file with its sha256 so you can check nothing is damaged

Private notes ARE in this archive. Keep it where you keep your private notes.
"""


def _json(obj) -> bytes:
    return json.dumps(obj, indent=1, ensure_ascii=False, default=str).encode("utf-8")


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in name)[:80] or "x"


def _select(db, table: str, user_id: str, **eq) -> list[dict]:
    q = db.table(table).select("*").eq("user_id", user_id)
    for k, v in eq.items():
        q = q.eq(k, v)
    return q.execute().data or []


def build(db, user_id: str, out: Path, *, storage_download=None, skills_dirs: list[Path] | None = None,
          max_file_bytes: int = MAX_FILE_BYTES, now: datetime | None = None) -> dict:
    """Write the archive to `out`; returns its manifest. Never raises for one bad item: it is listed
    in `manifest.problems` and the rest is written."""
    from services.notion_sync import registry
    from services.notion_sync.readers.note import note_to_ir
    now = now or datetime.now(timezone.utc)
    files: dict[str, bytes] = {}
    problems: list[dict] = []
    counts = {"notes": 0, "deleted_notes": 0, "collections": 0, "databases": 0, "rows": 0, "threads": 0, "skills": 0, "files": 0}

    def put(path: str, data: bytes):
        files[path] = data

    collections = _select(db, "collections", user_id)
    put("collections.json", _json(collections))
    counts["collections"] = len(collections)

    rows_of = {str(r["note_id"]): r for r in _select(db, "db_row_props", user_id)}
    for n in _select(db, "notes", user_id):
        nid = str(n["id"])
        try:
            put(f"notes/{nid}.json", _json({"note": n, "db_row": rows_of.get(nid)}))
            obj = note_to_ir(n)
            put(f"notes/{nid}.ir.json", _json(obj.to_dict()))
            md = f"# {n.get('title') or 'Untitled'}\n\n" + markdown.to_markdown(obj.body) + "\n"
            put(f"notes/{nid}.md", md.encode("utf-8"))
            counts["deleted_notes" if n.get("deleted_at") else "notes"] += 1
        except Exception as e:                                           # one broken note must not stop the backup
            problems.append({"kind": "note", "id": nid, "error": type(e).__name__})
            put(f"notes/{nid}.json", _json({"note": n, "error": "could not be converted"}))

    all_titles: dict[str, str] | None = None
    for d in _select(db, "db_databases", user_id):
        did = str(d["id"])
        try:
            srcs = db.table("db_data_sources").select("*").eq("database_id", did).execute().data or []
            schema = {"database": d, "data_sources": []}
            rows_out, rows_csv = [], []
            for s in srcs:
                props = db.table("db_properties").select("*").eq("data_source_id", s["id"]).order("position").execute().data or []
                schema["data_sources"].append({"source": s, "properties": props})
                if s.get("system_kind"):
                    continue
                rps = db.table("db_row_props").select("*").eq("data_source_id", s["id"]).execute().data or []
                if rps and all_titles is None:
                    all_titles = {str(n["id"]): n.get("title") for n in db.table("notes").select("id, title").eq("user_id", user_id).execute().data or []}
                titles = all_titles or {}
                for rp in rps:
                    rows_out.append({"data_source_id": s["id"], **rp})
                    rows_csv.append({"id": rp["note_id"], "title": titles.get(str(rp["note_id"]), ""),
                                     **{p["name"]: _cell((rp.get("properties") or {}).get(p["key"]) or (rp.get("computed") or {}).get(p["key"]))
                                        for p in props if p["type"] != "title"}})
            put(f"databases/{did}/schema.json", _json(schema))
            put(f"databases/{did}/views.json", _json(db.table("db_views").select("*").in_("data_source_id", [s["id"] for s in srcs]).execute().data or []))
            put(f"databases/{did}/rows.jsonl", "\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in rows_out).encode("utf-8"))
            put(f"databases/{did}/rows.csv", _csv(rows_csv))
            links = db.table("db_relation_links").select("*").eq("user_id", user_id).execute().data or []
            put(f"databases/{did}/links.json", _json(links))
            counts["databases"] += 1
            counts["rows"] += len(rows_out)
        except Exception as e:
            problems.append({"kind": "database", "id": did, "error": type(e).__name__})

    for t in _select(db, "chat_threads", user_id):
        put(f"threads/{t['id']}.json", _json(t))
        counts["threads"] += 1

    skills_dirs = skills_dirs or []
    seen_skills: set[str] = set()
    for root in skills_dirs:                                            # user copies first: they win
        if not root.exists():
            continue
        for p in sorted(root.rglob("*")):
            if p.is_file() and p.suffix in (".md", ".txt"):
                rel = p.relative_to(root)
                name = rel.parts[0].removesuffix(".md")
                key = f"skills/{rel.as_posix()}"
                if key not in files:
                    put(key, p.read_bytes())
                if name not in seen_skills:
                    seen_skills.add(name)
                    counts["skills"] += 1

    index: dict[str, list[dict]] = {}
    skipped: list[dict] = []
    if storage_download is not None:
        for r in _select(db, "note_resources", user_id):
            path = r.get("storage_path")
            if not path:
                continue
            try:
                data = storage_download(path)
            except Exception as e:
                problems.append({"kind": "file", "id": str(r["id"]), "error": type(e).__name__})
                continue
            if len(data) > max_file_bytes:
                skipped.append({"note_id": str(r["note_id"]), "title": r.get("title"), "bytes": len(data), "reason": "larger than the limit"})
                continue
            sha = hashlib.sha256(data).hexdigest()
            if f"files/{sha}" not in files:
                put(f"files/{sha}", data)
                counts["files"] += 1
            index.setdefault(sha, []).append({"note_id": str(r["note_id"]), "title": r.get("title"), "kind": r.get("kind"), "path": path})

    manifest = {"format": FORMAT, "format_version": FORMAT_VERSION, "ir_version": ir.IR_VERSION,
                "created_at": now.isoformat(timespec="seconds"), "mapper_set_version": registry.mapper_set_version(),
                "user_id": user_id, "counts": counts, "files_index": index, "files_skipped": skipped, "problems": problems,
                "files": {p: hashlib.sha256(b).hexdigest() for p, b in sorted(files.items())}}
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".part")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", _json(manifest))
        z.writestr("README.md", README)
        for p, b in sorted(files.items()):
            z.writestr(p, b)
    tmp.replace(out)                                                     # a half-written archive never has the real name
    return manifest


def _cell(wrapper):
    if not isinstance(wrapper, dict):
        return ""
    t = wrapper.get("type")
    v = wrapper.get(t) if t else None
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    if isinstance(v, dict):
        return " → ".join(str(x) for x in (v.get("start"), v.get("end")) if x)
    return "" if v is None else str(v)


def _csv(rows: list[dict]) -> bytes:
    if not rows:
        return b""
    cols = list(dict.fromkeys(k for r in rows for k in r))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols)
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue().encode("utf-8")


def read_manifest(path: Path) -> dict:
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read("manifest.json"))


def verify(path: Path) -> list[str]:
    """Every file in the manifest exists and matches its sha256; nothing extra is in the zip. -> problems."""
    bad: list[str] = []
    with zipfile.ZipFile(path) as z:
        if (broken := z.testzip()):
            bad.append(f"damaged zip entry: {broken}")
        m = json.loads(z.read("manifest.json"))
        if m.get("format") != FORMAT:
            bad.append("not a Second Brain backup")
        if m.get("format_version", 0) > FORMAT_VERSION:
            bad.append("made by a newer version of the app")
        names = set(z.namelist()) - {"manifest.json", "README.md"}
        for p, sha in (m.get("files") or {}).items():
            if p not in names:
                bad.append(f"missing: {p}")
            elif hashlib.sha256(z.read(p)).hexdigest() != sha:
                bad.append(f"does not match its checksum: {p}")
        bad += [f"not in the manifest: {p}" for p in sorted(names - set(m.get("files") or {}))]
    return bad
