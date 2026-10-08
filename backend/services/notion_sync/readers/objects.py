"""Chat threads, skills and note sources -> IR (the rest of the brain, D5)."""
from __future__ import annotations

from pathlib import Path

import yaml

from services.portable import ir, markdown_in
from services.portable.losses import Loss

MAX_REFERENCE_CHARS = 60_000
USER_ICON, ASSISTANT_ICON = "🧑", "🤖"


def thread_title(row: dict) -> str:
    t = (row.get("title") or "").strip()
    if t:
        return t
    for m in row.get("messages") or []:
        if isinstance(m, dict) and m.get("role") == "user" and (m.get("content") or "").strip():
            return m["content"].strip().splitlines()[0][:80]
    return "Untitled chat"


def thread_to_ir(row: dict) -> ir.Obj:
    """One callout per message, the markdown of the message inside it. Messages marked
    private are NOT sent (they stay on this machine) and the page says how many."""
    body: list[ir.Block] = []
    private = 0
    for m in row.get("messages") or []:
        if not isinstance(m, dict):
            continue
        if m.get("private"):
            private += 1
            continue
        text = m.get("content")
        if not isinstance(text, str) or not text.strip():
            continue
        user = m.get("role") == "user"
        body.append(ir.Block("callout", attrs={"variant": "USER" if user else "ASSISTANT",
                                               "icon": USER_ICON if user else ASSISTANT_ICON,
                                               "color": "gray" if user else "blue"},
                             children=markdown_in.blocks(text)))
    losses = []
    if private:
        losses.append(Loss("lossy", f"{private} private message(s) in this chat.",
                           "They are not sent; the page does not show where they were.", "thread_private_messages"))
    return ir.Obj(kind="page", ref=ir.Ref("thread", str(row["id"])), title=[ir.Text(thread_title(row))], icon="💬",
                  props={"pinned": bool(row.get("pinned")), "mode": row.get("model_mode")},
                  meta={"created_at": row.get("created_at"), "updated_at": row.get("updated_at")},
                  body=body, losses=losses)


# ---- skills ---------------------------------------------------------------------------------------

def _split(raw: str) -> tuple[dict, str]:
    head, sep, body = raw.partition("\n---\n")
    if sep and head.startswith("---"):
        try:
            return (yaml.safe_load(head[3:]) or {}), body
        except yaml.YAMLError:
            return {}, raw
    return {}, raw


def load_skills(dirs: list[Path]) -> dict[str, dict]:
    """Every skill by name, from the folders given in priority order (a user's edited copy wins)."""
    found: dict[str, dict] = {}
    for root in reversed(dirs):                                    # lowest priority first, overwritten
        if not root.exists():
            continue
        for p in sorted(root.iterdir()):
            if p.is_dir() and (p / "SKILL.md").exists():
                meta, body = _split((p / "SKILL.md").read_text(encoding="utf-8"))
                refs = {}
                for sub in ("reference", "references"):
                    d = p / sub
                    if d.is_dir():
                        for f in sorted(d.iterdir()):
                            if f.is_file() and f.suffix in (".md", ".txt"):
                                refs[f"{sub}/{f.name}"] = f.read_text(encoding="utf-8")
                found[p.name] = {"meta": meta, "body": body, "refs": refs}
            elif p.is_file() and p.suffix == ".md":
                meta, body = _split(p.read_text(encoding="utf-8"))
                found[p.stem] = {"meta": meta, "body": body, "refs": {}}
    return found


def skill_to_ir(name: str, skill: dict) -> ir.Obj:
    meta, body = skill.get("meta") or {}, skill.get("body") or ""
    blocks: list[ir.Block] = []
    facts = [f"{k}: {meta[k]}" for k in ("description", "surfaces", "output") if meta.get(k)]
    if facts:
        blocks.append(ir.Block("callout", attrs={"variant": "NOTE", "icon": "ℹ️", "color": "gray"},
                               children=[ir.Block("paragraph", inline=[ir.Text(f)]) for f in facts]))
    blocks += markdown_in.blocks(body)
    losses: list[Loss] = []
    for fname, text in sorted((skill.get("refs") or {}).items()):
        clipped = text[:MAX_REFERENCE_CHARS]
        if len(text) > len(clipped):
            losses.append(Loss("lossy", f"The end of the reference file “{fname}”.", "It is cut at 60,000 characters.", "skill_reference_clipped"))
        blocks.append(ir.Block("toggle", inline=[ir.Text(f"Reference: {fname}")], children=markdown_in.blocks(clipped)))
    return ir.Obj(kind="page", ref=ir.Ref("skill", name), title=[ir.Text(name)], icon="🧠",
                  props={"where": meta.get("surfaces")}, body=blocks, losses=losses)


# ---- the sources of a note (opt-in) -------------------------------------------------------------------

def sources_block(rows: list[dict]) -> ir.Block | None:
    """A "Sources" toggle at the end of a note: files are uploaded, videos and sites are linked.
    Files are named by their stable storage path ("storage:..."), never a signed URL (it would
    change every time and make the note look edited)."""
    kids: list[ir.Block] = []
    for r in sorted(rows, key=lambda r: r.get("order_index") or 0):
        title = r.get("title") or "Untitled source"
        kind = r.get("kind")
        cap = [ir.Text(title)]
        if kind in ("youtube", "video") and r.get("source_url"):
            kids.append(ir.Block("media", attrs={"kind": "video", "url": r["source_url"], "name": title}, inline=cap))
        elif kind == "website" and r.get("source_url"):
            kids.append(ir.Block("bookmark", attrs={"url": r["source_url"]}, inline=cap))
        elif r.get("storage_path"):
            kids.append(ir.Block("media", attrs={"kind": "file", "url": "storage:" + r["storage_path"], "name": title,
                                                 "mime": r.get("mime_type") or ""}, inline=cap))
        else:
            kids.append(ir.Block("paragraph", inline=cap))
    return ir.Block("toggle", attrs={"sources": True}, inline=[ir.Text("Sources")], children=kids) if kids else None


def add_sources(db, user_id: str, obj: ir.Obj, note_id: str) -> ir.Obj:
    """Append the "Sources" toggle to a note (only called when the user switched sources on)."""
    rows = (db.table("note_resources").select("*").eq("note_id", note_id).eq("user_id", user_id).execute().data or [])
    blk = sources_block(rows)
    if blk is not None:
        obj.body = list(obj.body) + [blk]
    return obj


def skill_dirs() -> list[Path]:
    """User copies first (they win), then the built-in skills."""
    from prompts._skill_text import SKILLS_DIR, USER_SKILLS_DIR
    return [USER_SKILLS_DIR, SKILLS_DIR]
