"""Hygiene for text the user did not write, on its way into a prompt.

Retrieved notes (ingested PDFs, web pages, transcripts), workspace sources, MCP
tool results and MCP tool descriptions can all carry text aimed at the model.
Hermes Agent scans for this (tools/threat_patterns.py); its two 2026 CVEs
(CVE-2026-9353, CVE-2026-9366) were bypasses of exactly such regex scanners.
So the rule here is theirs with the lesson applied: **hygiene, never a
boundary.** Nothing in this module decides whether a tool may run — that is
services/agent/permissions.py, which treats every such turn as untrusted
whatever these functions find.

What it does:
  * removes characters a person cannot see but a model reads: zero-width
    characters, bidi overrides and isolates (text that displays in a different
    order than the model reads it), Unicode tag characters (an entire hidden
    ASCII message can ride in U+E0000–U+E007F), and variation-selector
    supplements (another known smuggling channel);
  * defuses the tags this app wraps retrieved text in, so a note containing
    "</knowledge_context>" cannot close the wrapper and speak outside it;
  * names instruction-like phrases, so the user can be told (advisory only).
"""
from __future__ import annotations

import re

#: Invisible in a rendered page, read by a model. Not U+200E/U+200F (LRM/RLM):
#: ordinary right-to-left text uses them and they cannot hide content.
_INVISIBLE_POINTS = (
    "​‌‍⁠⁡⁢⁣⁤﻿᠎"
    "‪‫‬‭‮⁦⁧⁨⁩"
)
_INVISIBLE = re.compile(
    "[" + _INVISIBLE_POINTS + "\U000E0000-\U000E007F\U000E0100-\U000E01EF]")

#: The wrappers this app puts around untrusted text (services/agent/engine.py).
_WRAPPERS = re.compile(
    r"<(\s*/?\s*)(knowledge_context|note|sources|turn_context|active_skills|about_you)\b",
    re.IGNORECASE)

#: Advisory patterns: plain attack phrasing, not bossy English ("you must" is in
#: every manual). Bounded filler between words, so no catastrophic backtracking.
_F = r"(?:[\w'’-]+\s+){0,6}"
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (name, re.compile(rx, re.IGNORECASE)) for name, rx in (
        ("ignore-instructions",
         rf"\b(ignore|disregard|forget|override)\s+{_F}(previous|prior|above|earlier|all|your|any)\s+{_F}(instructions|rules|guidelines|prompts?)\b"),
        ("reveal-system-prompt",
         rf"\b(reveal|print|output|repeat|show|leak)\s+{_F}(system|initial|hidden)\s+(prompt|instructions)\b"),
        ("new-identity",
         rf"\byou\s+are\s+now\s+(a|an|the)\s+{_F}(assistant|ai|model|bot|agent|persona|character)\b"),
        # "DAN" is case-sensitive: "Dan" is a name.
        ("jailbreak-persona", r"\b((?-i:DAN)|developer\s+mode|do\s+anything\s+now|jailbreak(ed)?\s+mode)\b"),
        ("hide-from-user",
         rf"\b(do\s+not|don'?t|never|without)\s+{_F}(tell|telling|inform|informing|mention|mentioning|alert)\s+{_F}(the\s+)?user\b"),
        ("send-data-out",
         rf"\b(send|post|upload|forward|exfiltrate|transmit)\s+{_F}(to|at|via)\s+(https?://|[\w.-]+@[\w.-]+\.\w+)"),
        ("hidden-html-instruction",
         r"<!--[^>]{0,400}\b(ignore|instruction|system|assistant|you\s+must)\b[^>]{0,400}-->"),
    ))

#: Scanning is advisory; bound its cost on a huge tool result.
_MAX_SCAN = 65_536


def strip_invisible(text: str) -> str:
    return _INVISIBLE.sub("", text or "")


def defuse_wrappers(text: str) -> str:
    """'</note>' becomes '‹/note>': still readable, no longer a tag."""
    return _WRAPPERS.sub(lambda m: "‹" + m.group(1) + m.group(2), text or "")


def untrusted(text: str) -> str:
    """The form untrusted text takes in a prompt."""
    return defuse_wrappers(strip_invisible(text))


def attribute(text: str) -> str:
    """A value for an XML-ish attribute in a prompt: one line, no quotes."""
    return " ".join(untrusted(text).replace('"', "'").split())


def instruction_like(text: str) -> list[str]:
    """Names of the attack phrasings found — for telling the user, never for
    deciding anything. Matched on the cleaned text, so invisible characters
    cannot split a phrase past the scan."""
    sample = strip_invisible(text or "")[:_MAX_SCAN]
    return [name for name, rx in _PATTERNS if rx.search(sample)]


def clean_schema(schema, *, limit: int = 1024):
    """An MCP tool's input schema with every description cleaned and capped.
    A description is prompt text the server controls."""
    if isinstance(schema, dict):
        return {k: (untrusted(v)[:limit] if k in ("description", "title") and isinstance(v, str)
                    else clean_schema(v, limit=limit))
                for k, v in schema.items()}
    if isinstance(schema, list):
        return [clean_schema(v, limit=limit) for v in schema]
    return schema
