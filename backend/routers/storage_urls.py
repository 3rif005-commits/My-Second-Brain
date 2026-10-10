"""A fresh link for one of the user's own stored files.

Ledger B2: a capture inserted into a note carried a 24-hour signed URL, so the picture broke the next
day. New captures now get a long-lived URL; this endpoint heals the ones already in notes (and any
that ever expire again): the editor asks for a fresh URL for an expired link, by its storage path.
Only the caller's OWN files: the path must start with their user id.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from routers.ingest import get_user_id
from services.notion_sync.notion.files import storage_path_of
from services.workspace import storage

router = APIRouter(prefix="/storage", tags=["storage"])

#: ~10 years, the same stand-in for "permanent" pasted images already use
LONG_LIVED_TTL = 10 * 365 * 24 * 3600


class FreshBody(BaseModel):
    url: str


@router.post("/fresh-url")
def fresh_url(body: FreshBody, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    path = storage_path_of(body.url)
    if not path or not path.startswith(f"{user_id}/") or ".." in path.split("/"):
        raise HTTPException(404, {"error": "Not one of your stored files.", "error_code": "NOT_YOURS"})
    url = storage.signed_url(path, LONG_LIVED_TTL)
    if not url:
        raise HTTPException(404, {"error": "That file is no longer stored.", "error_code": "GONE"})
    return {"url": url}
