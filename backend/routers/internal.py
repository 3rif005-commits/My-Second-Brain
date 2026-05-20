"""Internal router — used by the MCP server to access retrieval without a user JWT."""

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel

from core.config import settings
from services.database import get_supabase
from services.embedder import embed
from services.retriever import retrieve

router = APIRouter(prefix="/internal", tags=["internal"])


def _check_internal_key(x_internal_key: str):
    if x_internal_key != settings.internal_api_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid internal key")


class SearchRequest(BaseModel):
    query: str
    user_id: str
    top_k: int = 5


class NoteRequest(BaseModel):
    note_id: str
    user_id: str


@router.post("/search")
def internal_search(body: SearchRequest, x_internal_key: str = Header()):
    """Embed query and return top-K notes. Called by MCP server."""
    _check_internal_key(x_internal_key)
    try:
        query_embedding = embed(body.query)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Embedding failed: {e}")

    results = retrieve(query_embedding, body.user_id)
    return {"results": results[: body.top_k]}


@router.post("/note")
def internal_get_note(body: NoteRequest, x_internal_key: str = Header()):
    """Fetch a single note by ID. Called by MCP server."""
    _check_internal_key(x_internal_key)
    db = get_supabase()
    _res = (
        db.table("notes")
        .select("id, title, content_text, topics, mastery_status, source_type, created_at")
        .eq("id", body.note_id)
        .eq("user_id", body.user_id)
        .maybe_single()
        .execute()
    )
    if _res is None or not _res.data:
        raise HTTPException(status_code=404, detail="Note not found")
    return _res.data


@router.post("/notes")
def internal_list_notes(user_id: str, x_internal_key: str = Header()):
    """List all notes for a user. Called by MCP server."""
    _check_internal_key(x_internal_key)
    db = get_supabase()
    result = (
        db.table("notes")
        .select("id, title, topics, mastery_status, source_type, created_at, updated_at")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .limit(100)
        .execute()
    )
    return {"notes": result.data or []}
