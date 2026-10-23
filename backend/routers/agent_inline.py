"""POST /agent/inline — the editor AI (BlockNote xl-ai), on the user's own provider.

xl-ai's client sends an OpenAI chat-completions request with tool_choice
"required", forcing a call to applyDocumentOperations, and parses the
streamed reply itself. It runs on the Fast slot of the user's routing
(Settings → Routing), like every other surface. It used to be pinned to
OpenRouter + settings.inline_model, so without an OpenRouter key — the live
site has none — every editor AI request failed.

  - OpenAI-dialect providers (OpenAI, OpenRouter, llama.cpp…): the bytes pass
    through untouched (services/ai/passthrough).
  - Anthropic: translated natively to the Messages API and re-encoded as
    OpenAI chunks (services/ai/openai_bridge).

OpenRouter's auto model is usually a free one, and free models refuse forced
tool calls, so there an unset slot model falls back to settings.inline_model.
"""
from __future__ import annotations

from dataclasses import replace

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from core.config import settings
from routers.ingest import get_user_id
from services import privacy
from services.ai.openai_bridge import stream_anthropic_as_openai
from services.ai.passthrough import OPENAI_DIALECT, stream_passthrough
from services.ai.providers import Provider
from services.routing import policy as routing_policy
from services.routing.switchboard import NoProvider, resolve_slot

router = APIRouter(prefix="/agent", tags=["agent"])

SLOT = "fast"


def _inline_provider(user_id: str) -> Provider:
    """The provider behind the user's Fast slot. Raises NoProvider."""
    policy = routing_policy.load(user_id)
    p = resolve_slot(SLOT, policy, user_id)
    if p.provider not in OPENAI_DIALECT and p.provider != "anthropic":
        raise NoProvider(f"{p.label or p.provider} can't run the editor AI yet — "
                         "point the Fast slot at Anthropic, OpenAI, OpenRouter or the "
                         "local model in Settings → Routing.")
    model_set = bool((policy["slots"].get(SLOT) or {}).get("model"))
    if privacy.provider_key(p) == "openrouter.ai" and not model_set:
        p = replace(p, chat_model=settings.inline_model)
    return p


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
    try:
        provider = _inline_provider(user_id)
    except NoProvider as e:
        raise HTTPException(status_code=503, detail={"error": str(e)})
    refusal = privacy.refuse_note(note_id, user_id, provider)
    if refusal:
        raise HTTPException(status_code=403, detail={"error": refusal})

    async def stream():
        if provider.provider == "anthropic":
            async for chunk in stream_anthropic_as_openai(
                provider, body, surface="inline", job="inline_edit",
                user_id=user_id, note_id=note_id,
            ):
                yield chunk
            return
        try:
            async for chunk in stream_passthrough(
                provider, body, surface="inline", job="inline_edit",
                user_id=user_id, note_id=note_id,
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
