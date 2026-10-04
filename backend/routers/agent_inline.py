"""POST /agent/inline — OpenAI-compatible streaming proxy for xl-ai.

xl-ai's ClientSideTransport sends an OpenAI chat-completions request with
toolChoice: "required", forcing the model to call applyDocumentOperations.
Free models do not support forced tool-calling, so we route inline AI through
a dedicated model (settings.inline_model) that reliably supports it.

Error handling: if the upstream returns a non-200 status we emit a proper SSE
error event so xl-ai can display it rather than silently writing nothing.

Deliberately NOT moved onto services/ai/agent_stream like the other surfaces:
this route is a byte-level pass-through, and xl-ai's client parses the upstream
bytes itself. Re-encoding them through the gateway's event shape would change a
wire contract that only a browser can verify. What it shares instead is
services/ai/passthrough — the same forward-and-tee used by /v1/chat/completions,
so inline spend is logged and budgeted without anything being rewritten.
"""
from __future__ import annotations


from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from core.config import settings
from routers.ingest import get_user_id
from services import privacy
from services.ai.passthrough import stream_passthrough
from services.ai.providers import Provider

router = APIRouter(prefix="/agent", tags=["agent"])

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _inline_endpoint() -> dict:
    """Return the endpoint config for the inline AI model.

    Always uses OpenRouter + settings.inline_model, regardless of the
    global api_provider.  The inline model must support tool_choice=required.
    """
    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not set — inline AI requires it")
    return {
        "url": _OPENROUTER_URL,
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.openrouter_api_key}",
        },
        "model": settings.inline_model,
    }


def _inline_provider() -> Provider:
    """OpenRouter specifically: inline AI needs tool_choice=required, which the
    free models do not support, so this one surface pins its own provider
    instead of taking the chain's first choice."""
    return Provider(provider="openai_compatible",
                    api_key=settings.openrouter_api_key,
                    base_url="https://openrouter.ai/api/v1",
                    chat_model=settings.inline_model,
                    label="OpenRouter (inline)", capabilities={"text"})


@router.post("/inline")
async def agent_inline(
    body: dict,
    authorization: str = Header(),
    note_id: str | None = None,
):
    """OpenAI-compatible streaming endpoint for xl-ai inline editor AI.

    `note_id` is the open note: the editor sends the whole document, so a note
    above this provider's privacy ceiling is refused before anything is sent.
    """
    user_id = get_user_id(authorization)
    endpoint = _inline_endpoint()
    refusal = privacy.refuse_note(note_id, user_id, _inline_provider())
    if refusal:
        raise HTTPException(status_code=403, detail={"error": refusal})

    async def stream():
        try:
            async for chunk in stream_passthrough(
                _inline_provider(), body, surface="inline", job="inline_edit",
                user_id=user_id, model=endpoint["model"],
            ):
                yield chunk
        except RuntimeError:
            # stream_passthrough already emitted the SSE error event.
            return

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
