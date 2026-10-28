"""Web research through Tavily — the hackathon add-on (HACKATHON-TAVILY).

One chat tool, `web.search_web`: the model writes a search query, Tavily
returns pages, the model answers with their links. Only the query leaves the
app. Note text never does — and since the model writes the query, the
permission gate asks the user first in any turn that has read notes or
private data (services/agent/permissions.py), showing the exact words.

Web pages are text nobody in this app wrote: they come back cleaned
(text_hygiene.untrusted) and mark the rest of the turn untrusted.

With TAVILY_API_KEY unset the tool is not offered and nothing here runs.
Removal: docs/hackathon/TAVILY.md.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from core.config import settings
from services.text_hygiene import untrusted

logger = logging.getLogger(__name__)

TOOL_NAME = "web.search_web"
SEARCH_URL = "https://api.tavily.com/search"
MAX_QUERY = 400          # Tavily's own limit
SNIPPET = 1_200          # characters of each page the model gets
TIMEOUT = 20.0


class WebSearchFailed(RuntimeError):
    """User-facing: the search did not run."""


def enabled() -> bool:
    return bool(settings.tavily_api_key)


TOOL = {
    "name": TOOL_NAME,
    "description": (
        "Search the public web (Tavily) for current facts, news, docs or anything "
        "the user's notes do not cover. Returns pages with title, url and an "
        "excerpt; cite the urls in your answer. Only `query` is sent out: write "
        "a short, general search query. Never put note text, names or personal "
        "details in it."),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "A short web search query"},
            "max_results": {"type": "integer", "minimum": 1, "maximum": 8, "default": 5},
            "topic": {"type": "string", "enum": ["general", "news"], "default": "general"},
        },
        "required": ["query"],
    },
}


def search(args: dict[str, Any]) -> dict[str, Any]:
    """Run one search. Returns {"query", "results": [{title, url, content}]}."""
    query = " ".join(str(args.get("query") or "").split())
    if not query:
        raise WebSearchFailed("an empty query")
    if len(query) > MAX_QUERY:
        raise WebSearchFailed(f"the query is over {MAX_QUERY} characters; shorten it")
    try:
        n = max(1, min(8, int(args.get("max_results") or 5)))
    except (TypeError, ValueError):
        n = 5
    topic = "news" if args.get("topic") == "news" else "general"
    try:
        r = httpx.post(SEARCH_URL, timeout=TIMEOUT,
                       headers={"Authorization": f"Bearer {settings.tavily_api_key}"},
                       json={"query": query, "max_results": n, "topic": topic,
                             "search_depth": "basic", "include_answer": False,
                             "include_raw_content": False, "include_images": False})
    except httpx.HTTPError as e:
        logger.warning("tavily | %s", type(e).__name__)
        raise WebSearchFailed("Tavily did not answer") from None
    if r.status_code != 200:
        logger.warning("tavily | HTTP %s", r.status_code)
        raise WebSearchFailed(f"Tavily answered HTTP {r.status_code}")
    pages = (r.json() or {}).get("results") or []
    return {"query": query, "results": [
        {"title": untrusted(str(p.get("title") or ""))[:200],
         "url": str(p.get("url") or "")[:500],
         "content": untrusted(str(p.get("content") or ""))[:SNIPPET]}
        for p in pages[:n] if isinstance(p, dict)
        and str(p.get("url") or "").startswith(("https://", "http://"))]}
