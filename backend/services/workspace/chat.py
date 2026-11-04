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

from services import privacy
from services.database import get_supabase
from services.embedder import embed
from services.hybrid_search import fuse
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
    if c.get("kind") == "note":
        return "your note"
    if c["anchor_type"] == "time":
        s = int(c["anchor_start"])
        return f"t={s // 60:02d}:{s % 60:02d}"
    if c["anchor_type"] == "page":
        return f"page {int(c['anchor_start'])}"
    return f"section {int(c['anchor_start'])}"


#: How many embedding matches go into the fusion — enough that a piece the
#: word match ranks first can still meet its vector rank.
_VECTOR_CANDIDATES = 40
#: A note's pieces read for word matching. A note of ten lectures is ~300.
_LEXICAL_CAP = 3000


#: Other notes a session brings in: at most this many are read per question.
MAX_SESSION_NOTES = 5
#: Characters per piece of a brought-in note's own text.
_NOTE_PIECE = 900


def note_text_pieces(note_ids: list[str], user_id: str) -> list[dict]:
    """Notes brought into a session are reading material too: their own text, in
    paragraph-sized pieces shaped like source chunks (kind "note"), so word
    matching can pick the relevant ones and a citation opens the note."""
    if not note_ids:
        return []
    rows = (get_supabase().table("notes").select("id,content_text")
            .in_("id", note_ids).eq("user_id", user_id).is_("deleted_at", "null")
            .execute().data or [])
    pieces: list[dict] = []
    for n in rows:
        buf, idx = "", 0
        paras = [p.strip() for p in (n.get("content_text") or "").split("\n") if p.strip()]
        for para in paras + [""]:
            if para and len(buf) + len(para) < _NOTE_PIECE:
                buf = f"{buf}\n{para}" if buf else para
                continue
            if buf:
                pieces.append({"id": f"note:{n['id']}:{idx}", "resource_id": n["id"], "note_id": n["id"],
                               "kind": "note", "chunk_text": buf, "anchor_type": "section",
                               "anchor_start": idx, "anchor_end": idx})
                idx += 1
            buf = para[:_NOTE_PIECE]
    return pieces


def retrieve_chunks(query: str, note_id: str, user_id: str,
                    extra_note_ids: list[str] | tuple = ()) -> list[dict]:
    """The session's best pieces for this question: the embedding's order fused
    with word matching (E8, services/hybrid_search.py). The embedding finds
    paraphrases; the words find the lecture's own terms, and pieces that never
    got an embedding. If the embedding server is down, words alone still answer
    instead of the chat losing its sources.

    A session can bring other notes in beside its own (`extra_note_ids`): their
    sources are searched too, and their own text joins as pieces. Every piece
    carries the note it belongs to (`note_id`), for the privacy gate."""
    db = get_supabase()
    extras = [n for n in dict.fromkeys(extra_note_ids) if n and n != note_id][:MAX_SESSION_NOTES]
    note_ids = [note_id, *extras]
    vector_rows: list[dict] = []
    try:
        embedding = embed(query)
        vec = "[" + ",".join(str(v) for v in embedding) + "]"
        for nid in note_ids:
            rows_n = db.rpc("match_note_source_chunks", {
                "query_embedding": vec,
                "match_user_id": user_id,
                "target_note_id": nid,
                "match_count": _VECTOR_CANDIDATES,
            }).execute().data or []
            vector_rows += [{**r, "note_id": nid} for r in rows_n]
        vector_rows.sort(key=lambda r: r.get("similarity") or 0, reverse=True)
    except Exception as e:                          # noqa: BLE001
        logger.warning(f"note {note_id}: embedding search failed, words only: {e}")
    lexical = db.table("resource_chunks").select(
        "id,resource_id,note_id,chunk_text,anchor_type,anchor_start,anchor_end")
    lexical = lexical.in_("note_id", note_ids) if extras else lexical.eq("note_id", note_id)
    rows = (lexical.eq("user_id", user_id).limit(_LEXICAL_CAP).execute().data or [])
    rows += note_text_pieces(extras, user_id)
    by_id = {str(r["id"]): r for r in rows}
    for r in vector_rows:
        by_id.setdefault(str(r["id"]), r)
    order = fuse(query, [str(r["id"]) for r in vector_rows],
                 {i: r.get("chunk_text") or "" for i, r in by_id.items()},
                 limit=_TOP_K)
    return [by_id[i] for i in order]


def source_excerpts(chunks: list[dict], titles: dict[str, str],
                    with_ids: bool = False) -> str:
    """The numbered excerpts, as the prompt shows them — [n] (title, page) text.
    `with_ids` adds `src=` and the source id's first 8 characters, so a model
    with the source tools can name the source it wants to act on."""
    lines = []
    for i, c in enumerate(chunks, start=1):
        title = titles.get(str(c["resource_id"]), "resource")
        src = (f', src={str(c["resource_id"])[:8]}'
               if with_ids and c.get("kind") != "note" else "")
        lines.append(f'[{i}] ({title}, {_anchor_label(c)}{src}) {c["chunk_text"][:800]}')
    return "\n\n".join(lines)


def build_system_prompt(chunks: list[dict], titles: dict[str, str]) -> str:
    return SYSTEM_TEMPLATE.format(sources=source_excerpts(chunks, titles) or "(no sources)")


def workspace_chunks(query: str, note_id: str, user_id: str,
                     extra_note_ids: list[str] | tuple = ()) -> tuple[list[dict], dict[str, str]]:
    """The session's excerpts for this question, and the titles they show under
    (a source's title, or a brought-in note's)."""
    chunks = retrieve_chunks(query, note_id, user_id, extra_note_ids)
    titles: dict[str, str] = {}
    if chunks:
        db = get_supabase()
        rids = list({str(c["resource_id"]) for c in chunks if c.get("kind") != "note"})
        if rids:
            rows = db.table("note_resources").select("id,title").in_("id", rids).execute().data or []
            titles = {str(r["id"]): r["title"] for r in rows}
        nids = list({str(c["note_id"]) for c in chunks if c.get("kind") == "note"})
        if nids:
            rows = db.table("notes").select("id,title").in_("id", nids).execute().data or []
            titles.update({str(r["id"]): r.get("title") or "Untitled" for r in rows})
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
    thin = (result.get("check") or {}).get("thin") or []
    if thin:
        # So the assistant can say it too; the card offers the fix (E9).
        parts.append("may be thin on " + ", ".join(f"“{t}”" for t in thin))
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
            # The note the source belongs to: a citation pill opens it there.
            **({"source_note_id": str(c["note_id"])} if c.get("note_id") and c.get("kind") != "note" else {}),
            # A brought-in note's own text: the citation opens that note.
            **({"kind": "note", "note_id": str(c["note_id"])} if c.get("kind") == "note" else {}),
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


@privacy.reads_note
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


@privacy.reads_note
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
