"""About you (services/memory.py): the user's own list, read and edited from
Settings. Entries the chat saved arrive through the memory.remember tool, not
through here."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from routers.ingest import get_user_id
from services import memory

router = APIRouter(prefix="/memory", tags=["memory"])


class EntryCreate(BaseModel):
    content: str


def _unavailable(e: memory.MemoryUnavailable) -> HTTPException:
    return HTTPException(409, detail=str(e))


@router.get("")
def list_entries(authorization: str = Header()):
    user_id = get_user_id(authorization)
    try:
        rows = memory.entries(user_id)
    except memory.MemoryUnavailable as e:
        raise _unavailable(e) from None
    return {"entries": rows, "limits": {"entry": memory.ENTRY_MAX, "total": memory.TOTAL_MAX,
                                        "entries": memory.ENTRIES_MAX}}


@router.post("", status_code=201)
def add_entry(body: EntryCreate, authorization: str = Header()):
    user_id = get_user_id(authorization)
    try:
        return memory.add(user_id, body.content, source="user")
    except memory.MemoryUnavailable as e:
        raise _unavailable(e) from None
    except memory.MemoryRejected as e:
        raise HTTPException(400, detail=str(e)) from None


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    try:
        found = memory.delete(user_id, entry_id)
    except memory.MemoryUnavailable as e:
        raise _unavailable(e) from None
    if not found:
        raise HTTPException(404, detail="Not found")
