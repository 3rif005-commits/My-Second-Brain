"""Settings → Notion → Local backup: make a backup now, list them. Archives live in a folder on
THIS machine (BACKUP_DIR, default ~/SecondBrainBackups); nothing here goes to Notion or any cloud."""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse

from core.config import settings
from routers.ingest import get_user_id
from services.backup import archive, retention, runner
from services.database import get_supabase

router = APIRouter(prefix="/backup", tags=["backup"])


def _folder(user_id: str):
    return runner.backup_dir(settings.backup_dir) / str(user_id)[:8]


@router.get("")
def status(authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    folder = _folder(user_id)
    files = sorted(folder.glob("*.sbz"), reverse=True) if folder.exists() else []
    # On a hosted server (Render sets RENDER) the folder is that server's disk, wiped on
    # every deploy: Settings then offers the file as a download instead of calling it a
    # backup "on this computer".
    return {"enabled": settings.backup_enabled, "folder": str(folder),
            "hosted": bool(os.getenv("RENDER")),
            "archives": [{"name": p.name, "bytes": p.stat().st_size} for p in files[:50]]}


@router.post("/run")
def run_now(authorization: str = Header(...)):
    """A backup right now (works even when the daily one is switched off)."""
    user_id = get_user_id(authorization)
    from services.workspace import storage
    try:
        return runner.run_for_user(get_supabase(), user_id, runner.backup_dir(settings.backup_dir),
                                   storage_download=storage.download, skills_dirs=runner.default_skill_dirs(user_id),
                                   now=datetime.now(timezone.utc))
    except RuntimeError as e:
        raise HTTPException(500, {"error": str(e), "error_code": "BACKUP_FAILED"})


@router.get("/{name}")
def download(name: str, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    if not retention.NAME.match(name):
        raise HTTPException(404, "No such backup.")
    p = _folder(user_id) / name
    if not p.exists():
        raise HTTPException(404, "No such backup.")
    return FileResponse(p, filename=name, media_type="application/zip")
