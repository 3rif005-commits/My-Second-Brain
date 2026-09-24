"""Note-scoped grounded chat with anchored citations.

run_note_chat(...) → AsyncIterator of SSE-ready event dicts (same grammar as the
agent engine: context / text / citations / error / done).

Grounding: retrieve top-K resource_chunks across ALL sources attached to THIS
note, number them [1]..[K] in a <sources> block, and require bracket citations.
Only markers that map to retrieved chunks become citation chips client-side —
unknown markers are ignored (anti-hallucination guard, same idea as the tutor's
note-id rule). The citation payload already carries resource_id + title, which
is exactly what multi-source attribution needs.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, AsyncIterator

from services.database import get_supabase
from services.embedder import embed
from services.ai import usage as usage_log
from services.ai.client import stream as ai_stream
from services.ai.router import candidates

logger = logging.getLogger(__name__)

_TOP_K = 10

SYSTEM_TEMPLATE = """You are the study assistant for one note in the user's
Second Brain. Answer ONLY from the numbered sources below — they are excerpts
from the sources the user attached to this note.

Rules:
- Every factual claim MUST end with a citation marker like [1] or [2][4],
  where the number is the source excerpt that supports it.
- Only use numbers that appear in <sources>. Never invent citation numbers.
- If the sources do not contain the answer, say so plainly — do not answer
  from general knowledge.
- Be concise and direct.

<sources>
{sources}
</sources>"""


def _anchor_label(c: dict) -> str:
    if c["anchor_type"] == "time":
        s = int(c["anchor_start"])
        return f"t={s // 60:02d}:{s % 60:02d}"
    if c["anchor_type"] == "page":
        return f"page {int(c['anchor_start'])}"
    return f"section {int(c['anchor_start'])}"


def retrieve_chunks(query: str, note_id: str, user_id: str) -> list[dict]:
    embedding = embed(query)
    vec = "[" + ",".join(str(v) for v in embedding) + "]"
    res = get_supabase().rpc("match_note_source_chunks", {
        "query_embedding": vec,
        "match_user_id": user_id,
        "target_note_id": note_id,
        "match_count": _TOP_K,
    }).execute()
    return res.data or []


def source_excerpts(chunks: list[dict], titles: dict[str, str]) -> str:
    """The numbered excerpts, as the prompt shows them — [n] (title, page) text."""
    lines = []
    for i, c in enumerate(chunks, start=1):
        title = titles.get(str(c["resource_id"]), "resource")
        lines.append(f'[{i}] ({title}, {_anchor_label(c)}) {c["chunk_text"][:800]}')
    return "\n\n".join(lines)


def build_system_prompt(chunks: list[dict], titles: dict[str, str]) -> str:
    return SYSTEM_TEMPLATE.format(sources=source_excerpts(chunks, titles) or "(no sources)")


def workspace_chunks(query: str, note_id: str, user_id: str) -> tuple[list[dict], dict[str, str]]:
    """The open note's excerpts for this question, and their sources' titles."""
    chunks = retrieve_chunks(query, note_id, user_id)
    titles: dict[str, str] = {}
    if chunks:
        rids = list({str(c["resource_id"]) for c in chunks})
        rows = (get_supabase().table("note_resources")
                .select("id,title").in_("id", rids).execute().data or [])
        titles = {str(r["id"]): r["title"] for r in rows}
    return chunks, titles


def summarize_result(result: dict) -> str:
    """'3 chapters · 24 boxes · 6 tables' — what a job's result holds."""
    html = result.get("html") or ""
    parts = []
    for pattern, one, many in ((r"<h2[\s>]", "chapter", "chapters"),
                               (r'data-type="callout"', "box", "boxes"),
                               (r"<table[\s>]", "table", "tables")):
        n = len(re.findall(pattern, html))
        if n:
            parts.append(f"{n} {one if n == 1 else many}")
    return " · ".join(parts) or "ready"


def citations_payload(chunks: list[dict], titles: dict[str, str]) -> list[dict]:
    return [
        {
            "n": i,
            "resource_id": str(c["resource_id"]),
            "title": titles.get(str(c["resource_id"]), "resource"),
            "anchor_type": c["anchor_type"],
            "anchor_start": c["anchor_start"],
            "anchor_end": c["anchor_end"],
            "snippet": c["chunk_text"][:200],
        }
        for i, c in enumerate(chunks, start=1)
    ]


# ── jobs (skills) in the chat ────────────────────────────────────────────────
#
# Claude Code style: the model sees the catalogue — name and one line each —
# and decides whether the request is a job. If it is, it answers with a single
# marker line instead of prose; the marker is never shown, the job runs, and
# its result comes back as a card. `/name` in the input skips the decision.

SKILL_MARKER = re.compile(r"^\s*<<skill:([a-z0-9-]+)>>[ \t]*(.*)$", re.S)

SKILLS_NOTICE = """You can also run a JOB over ALL of this note's sources. When
the user asks for one of these jobs — in any words — reply with ONLY this line
and nothing else:
<<skill:NAME>> an optional short focus from their request
Jobs:
{catalogue}
For questions about the material, answer normally with citations."""


def skills_notice(skills: list[dict]) -> str:
    if not skills:
        return ""
    return SKILLS_NOTICE.format(catalogue="\n".join(
        f"- {s['skill']}: {s.get('description', '')}" for s in skills))


async def run_skill_in_chat(note_id: str, user_id: str, name: str, focus: str = "",
                            picked: bool = False) -> AsyncIterator[dict[str, Any]]:
    """One job, as chat events: skill_start, then result (or error)."""
    from services.workspace import skill_run
    yield {"type": "skill_start", "skill": name, "title": skill_run.job_title(name),
           "focus": focus, "picked": picked}
    try:
        result = await asyncio.to_thread(
            skill_run.produce_skill_result, note_id, user_id, name, focus)
    except Exception as e:                       # noqa: BLE001
        yield {"type": "error", "content": str(e)[:400]}
        return
    yield {"type": "result", **result}


async def run_note_chat(
    note_id: str,
    user_id: str,
    messages: list[dict],
    skill: str | None = None,
    focus: str = "",
) -> AsyncIterator[dict[str, Any]]:
    if skill:
        async for ev in run_skill_in_chat(note_id, user_id, skill, focus):
            yield ev
        yield {"type": "done"}
        return

    query = ""
    for m in reversed(messages):
        if m.get("role") == "user":
            query = m.get("content") or ""
            break

    # 1. retrieve note-scoped chunks across every attached source
    chunks: list[dict] = []
    try:
        chunks = retrieve_chunks(query, note_id, user_id)
    except Exception as e:
        yield {"type": "error", "content": f"retrieval failed: {e}"}

    titles: dict[str, str] = {}
    if chunks:
        try:
            rids = list({str(c["resource_id"]) for c in chunks})
            rows = (get_supabase().table("note_resources")
                    .select("id,title").in_("id", rids).execute().data or [])
            titles = {str(r["id"]): r["title"] for r in rows}
        except Exception:
            pass

    citations = citations_payload(chunks, titles)
    yield {"type": "context", "citations": citations}

    # 2. stream the grounded answer — fall through the provider chain until
    #    one produces output (a configured key can still 429 at request time)
    providers = candidates("chat", user_id)
    if not providers:
        yield {"type": "error", "content": "No AI provider available."}
        yield {"type": "done"}
        return

    try:
        from services.workspace.skill_run import chat_skills
        offered = [s for s in chat_skills(note_id, user_id) if not s.get("runnable")]
    except Exception:                            # noqa: BLE001
        offered = []
    system = build_system_prompt(chunks, titles)
    notice = skills_notice(offered)
    if notice:
        system += "\n\n" + notice
    payload = [{"role": "system", "content": system}]
    payload += [{"role": m["role"], "content": m["content"]} for m in messages]

    names = {s["skill"] for s in offered}
    errors: list[str] = []
    picked: tuple[str, str] | None = None
    for provider in providers:
        streamed_any = False
        held = ""                 # the start of the answer, until we know it is not a marker
        released = False
        try:
            async for text in _annotated_stream(provider, payload, note_id, user_id):
                streamed_any = True
                if released:
                    yield {"type": "text", "content": text}
                    continue
                held += text
                if held.lstrip().startswith("<<skill:") or "<<skill:".startswith(held.lstrip()):
                    continue      # could be a marker: keep holding
                released = True
                yield {"type": "text", "content": held}
            if not released:
                m = SKILL_MARKER.match(held)
                if m and m.group(1) in names:
                    picked = (m.group(1), m.group(2).strip())
                elif held:
                    yield {"type": "text", "content": held}
            break
        except Exception as e:
            if streamed_any:
                # mid-stream failure: don't retry (would duplicate output)
                yield {"type": "error", "content": f"LLM error: {e}"}
                break
            errors.append(f"{provider.label or provider.provider}: {str(e)[:120]}")
    else:
        yield {"type": "error", "content": "All providers failed: " + " | ".join(errors)}

    if picked:
        async for ev in run_skill_in_chat(note_id, user_id, picked[0], picked[1],
                                          picked=True):
            yield ev
        yield {"type": "done"}
        return

    yield {"type": "citations", "citations": citations}
    yield {"type": "done"}


async def _annotated_stream(provider, payload, note_id: str, user_id: str):
    """Tag this turn's run row with the note it is grounded in, so per-note
    spend is answerable without joining anything."""
    with usage_log.annotate(surface="workspace", job="chat",
                            trigger="user", note_id=note_id, user_id=user_id):
        async for text in ai_stream(provider, payload, max_tokens=2048):
            yield text
