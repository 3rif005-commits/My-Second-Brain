"""Multi-source note synthesis — one note per session, never one per source.

maybe_synthesize(note_id)  the settle guard; called by processor.py after each
                           source reaches `ready`. Fires run_synthesis exactly
                           once, when the last source lands.
run_synthesis(note_id, m)  builds the multi-source prompt from every ready
                           source, calls the AI layer, writes note_synthesis.

`mode` ('replace' | 'append') is a client-side apply strategy — the draft is
identical either way — so it is logged, not persisted. A client that reloads
mid-run re-decides via its normal replace/append path.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone

from core.config import settings
from prompts.note_synthesis import (build_note_synthesis_prompt, cache_split,
                                     split_budget)
from prompts.note_synthesis_md import build_markdown_synthesis_prompt
from services.ai.client import complete, last_call_truncated
from services.ai import budget as budget_guard
from services.ai import usage as usage_log
from services.ai.pricing import estimate_usd, tokens_from_chars
from services.ai.router import complete_with_fallback, pick
from services.database import get_supabase
from services.workspace.dbretry import with_retry
from services.workspace.figures import figure_parts
from services.workspace.md_to_blocks import TRUNCATION_NOTICE_HTML, markdown_to_html
from services.workspace.anchors import repair_anchors

logger = logging.getLogger(__name__)

#: Output cap for a whole-note generation. 16K cut off every guide written from
#: two real lectures (E13: 1/3 pass, 3/3 truncated); at 32K they finish —
#: 14.7K–25.6K tokens, 3/3 pass, +8% cost. The cap bills nothing unused.
OUTPUT_CAP = 32000

_FENCE = re.compile(r"^```(?:html|markdown|md)?\s*|\s*```$", re.MULTILINE)
_H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)
_TAGS = re.compile(r"<[^>]+>")
_PENDING = ("queued", "processing")


def _strip_fences(html: str) -> str:
    return _FENCE.sub("", html or "").strip()


def _anchor_tag(anchor_type: str, start) -> str:
    value = float(start or 0)
    if anchor_type == "time":
        s = int(value)
        return f"[{s // 60:02d}:{s % 60:02d}]"
    if anchor_type == "page":
        return f"[page {int(value)}]"
    return f"[section {int(value)}]"


def source_text_from_chunks(source_id: str) -> str:
    """Rebuild a source's tagged text from its anchored chunks.

    Synthesis runs after every source has settled, so the extracted text is no
    longer in memory the way it was for the old per-resource summary. The chunks
    cover the full text and carry the anchor each passage came from, so the
    `[page N]` / `[mm:ss]` / `[section N]` tagging the prompt relies on is
    reconstructed from anchor_type + anchor_start.
    """
    rows = (get_supabase().table("resource_chunks")
            .select("chunk_text,anchor_type,anchor_start")
            .eq("resource_id", source_id).order("chunk_index")
            .execute().data or [])
    parts: list[str] = []
    last_tag: str | None = None
    for r in rows:
        tag = _anchor_tag(r["anchor_type"], r["anchor_start"])
        if tag != last_tag:
            parts.append(tag)
            last_tag = tag
        parts.append(r["chunk_text"])
    return "\n".join(parts)


def ready_sources(note_id: str) -> list[dict]:
    return (get_supabase().table("note_resources").select("*")
            .eq("note_id", note_id).eq("status", "ready")
            .order("order_index").execute().data or [])


def _write(note_id: str, user_id: str, patch: dict) -> None:
    # `applied_at` belongs to the draft that was applied, so any write that moves
    # this row to a new draft must clear it — a PostgREST upsert only touches the
    # columns it is given, and a stale timestamp makes the client ignore the new
    # draft entirely.
    payload = {"note_id": note_id, "user_id": user_id, "applied_at": None, **patch,
               "updated_at": datetime.now(timezone.utc).isoformat()}
    with_retry(lambda: get_supabase().table("note_synthesis")
               .upsert(payload, on_conflict="note_id").execute())


def _claim(note_id: str, user_id: str) -> bool:
    """Claim the right to synthesize this note. `note_synthesis.note_id` is the
    primary key, so this insert is the mutual-exclusion point: when two sibling
    sources settle at the same moment in two background threads, exactly one
    insert wins and the loser no-ops instead of paying for a second LLM call."""
    try:
        get_supabase().table("note_synthesis").insert({
            "note_id": note_id, "user_id": user_id, "status": "running",
            "source_ids": [], "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
        return True
    except Exception as e:
        logger.info(f"note {note_id}: synthesis claim not taken ({e})")
        return False


def maybe_synthesize(note_id: str) -> bool:
    """The auto-fire decision: policy first, then the settle guard.

    Policy (`settings.workspace_on_drop`): only "auto" may spend tokens without
    being asked. Under the default "suggest", dropping sources indexes them and
    the UI offers a priced Generate action instead — see
    `estimate_synthesis()`. The manual synthesize endpoint does not come
    through here, so an explicit request is never blocked by this.

    Settle guard: proceeds only if no source on this note is still pending, no
    synthesis exists yet, and the note has no user content — so dropping 3
    sources at once produces exactly one synthesis, fired by whichever source
    finishes last. Returns True if it fired."""
    if not note_id:
        return False
    if settings.workspace_on_drop != "auto":
        logger.info(f"note {note_id}: auto-synthesis skipped "
                    f"(workspace_on_drop={settings.workspace_on_drop!r})")
        return False
    db = get_supabase()
    sources = (db.table("note_resources").select("id,status")
               .eq("note_id", note_id).execute().data or [])
    if any((s.get("status") or "") in _PENDING for s in sources):
        return False
    if (db.table("note_synthesis").select("note_id")
            .eq("note_id", note_id).execute().data):
        return False
    notes = (db.table("notes").select("id,user_id,title,content")
             .eq("id", note_id).execute().data or [])
    if not notes or notes[0].get("content"):
        return False
    if not _claim(note_id, notes[0]["user_id"]):
        return False
    run_synthesis(note_id, "replace", trigger="auto")
    return True


# A guide's length follows its sources: two real lectures (~17K source tokens)
# came out at 14.7K–25.6K tokens (E13, median 17.6K), short synthetic sources
# at ~3K. A flat 40K-char (~10K-token) guess under-quoted the real case by half.
# Only the pre-run estimate uses this; the real figure comes from the
# provider's usage fields after the run.
_MIN_OUTPUT_TOKENS = 3_000


#: Markdown says the same in about half the tokens (E6b on two real lectures:
#: median 9.2K vs 17.6K output tokens at equal text length).
_MARKDOWN_OUTPUT_RATIO = 0.55


def _uses_markdown(figures: list | None = None, video_urls: list | None = None) -> bool:
    """Markdown for text runs when configured; the figure and video paths
    were only ever written and measured for the HTML dialect."""
    return settings.synthesis_format == "md" and not figures and not video_urls


def _expected_output_tokens(source_chars: int, markdown: bool = False) -> int:
    tokens = tokens_from_chars(source_chars)
    if markdown:
        tokens = int(tokens * _MARKDOWN_OUTPUT_RATIO)
    return min(OUTPUT_CAP, max(_MIN_OUTPUT_TOKENS, tokens))


def _prompt_overhead_chars(markdown: bool = False) -> int:
    """Size of the static part of the prompt — measured, not hardcoded, so it
    cannot drift away from the prompt files."""
    try:
        if markdown:
            return len(build_markdown_synthesis_prompt([]))
        return len(build_note_synthesis_prompt([], has_figures=False))
    except Exception:
        return 8_000


def estimate_synthesis(note_id: str, user_id: str) -> dict:
    """What one synthesis over this note's ready sources would cost.

    Derived from the stored chunks and the price table: no model call, no
    tokenizer round trip, so the UI can show it before the user commits. It
    reproduces run_synthesis's own budgeting (`split_budget`), so a source the
    run would truncate is counted truncated here too.
    """
    sources = ready_sources(note_id)
    lengths = [len(source_text_from_chunks(s["id"])) for s in sources]
    allotted = split_budget(lengths) if lengths else []
    source_chars = sum(min(length, allot)
                       for length, allot in zip(lengths, allotted))
    md = _uses_markdown()
    input_tokens = tokens_from_chars(source_chars + _prompt_overhead_chars(md))
    output_tokens = _expected_output_tokens(source_chars, markdown=md)
    provider = pick("summarize_text", user_id)
    model = provider.model if provider else None
    return {
        "on_drop": settings.workspace_on_drop,
        "ready_sources": len(sources),
        "source_chars": source_chars,
        "truncated": sum(lengths) > source_chars,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "provider": provider.provider if provider else None,
        "model": model,
        "usd": estimate_usd(model, input_tokens, output_tokens),
    }


def _looks_like_a_mastery_guide(html: str) -> bool:
    """Reject the two observed failure modes for a reasoning-prone free model:
    a chain-of-thought dump that never reaches HTML at all (no <h1>), and a
    response that starts correctly but stops right after the outline (an
    <h1> with no chapter <h2> ever written). A real guide has both, plus
    enough length to hold actual chapter content."""
    if not html or not _H1.search(html):
        return False
    if "<h2" not in html.lower():
        return False
    return len(html) >= 500


def _looks_like_a_chapter(html: str) -> bool:
    """A chapter of a guide written in parts (E9): it opens a chapter and has
    body — the same "not an outline stub" check, without the <h1>."""
    return bool(html) and "<h2" in html.lower() and len(html) >= 300


def _title_suggestion(html: str) -> str | None:
    m = _H1.search(html or "")
    if not m:
        return None
    title = _TAGS.sub("", m.group(1)).strip()
    return title[:200] or None


def _inherited_titles(note: dict, first_source: dict) -> set[str]:
    """Titles the note could have been auto-assigned at attach time. The
    processor renames a source once it learns the real video/page title, so the
    source's CURRENT title is not enough to recognise an untouched note."""
    titles = {first_source.get("title"), "YouTube video"}
    if note.get("source_url"):
        titles.add(note["source_url"])
    if note.get("source_filename"):
        titles.add(os.path.splitext(os.path.basename(note["source_filename"]))[0])
    return {t for t in titles if t}


def _complete(prompt: str, video_urls: list[str], has_text: bool,
              user_id: str, figures: list[dict] | None = None,
              markdown: bool = False,
              sources: list[dict] | None = None) -> str:
    """Text path, or the Gemini-native video path when a source has no
    transcript (same capability routing the per-resource summary used)."""
    if video_urls:
        provider = pick("summarize_video", user_id)
        if provider is not None and "video_native" in provider.capabilities:
            content: list[dict] = [{"type": "text", "text": prompt}]
            content += [{"type": "video_url", "url": u} for u in video_urls]
            return _strip_fences(complete(
                provider, [{"role": "user", "content": content}], max_tokens=8192))
        if not has_text:
            raise RuntimeError(
                "No transcript for this source and no video-capable provider "
                "configured — add a Gemini key in Settings → AI Providers.")
    # A full mastery guide is a long document, and truncation right after the
    # outline is the observed failure mode — so give it real room. Claude Haiku
    # 4.5 allows far more than this, and `client._anthropic_complete` streams,
    # so a budget this size cannot hit the HTTP read timeout.
    if figures:
        # `synthesize_vision` only ever ranks vision-capable providers, so the
        # figures cannot be handed to a text-only model that would drop or choke
        # on them. If every one of them fails, the note is still worth writing
        # from the text alone — that is the pre-vision behaviour, not an error.
        try:
            content = [{"type": "text", "text": prompt}] + figures
            return _strip_fences(complete_with_fallback(
                "synthesize_vision", user_id,
                [{"role": "user", "content": content}],
                max_tokens=OUTPUT_CAP, validate=_looks_like_a_mastery_guide))
        except Exception as e:
            logger.warning(f"vision synthesis failed, retrying without the "
                           f"{len(figures) // 2} figure(s): {e}")
    if markdown:
        # Validate what the editor will receive, not the raw Markdown: the
        # same "has a title, has chapters, has length" check as the HTML path.
        md = complete_with_fallback(
            "summarize_text", user_id, [{"role": "user", "content": prompt}],
            max_tokens=OUTPUT_CAP,
            validate=lambda text: _looks_like_a_mastery_guide(
                markdown_to_html(_strip_fences(text))))
        # Source tables go in verbatim, where the model put their markers.
        html = markdown_to_html(_strip_fences(md))
        # The Markdown path sometimes points every section at source 1; the
        # note is right, the pointers are not (E6d). Checked against the pages.
        html, fixed = repair_anchors(html, sources or [])
        if fixed:
            logger.info(f"repaired {fixed} section anchor(s)")
        return html
    if sources and 0 < settings.synthesis_chapters_min_sources <= len(sources):
        # E9: one call covering several lectures wrote each shallower than it
        # was alone. Plan the chapters, write each in its own call.
        from services.workspace.chaptered import synthesize_chaptered
        done = synthesize_chaptered(sources, user_id)
        if done is not None:
            html, truncated = done
            if truncated:                          # a chapter hit the cap
                from services.ai import client as ai_client
                ai_client._last_stop.set("max_tokens")
            return html
    return _strip_fences(complete_with_fallback(
        "summarize_text", user_id, synthesis_messages(prompt),
        max_tokens=OUTPUT_CAP, validate=_looks_like_a_mastery_guide))


def synthesis_messages(prompt: str, cache: bool | None = None) -> list[dict]:
    """The one user message a study guide is written from. With the prompt
    cache on (E3), the fixed instructions go first as their own part, marked
    for reuse, and this note's sources follow — the same text either way."""
    if cache is None:
        cache = settings.synthesis_prompt_cache
    fixed, rest = cache_split(prompt)
    if not cache or not fixed:
        return [{"role": "user", "content": prompt}]
    return [{"role": "user", "content": [
        {"type": "text", "text": fixed, "cache": True},
        {"type": "text", "text": rest}]}]


def run_synthesis(note_id: str, mode: str = "replace",
                  trigger: str = "user") -> None:
    """`trigger` only reaches the run log: it is how "what did auto-generation
    cost us?" stays answerable after the policy changes again."""
    db = get_supabase()
    notes = (db.table("notes").select("id,user_id,title,content,source_url,source_filename")
             .eq("id", note_id).execute().data or [])
    if not notes:
        logger.warning(f"run_synthesis: note {note_id} not found")
        return
    note = notes[0]
    user_id = note["user_id"]
    sources = ready_sources(note_id)
    source_ids = [s["id"] for s in sources]
    logger.info(f"synthesizing note {note_id} from {len(sources)} source(s), "
                f"mode={mode}")
    _write(note_id, user_id,
           {"status": "running", "error": None, "source_ids": source_ids})

    if not sources:
        # Nothing extractable yet: leave no synthesis behind at all, so retrying
        # a failed source can still auto-fire the first draft.
        logger.info(f"note {note_id}: no ready sources, releasing the claim")
        try:
            db.table("note_synthesis").delete().eq("note_id", note_id).execute()
        except Exception:
            logger.warning(f"note {note_id}: could not release the synthesis claim")
        return

    try:
        blocks: list[dict] = []
        video_urls: list[str] = []
        has_text = False
        for s in sources:
            text = source_text_from_chunks(s["id"])
            if text:
                has_text = True
            else:
                if s["kind"] in ("youtube", "video") and s.get("source_url"):
                    video_urls.append(s["source_url"])
                else:
                    logger.warning(f"note {note_id}: source {s['id']} "
                                   f"({s['kind']}) contributed no text — "
                                   f"chunks missing or extraction empty")
                    text = ("(No text could be extracted from this source.)")
            blocks.append({"title": s["title"], "kind": s["kind"], "text": text,
                           "duration": (s.get("meta") or {}).get("duration")})
        # The figures are the second path to the model, beside `pages_text`: a
        # diagram carries no text, so without them the deck's grid world and
        # block diagrams are simply not in the input.
        # The flag is off by default (see config.py), but a source with no
        # extractable text at all — a scanned/image-only PDF — has nothing else
        # to synthesize from, so vision is the only path that can produce
        # anything regardless of the flag.
        figures = (figure_parts(source_ids)
                   if not video_urls and (settings.workspace_synthesis_vision or not has_text)
                   else [])
        use_md = _uses_markdown(figures, video_urls)
        # Which tables go into the notes is the model's choice (user decision,
        # 2026-09-24): source tables are not force-copied.
        prompt = (build_markdown_synthesis_prompt(blocks) if use_md
                  else build_note_synthesis_prompt(blocks, has_figures=bool(figures)))
        with usage_log.annotate(surface="workspace", job="synthesis",
                                trigger=trigger, note_id=note_id,
                                user_id=user_id), \
             budget_guard.limit(settings.max_usd_per_run or None):
            # The estimate is already exact enough to refuse on: it is built
            # from the same chunks and the same budget split the run will use.
            budget_guard.check(estimate_synthesis(note_id, user_id)["usd"],
                               what="Writing this note", setting="MAX_USD_PER_RUN")
            html = _complete(prompt, video_urls, has_text, user_id, figures,
                             markdown=use_md, sources=blocks)
            if last_call_truncated():
                # Say so in the note itself: a guide that stops mid-section
                # with no explanation reads as the whole lecture.
                logger.warning(f"note {note_id}: synthesis hit the output cap")
                html += TRUNCATION_NOTICE_HTML
        if not html.strip():
            raise RuntimeError("The model returned an empty draft.")

        suggestion = _title_suggestion(html)
        _write(note_id, user_id, {"status": "ready", "html": html, "error": None,
                                  "source_ids": source_ids,
                                  "title_suggestion": suggestion})
        # A multi-source session should get a topic title instead of inheriting
        # source #1's filename — but never over a title the user typed.
        if suggestion and note.get("title") in _inherited_titles(note, sources[0]):
            db.table("notes").update({"title": suggestion}).eq("id", note_id).execute()
    except Exception as e:
        logger.warning(f"note {note_id}: synthesis failed: {e}")
        _write(note_id, user_id, {"status": "failed", "source_ids": source_ids,
                                  "error": str(e)[:500]})
