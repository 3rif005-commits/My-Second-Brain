"""Study guides from several sources: plan the chapters, then write each one (E9).

One call covering three lectures wrote each of them at 55-80% of the depth it
got alone — not cut off (22-25K of 32K tokens), just shorter per lecture
(evals/multi_source.py). So the guide is written in parts:

  1. plan   — one short call reads every source and returns the chapters,
              organized by concept across sources, each with the pages it uses;
  2. write  — one call per chapter, in parallel, with the study-guide
              instructions UNCHANGED and only that chapter's pages;
  3. join   — one <h1>, then the chapters in plan order.

The user's instructions are never edited (HARNESS.md, the prompt incident):
each chapter call is the ordinary synthesis prompt, over a subset of the
pages, followed by a short engine note saying which chapter to write. The
planner's own instructions are a file of the skill (reference/chapter-plan.md). The
fixed part of that prompt is the same in every call, so the prompt cache
(E3) makes repeating it cheap. Any failure in planning falls back to the
single call.
"""
from __future__ import annotations

import contextvars
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

_PAGE_TAG = re.compile(r"^\[page (\d+)\]$", re.M)
_H1 = re.compile(r"<h1\b[^>]*>.*?</h1>", re.I | re.S)
_WORKERS = 4

def plan_prompt() -> str:
    """The planner's instructions — a file of the study-guide skill
    (reference/chapter-plan.md), editable in Settings → Skills → Files and read
    at call time. `{sources}` marks where the sources go."""
    from prompts._skill_text import skill_reference
    return skill_reference("study-guide", "chapter-plan.md")


CHAPTER_NOTE = """
---
THIS CALL WRITES ONE CHAPTER OF A LONGER GUIDE.
The whole guide's chapters, in order:
{outline}

Write ONLY chapter {n}: "{title}" — {covers}
- Start directly with its <h2>. No <h1>: the guide's title is added once,
  above all chapters.
- Everything else follows the instructions above, at full depth for this
  chapter. Leave the other chapters' material to them.
- The source material above holds only this chapter's pages; anchors keep
  each source's own number."""


def pages_of(text: str) -> dict[int, str]:
    """A tagged source ("[page N]" lines) as {page: text}."""
    out: dict[int, str] = {}
    parts = _PAGE_TAG.split(text)
    for page, body in zip(parts[1::2], parts[2::2]):
        out[int(page)] = out.get(int(page), "") + body.strip("\n") + "\n"
    return out


def _only_pages(text: str, pages: set[int]) -> str:
    kept = [f"[page {p}]\n{body.rstrip()}" for p, body in sorted(pages_of(text).items())
            if p in pages]
    return "\n".join(kept) if kept else "(no pages of this source in this chapter)"


def plan(sources: list[dict], user_id: str, focus: str = "") -> dict | None:
    """The chapters, or None if the plan is unusable (the caller falls back)."""
    from services.ai.router import complete_with_fallback
    from services.workspace.skill_run import _focused

    listing = "\n\n".join(f"=== SOURCE {i}: {s['title']} ===\n{s['text']}"
                          for i, s in enumerate(sources, start=1))
    try:
        template = plan_prompt()
        prompt = (template.replace("{sources}", listing) if "{sources}" in template
                  else f"{template}\n\n{listing}")
        raw = complete_with_fallback(
            "summarize_text", user_id,
            [{"role": "user", "content": _focused(prompt, focus)}],
            max_tokens=4000)
        data = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
    except Exception as e:                          # noqa: BLE001
        logger.warning(f"chapter plan failed, writing in one call: {e}")
        return None
    return _checked(data, sources)


def _checked(data: dict, sources: list[dict]) -> dict | None:
    """Keep only real pages; give every page nobody claimed to the chapter
    that uses its nearest page of the same source."""
    chapters = []
    for ch in data.get("chapters") or []:
        pages: dict[int, set[int]] = {}
        for ref in ch.get("pages") or []:
            try:
                src = int(ref.get("source"))
            except (TypeError, ValueError):
                continue
            if 1 <= src <= len(sources):
                real = set(pages_of(sources[src - 1]["text"]))
                pages.setdefault(src, set()).update(int(p) for p in ref.get("pages") or []
                                                     if str(p).isdigit() and int(p) in real)
        if any(pages.values()) and ch.get("title"):
            chapters.append({"title": str(ch["title"]), "covers": str(ch.get("covers") or ""),
                             "pages": pages})
    if len(chapters) < 2:
        return None                                 # nothing to split
    for src, s in enumerate(sources, start=1):
        for p in pages_of(s["text"]):
            if any(p in ch["pages"].get(src, ()) for ch in chapters):
                continue
            nearest = min(
                (ch for ch in chapters if ch["pages"].get(src)),
                key=lambda ch: min(abs(p - q) for q in ch["pages"][src]),
                default=chapters[0])
            nearest["pages"].setdefault(src, set()).add(p)
    return {"title": str(data.get("title") or sources[0]["title"]), "chapters": chapters}


def _write_chapter(n: int, outline: dict, sources: list[dict], user_id: str,
                   has_figures: bool, focus: str = "") -> tuple[str, bool]:
    from prompts.note_synthesis import build_note_synthesis_prompt
    from services.ai.client import last_call_truncated
    from services.ai.router import complete_with_fallback
    from services.workspace.synthesis import (OUTPUT_CAP, _looks_like_a_chapter,
                                              _strip_fences, synthesis_messages)

    ch = outline["chapters"][n - 1]
    subset = [{**s, "text": _only_pages(s["text"], ch["pages"].get(i, set()))}
              for i, s in enumerate(sources, start=1)]
    listing = "\n".join(f"{i}. {c['title']} — {c['covers']}"
                        for i, c in enumerate(outline["chapters"], start=1))
    from services.workspace.skill_run import _focused
    prompt = _focused(build_note_synthesis_prompt(subset, has_figures=has_figures)
                      + CHAPTER_NOTE.format(outline=listing, n=n, title=ch["title"],
                                            covers=ch["covers"]), focus)
    html = _strip_fences(complete_with_fallback(
        "summarize_text", user_id, synthesis_messages(prompt),
        max_tokens=OUTPUT_CAP, validate=_looks_like_a_chapter))
    return _H1.sub("", html).strip(), last_call_truncated()


def synthesize_chaptered(sources: list[dict], user_id: str,
                         has_figures: bool = False,
                         focus: str = "") -> tuple[str, bool] | None:
    """(html, truncated), or None when the guide should be written in one call."""
    outline = plan(sources, user_id, focus)
    if outline is None:
        return None
    # Threads do not inherit context variables: carry the run log's labels and
    # the budget into each chapter call.
    ctx = contextvars.copy_context()
    with ThreadPoolExecutor(max_workers=_WORKERS) as pool:
        futures = [pool.submit(ctx.copy().run, _write_chapter, n, outline, sources,
                               user_id, has_figures, focus)
                   for n in range(1, len(outline["chapters"]) + 1)]
        parts = [f.result() for f in futures]
    title = outline["title"].replace("<", "&lt;")
    html = f"<h1>{title}</h1>\n" + "\n".join(p for p, _ in parts)
    # Each chapter call numbers anchors on its own: check every section's
    # anchor against the source pages, as the Markdown path does (E6e).
    from services.workspace.anchors import repair_anchors
    html, fixed = repair_anchors(html, sources)
    if fixed:
        logger.info(f"chaptered guide: repaired {fixed} anchor(s)")
    return html, any(t for _, t in parts)
