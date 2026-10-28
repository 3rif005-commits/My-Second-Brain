"""POST /agent — SSE-streaming endpoint that runs the Agent Engine.

Replaces the old POST /chat endpoint. Saves the assistant message to
chat_threads on completion.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Header
from fastapi.responses import StreamingResponse

from models.agent import AgentRequest, Mode
from routers.ingest import get_user_id  # JWT helper, already exists
from services.agent.engine import run_turn
from services.agent.skills import SkillRegistry
from services.database import get_supabase

router = APIRouter(prefix="/agent", tags=["agent"])


_BUNDLED_SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


def _get_registry() -> SkillRegistry:
    """Built-ins, then this request's user's own skills (get_user_id set the
    user; services/skill_store.py)."""
    from services.skill_store import user_skills_dir
    return SkillRegistry.load([_BUNDLED_SKILLS_DIR, user_skills_dir()])


@router.post("")
async def agent_endpoint(
    body: AgentRequest,
    authorization: str = Header(),
):
    user_id = get_user_id(authorization)
    registry = _get_registry()

    thread_id = body.thread_id or str(uuid.uuid4())
    # Append user message to thread (or create thread). A replay of the same
    # question — an approval, a privacy choice, "Ask again on" — is already there.
    replay = bool(body.approvals or body.release or body.withheld_ok or body.override_of)
    if not (replay and body.thread_id):
        thread_id = _append_user_message_to_thread(thread_id, user_id, body) or thread_id
        body.thread_id = thread_id      # the engine logs the route against it

    if body.job and body.surface == "workspace" and body.current_note_id:
        return StreamingResponse(_job_stream(body, user_id, thread_id),
                                 media_type="text/event-stream")

    async def stream():
        last_assistant_text = ""
        route: dict | None = None
        async for ev in run_turn(body, user_id=user_id, skill_registry=registry):
            # Override thread_id with our own so the row matches the SSE
            if ev.get("type") == "done":
                ev = {**ev, "thread_id": thread_id}
            if ev.get("type") == "text":
                last_assistant_text += ev["content"]
            if ev.get("type") == "route":
                route = ev
            yield "data: " + json.dumps(ev) + "\n\n"

        # Persist assistant message after stream completes
        _append_assistant_message_to_thread(thread_id, last_assistant_text,
                                            route=route)
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


async def _job_stream(body: AgentRequest, user_id: str, thread_id: str):
    """`/name` in the workspace AI panel: the job runs directly — no model turn
    decides anything — and its result arrives as a card. The thread records
    that it ran (the result itself is not stored; it lives in the note once
    inserted)."""
    from services.workspace.chat import run_skill_in_chat, summarize_result
    said = ""
    async for ev in run_skill_in_chat(body.current_note_id, user_id, body.job, body.focus):
        if ev.get("type") == "result":
            said = f"{ev.get('title', body.job)} ready — {summarize_result(ev)}."
        elif ev.get("type") == "error":
            said = f"{body.job} could not run: {ev.get('content', '')}"
        yield "data: " + json.dumps(ev) + "\n\n"
    _append_assistant_message_to_thread(thread_id, said or f"{body.job} finished.")
    yield "data: " + json.dumps({"type": "done", "thread_id": thread_id}) + "\n\n"
    yield "data: [DONE]\n\n"


def _append_user_message_to_thread(
    thread_id: str, user_id: str, body: AgentRequest
) -> str:
    """Either update an existing thread's messages or create a new one.
    Returns the thread's id: a fresh one when the id the client sent belongs
    to someone else. The AI panel keeps its chat tabs in the browser, so after
    signing in to another account it sent that account's thread id; this
    user's lookup found nothing, the insert hit the taken primary key, and
    every message failed with a 500 (live, 2026-10-28). Another user's thread
    is never written to."""
    supabase = get_supabase()
    _res = (
        supabase.table("chat_threads")
        .select("id, messages")
        .eq("id", thread_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    existing = _res.data if _res is not None else None
    new_message = {"role": "user", "content": body.query}
    if existing:
        messages = existing["messages"] + [new_message]
        supabase.table("chat_threads").update({"messages": messages}).eq(
            "id", thread_id
        ).execute()
        return thread_id
    taken = (supabase.table("chat_threads").select("id").eq("id", thread_id)
             .execute().data)
    if taken:
        thread_id = str(uuid.uuid4())
    supabase.table("chat_threads").insert({
        "id": thread_id,
        "user_id": user_id,
        "messages": [new_message],
        "model_mode": body.mode.value,
        "title": body.query[:60],  # placeholder; replaced after first reply
    }).execute()
    return thread_id


#: What the thread keeps of a route event: enough to redraw the badge.
_ROUTE_KEPT = ("decision_id", "slot", "provider", "model", "decided_by",
               "reason", "on_device")


def _append_assistant_message_to_thread(thread_id: str, content: str,
                                        route: dict | None = None) -> None:
    if not content:
        return
    supabase = get_supabase()
    _res = (
        supabase.table("chat_threads")
        .select("id, messages, title")
        .eq("id", thread_id)
        .maybe_single()
        .execute()
    )
    existing = _res.data if _res is not None else None
    if not existing:
        return
    message: dict = {"role": "assistant", "content": content}
    if route:
        # `private`: written from private notes — a later cloud turn gets a
        # placeholder instead of this text (engine._history).
        message["private"] = bool(route.get("private_used"))
        message["route"] = {k: route.get(k) for k in _ROUTE_KEPT}
    messages = existing["messages"] + [message]
    update: dict = {"messages": messages}
    # First assistant reply → set a short auto-title if the title was the
    # truncated user query.
    if existing["title"] and len(existing["messages"]) == 1:
        first_user = existing["messages"][0]["content"]
        if existing["title"] == first_user[:60]:
            update["title"] = _auto_title(first_user)
    supabase.table("chat_threads").update(update).eq("id", thread_id).execute()


def _auto_title(first_user_msg: str) -> str:
    """Fast deterministic title from the first user message.

    Phase 1: take the first sentence (or ≤6 words). A small-LLM title is a
    nice-to-have in Phase 2.
    """
    head = first_user_msg.strip().split(".")[0]
    words = head.split()
    return " ".join(words[:6]) + ("…" if len(words) > 6 else "")
