"""Supabase Storage helpers for the workspace-resources bucket.

Object paths are always prefixed with the owning user id
(`{user_id}/{resource_id}/...`) to match the bucket RLS policies.
"""
from __future__ import annotations

from services.database import get_supabase

BUCKET = "workspace-resources"


def upload(path: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload bytes; returns the object path."""
    get_supabase().storage.from_(BUCKET).upload(
        path, data, file_options={"content-type": content_type, "upsert": "true"}
    )
    return path


def signed_upload(path: str) -> dict:
    """A one-time link the browser uploads one file to, straight to Storage: the file never
    passes through Vercel (4.5 MB request cap) or the backend. → {"signed_url", "token", "path"}."""
    res = get_supabase().storage.from_(BUCKET).create_signed_upload_url(path)
    return {"signed_url": res.get("signed_url") or res.get("signedUrl"),
            "token": res["token"], "path": path}


def exists(path: str) -> bool:
    folder, _, name = path.rpartition("/")
    objs = get_supabase().storage.from_(BUCKET).list(folder, {"search": name}) or []
    return any(o.get("name") == name for o in objs)


def download(path: str) -> bytes:
    return get_supabase().storage.from_(BUCKET).download(path)


def signed_url(path: str, expires_in: int = 3600) -> str:
    res = get_supabase().storage.from_(BUCKET).create_signed_url(path, expires_in)
    return res.get("signedURL") or res.get("signedUrl") or ""


def signed_urls(paths: list[str], expires_in: int = 3600) -> dict[str, str]:
    """Many signed URLs in one request: {path: url}, missing where signing failed."""
    if not paths:
        return {}
    res = get_supabase().storage.from_(BUCKET).create_signed_urls(paths, expires_in)
    out = {}
    for r in res or []:
        url = r.get("signedURL") or r.get("signedUrl")
        if r.get("path") and url and not r.get("error"):
            out[r["path"]] = url
    return out


def remove(paths: list[str]) -> None:
    if paths:
        get_supabase().storage.from_(BUCKET).remove(paths)
