"""POST /v1/chat/completions — the app's own OpenAI-compatible endpoint.

The editor's AI (BlockNote's xl-ai, driven by the Vercel AI SDK) called Gemini
straight from Next.js. That worked, and it meant a whole surface spent tokens
that no run row ever saw, no budget ever capped, and no provider setting ever
governed.

The AI SDK can point at any OpenAI-compatible base URL, so this is the smallest
honest fix: the frontend keeps its SDK and its wire format, and the request
goes through the same provider chain, run log and spending ceiling as
everything else.

Deliberately not a general-purpose public API: it authenticates as the app's
user, ignores any `model` the client asks for in favour of the configured
chain, and exists so one surface can stop being invisible.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from routers.ingest import get_user_id
from services import privacy
from services.ai.passthrough import pick_openai_provider, stream_passthrough

router = APIRouter(prefix="/v1", tags=["gateway"])


@router.post("/chat/completions")
async def chat_completions(body: dict, authorization: str = Header(),
                           note_id: str | None = None):
    user_id = get_user_id(authorization)
    try:
        provider = pick_openai_provider(user_id)
    except RuntimeError as e:
        # 503, not 500: nothing is broken, nothing is configured.
        raise HTTPException(status_code=503, detail={"error": str(e)})
    # The editor sends the whole open note; a private one stays home.
    refusal = privacy.refuse_note(note_id, user_id, provider)
    if refusal:
        raise HTTPException(status_code=403, detail={"error": refusal})

    async def stream():
        try:
            async for chunk in stream_passthrough(
                provider, body, surface="editor", job="editor_ai",
                user_id=user_id,
            ):
                yield chunk
        except RuntimeError:
            # stream_passthrough already emitted the SSE error event; raising
            # further would truncate the response the client is reading.
            return

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})
