from datetime import datetime, timezone
from fastapi import APIRouter, Header, HTTPException, status
from models.note import BlockPreviewResponse, NoteCreate, NoteUpdate, NoteResponse
from services.database import get_supabase

router = APIRouter(prefix="/notes", tags=["notes"])


def get_user_id(authorization: str = Header()) -> str:
    """Verify the Supabase JWT via Supabase's own auth API rather than
    decoding it locally. Local decoding needs to know the token's signing
    algorithm in advance; Supabase's newer "JWT Signing Keys" projects sign
    with an asymmetric algorithm (e.g. ES256) instead of the legacy shared
    HS256 secret, so a hardcoded `algorithms=["HS256"]` allow-list rejects
    every token from a migrated project with `jose.JWTError: 'The specified
    alg value is not allowed'`. Remote verification is algorithm-agnostic —
    Supabase's own server does the check — matching the pattern
    `routers/ingest.py`'s `get_user_id` already uses.
    """
    token = authorization.removeprefix("Bearer ").strip()
    try:
        response = get_supabase().auth.get_user(token)
        if not response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"error": "Invalid or expired token.", "error_code": "AUTH_INVALID"},
            )
        return response.user.id
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": f"Token validation failed: {e}", "error_code": "AUTH_ERROR"},
        )


@router.get("/", response_model=list[NoteResponse])
def list_notes(authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    result = (
        db.table("notes")
        .select("*")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("updated_at", desc=True)
        .execute()
    )
    return result.data


@router.get("/trash", response_model=list[NoteResponse])
def list_trash(authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    result = (
        db.table("notes")
        .select("*")
        .eq("user_id", user_id)
        .not_.is_("deleted_at", "null")
        .order("deleted_at", desc=True)
        .execute()
    )
    return result.data


@router.post("/", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
def create_note(note: NoteCreate, authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    result = (
        db.table("notes")
        .insert({"user_id": user_id, **note.model_dump()})
        .execute()
    )
    return result.data[0]


@router.get("/{note_id}", response_model=NoteResponse)
def get_note(note_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    result = (
        db.table("notes")
        .select("*")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Note not found")
    return result.data


@router.get("/{note_id}/blocks/{block_id}", response_model=BlockPreviewResponse)
def get_note_block(note_id: str, block_id: str, authorization: str = Header()):
    """A cited block and the passage around it, for the citation hover card
    (`/brain/{note_id}#{block_id}` links in chat answers). Selected by
    (id, user_id) like every route here: another user's note is a 404."""
    from services.block_chunker import find_block_window
    user_id = get_user_id(authorization)
    rows = (
        get_supabase().table("notes")
        .select("id, title, icon, content, updated_at")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Note not found")
    note = rows[0]
    content = note.get("content") or []
    # `_top`: a link to the whole note — its opening passage, nothing marked.
    window = ((content[:5], -1) if content else None) if block_id == "_top" \
        else find_block_window(content, block_id)
    if window is None:
        raise HTTPException(status_code=404, detail="Block not found")
    blocks, target_index = window
    return BlockPreviewResponse(
        note_id=note["id"], note_title=note.get("title") or "Untitled",
        note_icon=note.get("icon") or "📄", block_id=block_id, blocks=blocks,
        target_index=target_index, updated_at=note.get("updated_at"))


@router.patch("/{note_id}", response_model=NoteResponse)
def update_note(note_id: str, update: NoteUpdate, authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    payload = update.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = (
        db.table("notes")
        .update(payload)
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Note not found")
    return result.data[0]


@router.patch("/{note_id}/restore", response_model=NoteResponse)
def restore_note(note_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    result = (
        db.table("notes")
        .update({"deleted_at": None})
        .eq("id", note_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Note not found")
    return result.data[0]


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(note_id: str, authorization: str = Header()):
    """Soft delete — moves note to Trash."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    db.table("notes").update(
        {"deleted_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", note_id).eq("user_id", user_id).execute()


@router.delete("/{note_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
def permanent_delete_note(note_id: str, authorization: str = Header()):
    """Hard delete — cannot be undone."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    db.table("notes").delete().eq("id", note_id).eq("user_id", user_id).execute()
