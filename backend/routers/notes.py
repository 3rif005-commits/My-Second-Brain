from fastapi import APIRouter, Header, HTTPException, status
from jose import jwt, JWTError
from core.config import settings
from models.note import NoteCreate, NoteUpdate, NoteResponse
from services.database import get_supabase

router = APIRouter(prefix="/notes", tags=["notes"])


def get_user_id(authorization: str = Header()) -> str:
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload["sub"]
    except JWTError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))


@router.get("/", response_model=list[NoteResponse])
async def list_notes(authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    result = (
        db.table("notes")
        .select("*")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return result.data


@router.post("/", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(note: NoteCreate, authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    result = (
        db.table("notes")
        .insert({"user_id": user_id, **note.model_dump()})
        .execute()
    )
    return result.data[0]


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(note_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    result = (
        db.table("notes")
        .select("*")
        .eq("id", note_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Note not found")
    return result.data


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(note_id: str, update: NoteUpdate, authorization: str = Header()):
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


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(note_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    db = get_supabase()
    db.table("notes").delete().eq("id", note_id).eq("user_id", user_id).execute()
