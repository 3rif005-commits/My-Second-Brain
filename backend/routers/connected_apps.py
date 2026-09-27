"""Settings → Connected apps: the apps using your Second Brain through the
remote MCP server, and the edits/deletes they asked for (5.4, phase 2)."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from routers.ingest import get_user_id
from services import connected_apps as apps

router = APIRouter(prefix="/connected-apps", tags=["connected-apps"])


class Decision(BaseModel):
    approve: bool


@router.get("")
def overview(authorization: str = Header()):
    user_id = get_user_id(authorization)
    try:
        return apps.overview(user_id)
    except Exception as e:                          # noqa: BLE001
        if "mcp_" in str(e):
            return {"apps": [], "pending": [],
                    "setup": "Apply supabase/migrations/023 and 024 first."}
        raise


@router.post("/changes/{change_id}")
def decide(change_id: str, body: Decision, authorization: str = Header()):
    user_id = get_user_id(authorization)
    try:
        return apps.decide(user_id, change_id, body.approve)
    except apps.ChangeError as e:
        raise HTTPException(409, detail=str(e))


@router.post("/{client_id}/disconnect")
def disconnect(client_id: str, authorization: str = Header()):
    user_id = get_user_id(authorization)
    apps.disconnect(user_id, client_id)
    return {"ok": True}
