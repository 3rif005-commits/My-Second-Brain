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
wire contract that only a browser can verify. What it does share is the run log
— the stream is teed on the way past, so inline AI spend stops being invisible.
"""
from __future__ import annotations

import json

import httpx
from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse

from core.config import settings
from routers.ingest import get_user_id
from services.ai import budget as budget_guard
from services.ai import usage as usage_log

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


def _report_usage(chunk: bytes) -> None:
    """Read usage off a chunk on its way to the client, without altering it."""
    for line in chunk.split(b"\n"):
        if not line.startswith(b"data: ") or line == b"data: [DONE]":
            continue
        try:
            usage_log.report_openai_usage(json.loads(line[6:]))
        except Exception:                       # noqa: BLE001 — a partial frame
            continue


@router.post("/inline")
async def agent_inline(
    body: dict,
    authorization: str = Header(),
):
    """OpenAI-compatible streaming endpoint for xl-ai inline editor AI."""
    get_user_id(authorization)

    endpoint = _inline_endpoint()

    payload = {
        **body,
        "model": endpoint["model"],
        "stream": True,
    }

    request_chars = len(json.dumps(body, default=str))

    async def stream():
        forwarded = 0
        # The run row is written when this generator finishes, which is also
        # when the client has the whole answer.
        with usage_log.annotate(surface="inline", job="inline_edit",
                                trigger="user"), \
             budget_guard.limit(settings.max_usd_per_run or None), \
             usage_log.track("openai_compatible", endpoint["model"],
                             estimate_chars=(request_chars, 0)) as spend:
          async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                endpoint["url"],
                headers=endpoint["headers"],
                json=payload,
            ) as resp:
                if resp.status_code != 200:
                    # Surface the upstream error as an SSE error event so
                    # xl-ai can display it instead of silently writing nothing.
                    raw = await resp.aread()
                    try:
                        detail = json.loads(raw).get("error", {})
                        msg = detail.get("message", raw.decode()) if isinstance(detail, dict) else str(detail)
                    except Exception:
                        msg = raw.decode()
                    yield f"data: {json.dumps({'type': 'error', 'content': f'Inline AI error ({resp.status_code}): {msg}'})}\n\n".encode()
                    return
                async for chunk in resp.aiter_bytes():
                    forwarded += len(chunk)
                    _report_usage(chunk)
                    yield chunk

            if not spend.reported:
                # OpenRouter only sends usage when asked, and asking means
                # adding stream_options to a payload xl-ai built — a wire
                # change no test here can check. Until someone verifies that in
                # the browser, the estimate is the honest answer.
                spend.set_estimate(
                    usage_log.tokens_from_chars(request_chars),
                    usage_log.tokens_from_chars(forwarded))

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
