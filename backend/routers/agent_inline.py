"""POST /agent/inline — OpenAI-compatible streaming proxy for inline /ai.

Receives an OpenAI chat-completions request from @blocknote/xl-ai's
ClientSideTransport, injects the note-author skill into the system message,
then proxies to the configured model endpoint and streams back the response.

No agent loop — xl-ai handles the tool loop client-side (add_paragraph etc.).
"""
from __future__ import annotations

from pathlib import Path

import httpx
from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse

from routers.ingest import get_user_id
from services.agent.model import get_endpoint
from services.agent.skills import SkillRegistry
from models.agent import Mode

router = APIRouter(prefix="/agent", tags=["agent"])

_BUNDLED_SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
_USER_SKILLS_DIR = Path.home() / ".secondbrain" / "skills"


def _get_note_author_body() -> str:
    registry = SkillRegistry.load([_BUNDLED_SKILLS_DIR, _USER_SKILLS_DIR])
    skill = registry.get("note-author")
    return skill.body if skill else ""


def _build_inline_messages(
    original: list[dict], skill_body: str
) -> list[dict]:
    """Prepend skill_body to the system message (create one if absent)."""
    messages = list(original)
    if messages and messages[0].get("role") == "system":
        messages[0] = {
            **messages[0],
            "content": f"{skill_body}\n\n{messages[0]['content']}",
        }
    else:
        messages.insert(0, {"role": "system", "content": skill_body})
    return messages


@router.post("/inline")
async def agent_inline(
    body: dict,
    authorization: str = Header(),
):
    """OpenAI-compatible streaming endpoint for xl-ai inline /ai."""
    get_user_id(authorization)  # validate JWT; raises HTTPException on failure

    skill_body = _get_note_author_body()
    messages = _build_inline_messages(body.get("messages", []), skill_body)

    endpoint = get_endpoint(Mode.API, task="chat")

    payload = {
        **body,
        "messages": messages,
        "model": endpoint["model"],
        "stream": True,
    }

    async def stream():
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                endpoint["url"],
                headers=endpoint["headers"],
                json=payload,
            ) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
