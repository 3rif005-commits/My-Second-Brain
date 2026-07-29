"""Workspaces router — CRUD, resource import + background processing, canvas
layout, media capture, anchors, grounded chat, and AI provider keys."""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import (APIRouter, BackgroundTasks, File, Form, Header,
                     HTTPException, UploadFile)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from routers.ingest import get_user_id
from services.database import get_supabase
from services.workspace import storage
from services.workspace.chat import run_workspace_chat
from services.workspace.media import CaptureError, capture, formula_to_latex
from services.workspace.processor import process_resource
from services.url_extractor import _youtube_video_id as youtube_video_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["workspaces"])

_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".m4v"}
_DOC_EXTS = {".pdf", ".md", ".txt"}


# ── models ───────────────────────────────────────────────────────────────────

class WorkspaceCreate(BaseModel):
    name: str = "Untitled Workspace"
    icon: str = "🗂️"


class WorkspacePatch(BaseModel):
    name: str | None = None
    icon: str | None = None
    viewport: dict | None = None


class PositionPatch(BaseModel):
    title: str | None = None
    pos_x: float | None = None
    pos_y: float | None = None
    width: float | None = None
    height: float | None = None
    z_index: int | None = None


class UrlResource(BaseModel):
    url: str
    pos_x: float = 0
    pos_y: float = 0


class PageCreate(BaseModel):
    note_id: str | None = None
    title: str = "Untitled"
    pos_x: float = 0
    pos_y: float = 0


class CaptureRequest(BaseModel):
    type: str  # frame | clip | audio
    start: float
    end: float | None = None


class FormulaRequest(BaseModel):
    element_id: str


class AnchorRow(BaseModel):
    block_id: str
    resource_id: str
    anchor_type: str
    anchor_start: float
    anchor_end: float = 0


class ChatRequest(BaseModel):
    messages: list[dict]


class ProviderCreate(BaseModel):
    provider: str
    api_key: str
    label: str = ""
    base_url: str | None = None
    chat_model: str | None = None


class ProviderPatch(BaseModel):
    enabled: bool | None = None
    api_key: str | None = None
    chat_model: str | None = None


# ── helpers ──────────────────────────────────────────────────────────────────

def _own_workspace(workspace_id: str, user_id: str) -> dict:
    rows = (get_supabase().table("workspaces").select("*")
            .eq("id", workspace_id).eq("user_id", user_id)
            .is_("deleted_at", "null").execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail={"error": "Workspace not found"})
    return rows[0]


def _own_resource(resource_id: str, user_id: str) -> dict:
    rows = (get_supabase().table("workspace_resources").select("*")
            .eq("id", resource_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail={"error": "Resource not found"})
    return rows[0]


def _resource_public(r: dict) -> dict:
    out = {k: v for k, v in r.items() if k != "summary_html"}
    out["has_summary"] = bool(r.get("summary_html"))
    meta = r.get("meta") or {}
    if meta.get("thumbnail_path"):
        try:
            out["thumbnail_url"] = storage.signed_url(meta["thumbnail_path"], 3600)
        except Exception:
            pass
    return out


# ── workspaces CRUD ──────────────────────────────────────────────────────────

@router.get("/workspaces")
async def list_workspaces(authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    rows = (db.table("workspaces").select("*").eq("user_id", user_id)
            .is_("deleted_at", "null").order("updated_at", desc=True)
            .execute().data or [])
    # resource counts
    for w in rows:
        res = (db.table("workspace_resources").select("id", count="exact")
               .eq("workspace_id", w["id"]).execute())
        w["resource_count"] = res.count or 0
    return rows


@router.post("/workspaces")
async def create_workspace(body: WorkspaceCreate, authorization: str = Header()):
    user_id = get_user_id(authorization)
    row = get_supabase().table("workspaces").insert({
        "user_id": user_id, "name": body.name, "icon": body.icon,
    }).execute().data[0]
    return row


@router.get("/workspaces/{workspace_id}")
async def get_workspace(workspace_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    ws = _own_workspace(workspace_id, user_id)
    db = get_supabase()
    resources = (db.table("workspace_resources").select("*")
                 .eq("workspace_id", workspace_id).order("created_at")
                 .execute().data or [])
    pages = (db.table("workspace_pages").select("*")
             .eq("workspace_id", workspace_id).order("created_at")
             .execute().data or [])
    note_ids = [p["note_id"] for p in pages]
    notes_by_id: dict = {}
    if note_ids:
        nrows = (db.table("notes").select("id,title,content_text,updated_at,deleted_at")
                 .in_("id", note_ids).execute().data or [])
        notes_by_id = {n["id"]: n for n in nrows}
    for p in pages:
        n = notes_by_id.get(p["note_id"]) or {}
        p["note_title"] = n.get("title") or "Untitled"
        p["note_snippet"] = (n.get("content_text") or "")[:180]
        p["note_deleted"] = bool(n.get("deleted_at"))
    ws["resources"] = [_resource_public(r) for r in resources]
    ws["pages"] = [p for p in pages if not p["note_deleted"]]
    return ws


@router.patch("/workspaces/{workspace_id}")
async def patch_workspace(workspace_id: str, body: WorkspacePatch,
                          authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_workspace(workspace_id, user_id)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        return {"ok": True}
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    row = (get_supabase().table("workspaces").update(patch)
           .eq("id", workspace_id).execute().data[0])
    return row


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(workspace_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_workspace(workspace_id, user_id)
    get_supabase().table("workspaces").update(
        {"deleted_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", workspace_id).execute()
    return {"ok": True}


# ── resource import ──────────────────────────────────────────────────────────

@router.post("/workspaces/{workspace_id}/resources")
async def import_resource(
    workspace_id: str,
    background: BackgroundTasks,
    authorization: str = Header(),
    file: UploadFile | None = File(default=None),
    url: str | None = Form(default=None),
    pos_x: float = Form(default=0),
    pos_y: float = Form(default=0),
):
    user_id = get_user_id(authorization)
    _own_workspace(workspace_id, user_id)
    db = get_supabase()

    if file is not None and file.filename:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext in _VIDEO_EXTS:
            kind = "video"
        elif ext in _DOC_EXTS:
            kind = "pdf" if ext == ".pdf" else "document"
        else:
            raise HTTPException(status_code=400, detail={
                "error": f"Unsupported file type '{ext}'. Accepted: "
                         f"{', '.join(sorted(_DOC_EXTS | _VIDEO_EXTS))}"})
        rid = str(uuid.uuid4())
        spath = f"{user_id}/{rid}/source{ext}"
        data = await file.read()
        try:
            storage.upload(spath, data, file.content_type or "application/octet-stream")
        except Exception as e:
            raise HTTPException(status_code=502, detail={"error": f"Upload failed: {e}"})
        row = db.table("workspace_resources").insert({
            "id": rid, "workspace_id": workspace_id, "user_id": user_id,
            "kind": kind, "title": os.path.splitext(file.filename)[0],
            "storage_path": spath, "mime_type": file.content_type,
            "pos_x": pos_x, "pos_y": pos_y,
        }).execute().data[0]
    elif url:
        url = url.strip()
        kind = "youtube" if youtube_video_id(url) else "website"
        row = db.table("workspace_resources").insert({
            "workspace_id": workspace_id, "user_id": user_id,
            "kind": kind, "title": url if kind == "website" else "YouTube video",
            "source_url": url, "pos_x": pos_x, "pos_y": pos_y,
        }).execute().data[0]
    else:
        raise HTTPException(status_code=400,
                            detail={"error": "Provide a file or a url."})

    background.add_task(process_resource, row["id"])
    return _resource_public(row)


@router.get("/workspaces/{workspace_id}/resources")
async def resource_statuses(workspace_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_workspace(workspace_id, user_id)
    rows = (get_supabase().table("workspace_resources")
            .select("id,status,error,title,kind,note_id,meta")
            .eq("workspace_id", workspace_id).execute().data or [])
    return rows


# ── single resource ──────────────────────────────────────────────────────────

@router.get("/resources/{resource_id}")
async def get_resource(resource_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    r = _own_resource(resource_id, user_id)
    elements = (get_supabase().table("resource_elements").select("*")
                .eq("resource_id", resource_id)
                .order("page").order("order_index").execute().data or [])
    for el in elements:
        if el.get("image_path"):
            try:
                el["image_url"] = storage.signed_url(el["image_path"], 3600)
            except Exception:
                pass
    out = _resource_public(r)
    out["summary_html"] = r.get("summary_html")
    out["elements"] = elements
    return out


@router.get("/resources/{resource_id}/file")
async def resource_file_url(resource_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    r = _own_resource(resource_id, user_id)
    if not r.get("storage_path"):
        raise HTTPException(status_code=404, detail={"error": "Resource has no stored file"})
    try:
        return {"url": storage.signed_url(r["storage_path"], 3600)}
    except Exception as e:
        raise HTTPException(status_code=502, detail={"error": f"Could not sign URL: {e}"})


@router.patch("/resources/{resource_id}")
async def patch_resource(resource_id: str, body: PositionPatch,
                         authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_resource(resource_id, user_id)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        return {"ok": True}
    row = (get_supabase().table("workspace_resources").update(patch)
           .eq("id", resource_id).execute().data[0])
    return _resource_public(row)


@router.delete("/resources/{resource_id}")
async def delete_resource(resource_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    r = _own_resource(resource_id, user_id)
    # best-effort storage cleanup; the output note is never deleted
    try:
        prefix = f"{user_id}/{resource_id}"
        objs = get_supabase().storage.from_(storage.BUCKET).list(prefix) or []
        storage.remove([f"{prefix}/{o['name']}" for o in objs])
    except Exception:
        pass
    get_supabase().table("workspace_resources").delete().eq("id", resource_id).execute()
    return {"ok": True, "note_id": r.get("note_id")}


@router.post("/resources/{resource_id}/reprocess")
async def reprocess_resource(resource_id: str, background: BackgroundTasks,
                             authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_resource(resource_id, user_id)
    get_supabase().table("workspace_resources").update(
        {"status": "queued", "error": None}).eq("id", resource_id).execute()
    background.add_task(process_resource, resource_id)
    return {"ok": True}


@router.post("/resources/{resource_id}/capture")
async def capture_media(resource_id: str, body: CaptureRequest,
                        authorization: str = Header()):
    user_id = get_user_id(authorization)
    r = _own_resource(resource_id, user_id)
    if r["kind"] not in ("video", "youtube"):
        raise HTTPException(status_code=400,
                            detail={"error": "Capture only works on video resources"})
    try:
        return capture(r, body.type, body.start, body.end)
    except CaptureError as e:
        raise HTTPException(status_code=422, detail={"error": str(e)})


@router.post("/resources/{resource_id}/formula-latex")
async def formula_latex(resource_id: str, body: FormulaRequest,
                        authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_resource(resource_id, user_id)
    rows = (get_supabase().table("resource_elements").select("*")
            .eq("id", body.element_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail={"error": "Element not found"})
    el = rows[0]
    if not el.get("image_path"):
        raise HTTPException(status_code=422, detail={"error": "Element has no image crop"})
    try:
        image_bytes = storage.download(el["image_path"])
        latex = formula_to_latex(image_bytes, user_id)
        return {"latex": latex}
    except CaptureError as e:
        raise HTTPException(status_code=422, detail={"error": str(e)})
    except Exception as e:
        raise HTTPException(status_code=502, detail={"error": f"Formula OCR failed: {e}"})


# ── note page cards ──────────────────────────────────────────────────────────

@router.post("/workspaces/{workspace_id}/pages")
async def add_page(workspace_id: str, body: PageCreate,
                   authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_workspace(workspace_id, user_id)
    db = get_supabase()
    note_id = body.note_id
    if not note_id:
        note = db.table("notes").insert({
            "user_id": user_id, "title": body.title,
            "content": [], "content_text": "", "source_type": "manual",
        }).execute().data[0]
        note_id = note["id"]
    row = db.table("workspace_pages").upsert({
        "workspace_id": workspace_id, "user_id": user_id, "note_id": note_id,
        "pos_x": body.pos_x, "pos_y": body.pos_y,
    }, on_conflict="workspace_id,note_id").execute().data[0]
    return row


@router.patch("/pages/{page_id}")
async def patch_page(page_id: str, body: PositionPatch,
                     authorization: str = Header()):
    user_id = get_user_id(authorization)
    patch = {k: v for k, v in body.model_dump().items()
             if v is not None and k != "title"}
    if not patch:
        return {"ok": True}
    rows = (get_supabase().table("workspace_pages").update(patch)
            .eq("id", page_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail={"error": "Page not found"})
    return rows[0]


@router.delete("/pages/{page_id}")
async def remove_page(page_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    get_supabase().table("workspace_pages").delete().eq("id", page_id).eq(
        "user_id", user_id).execute()
    return {"ok": True}


# ── note anchors (summary ↔ source sync) ────────────────────────────────────

@router.put("/notes/{note_id}/anchors")
async def put_anchors(note_id: str, body: list[AnchorRow],
                      authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    nrows = (db.table("notes").select("id").eq("id", note_id)
             .eq("user_id", user_id).execute().data)
    if not nrows:
        raise HTTPException(status_code=404, detail={"error": "Note not found"})
    db.table("note_anchors").delete().eq("note_id", note_id).execute()
    if body:
        db.table("note_anchors").insert([
            {"note_id": note_id, "user_id": user_id,
             "resource_id": a.resource_id, "block_id": a.block_id,
             "anchor_type": a.anchor_type,
             "anchor_start": a.anchor_start, "anchor_end": a.anchor_end}
            for a in body
        ]).execute()
    return {"ok": True, "count": len(body)}


@router.get("/notes/{note_id}/anchors")
async def get_anchors(note_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    rows = (get_supabase().table("note_anchors").select("*")
            .eq("note_id", note_id).eq("user_id", user_id)
            .execute().data or [])
    return rows


# ── grounded chat ────────────────────────────────────────────────────────────

@router.post("/workspaces/{workspace_id}/chat")
async def workspace_chat(workspace_id: str, body: ChatRequest,
                         authorization: str = Header()):
    user_id = get_user_id(authorization)
    _own_workspace(workspace_id, user_id)

    async def stream():
        async for ev in run_workspace_chat(workspace_id, user_id, body.messages):
            yield "data: " + json.dumps(ev) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── AI providers ─────────────────────────────────────────────────────────────

@router.get("/ai-providers")
async def list_ai_providers(authorization: str = Header()):
    user_id = get_user_id(authorization)
    rows = (get_supabase().table("ai_providers").select("*")
            .eq("user_id", user_id).order("created_at").execute().data or [])
    for r in rows:
        key = r.pop("api_key", "") or ""
        r["api_key_hint"] = ("…" + key[-4:]) if len(key) >= 8 else "set"
    return rows


@router.post("/ai-providers")
async def create_ai_provider(body: ProviderCreate, authorization: str = Header()):
    user_id = get_user_id(authorization)
    if body.provider not in ("gemini", "anthropic", "openai", "openai_compatible"):
        raise HTTPException(status_code=400, detail={"error": "Unknown provider"})
    if body.provider == "openai_compatible" and not body.base_url:
        raise HTTPException(status_code=400,
                            detail={"error": "openai_compatible needs base_url"})
    row = get_supabase().table("ai_providers").insert({
        "user_id": user_id, "provider": body.provider,
        "label": body.label or body.provider, "api_key": body.api_key,
        "base_url": body.base_url, "chat_model": body.chat_model,
    }).execute().data[0]
    row.pop("api_key", None)
    return row


@router.patch("/ai-providers/{provider_id}")
async def patch_ai_provider(provider_id: str, body: ProviderPatch,
                            authorization: str = Header()):
    user_id = get_user_id(authorization)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        return {"ok": True}
    rows = (get_supabase().table("ai_providers").update(patch)
            .eq("id", provider_id).eq("user_id", user_id).execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail={"error": "Provider not found"})
    out = rows[0]
    out.pop("api_key", None)
    return out


@router.delete("/ai-providers/{provider_id}")
async def delete_ai_provider(provider_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    get_supabase().table("ai_providers").delete().eq("id", provider_id).eq(
        "user_id", user_id).execute()
    return {"ok": True}
