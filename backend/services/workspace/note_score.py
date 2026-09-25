"""Deterministic scoring of a generated note. No model, no judge, no cost.

These are the counts this project has been checking by hand since the first
mastery guide — headings, toggles, callouts, math blocks, tables, anchors — now
written down once so a change can be compared against a previous run instead of
against a memory of one.

Two rules encoded here, both learned from real regressions:

1. Walk the whole tree. A toggle's body lives in children, and counting only
   top-level elements once made 125 of 194 blocks invisible.
2. Count what the renderer will actually honour. An unknown `data-callout-type`
   does not fail — it renders as a plain grey NOTE — so a run that invents
   "EXAMPLE" looks fine and quietly destroys the colour coding. Unknown types
   are counted separately and are a defect, not a detail.

The scorer reads the DRAFT HTML (what the model produced), never text copied
out of the editor: markdown serialisation drops toggles, invents empty table
header rows, and mangles KaTeX — three things that have looked like bugs here
and were not.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

# The nine the renderer knows. Anything else silently degrades to grey NOTE.
CALLOUT_TYPES = {
    "OVERVIEW", "NOTE", "TIP", "IMPORTANT", "WARNING",
    "CAUTION", "FORMULA", "ANALOGY", "EXAM",
}

# data-anchor="SOURCE:TYPE:VALUE" — source is 1-based into the draft's
# source_ids, type is p(age) / t(ime) / s(ection).
ANCHOR_RE = re.compile(r"^(\d+):([pts]):(\d+(?:\.\d+)?)$")

_HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")
_VOID = {"br", "img", "hr", "input", "meta", "link"}


@dataclass
class NoteScore:
    headings: dict[str, int] = field(default_factory=dict)
    toggles: int = 0
    toggles_with_body: int = 0
    callouts: dict[str, int] = field(default_factory=dict)
    unknown_callouts: list[str] = field(default_factory=list)
    math_blocks: int = 0
    tables: int = 0
    table_rows: int = 0
    anchors: list[str] = field(default_factory=list)
    anchors_valid: int = 0
    anchor_problems: list[str] = field(default_factory=list)
    anchored_h3: int = 0
    text_chars: int = 0
    must_mention_hit: list[str] = field(default_factory=list)
    must_mention_missed: list[str] = field(default_factory=list)
    #: phrases that must NOT appear — an injected instruction the model obeyed,
    #: a tool call written as prose, a leaked system rule
    forbidden_hit: list[str] = field(default_factory=list)

    @property
    def heading_total(self) -> int:
        return sum(self.headings.values())

    @property
    def callout_total(self) -> int:
        return sum(self.callouts.values())

    @property
    def anchor_validity(self) -> float:
        """Share of anchors that point somewhere real. 1.0 when there are none
        to check — absence of anchors is caught by `anchored_h3`, not here."""
        return 1.0 if not self.anchors else self.anchors_valid / len(self.anchors)

    @property
    def grounding(self) -> float:
        """Share of section headings carrying a valid anchor — the number that
        says whether a reader can get back to the source."""
        h3 = self.headings.get("h3", 0)
        return 1.0 if h3 == 0 else self.anchored_h3 / h3

    @property
    def must_mention_rate(self) -> float:
        total = len(self.must_mention_hit) + len(self.must_mention_missed)
        return 1.0 if total == 0 else len(self.must_mention_hit) / total

    def as_dict(self) -> dict:
        return {
            "headings": self.headings,
            "heading_total": self.heading_total,
            "toggles": self.toggles,
            "toggles_with_body": self.toggles_with_body,
            "callouts": self.callouts,
            "callout_total": self.callout_total,
            "unknown_callouts": self.unknown_callouts,
            "math_blocks": self.math_blocks,
            "tables": self.tables,
            "table_rows": self.table_rows,
            "anchors": len(self.anchors),
            "anchors_valid": self.anchors_valid,
            "anchor_validity": round(self.anchor_validity, 3),
            "anchor_problems": self.anchor_problems[:10],
            "grounding": round(self.grounding, 3),
            "text_chars": self.text_chars,
            "must_mention_rate": round(self.must_mention_rate, 3),
            "must_mention_missed": self.must_mention_missed,
            "forbidden_hit": self.forbidden_hit,
        }


class _Counter(HTMLParser):
    def __init__(self, source_count: int | None):
        super().__init__(convert_charrefs=True)
        self.score = NoteScore()
        self.source_count = source_count
        self._stack: list[str] = []
        # depth inside <details>, and whether text was seen outside <summary>
        self._details: list[dict] = []
        self._in_summary = 0

    # ── elements ────────────────────────────────────────────────────────────
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in _HEADINGS:
            self.score.headings[tag] = self.score.headings.get(tag, 0) + 1
            anchor = a.get("data-anchor")
            if anchor is not None:
                self._record_anchor(anchor, tag)
        elif tag == "details":
            self.score.toggles += 1
            self._details.append({"body": False})
        elif tag == "summary":
            self._in_summary += 1
        elif tag == "div":
            if a.get("data-type") == "callout":
                kind = (a.get("data-callout-type") or "").strip().upper()
                self.score.callouts[kind or "(none)"] = \
                    self.score.callouts.get(kind or "(none)", 0) + 1
                if kind not in CALLOUT_TYPES:
                    self.score.unknown_callouts.append(kind or "(none)")
            elif a.get("data-type") == "math":
                self.score.math_blocks += 1
        elif tag == "table":
            self.score.tables += 1
        elif tag == "tr":
            self.score.table_rows += 1

        if tag not in _VOID:
            self._stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID and self._stack and self._stack[-1] == tag:
            self._stack.pop()

    def handle_endtag(self, tag):
        if tag == "summary" and self._in_summary:
            self._in_summary -= 1
        elif tag == "details" and self._details:
            frame = self._details.pop()
            if frame["body"]:
                self.score.toggles_with_body += 1
        while self._stack:
            if self._stack.pop() == tag:
                break

    def handle_data(self, data):
        text = data.strip()
        if not text:
            return
        self.score.text_chars += len(text)
        # A toggle whose only content is its summary is an empty promise.
        if self._details and not self._in_summary:
            self._details[-1]["body"] = True

    # ── anchors ─────────────────────────────────────────────────────────────
    def _record_anchor(self, anchor: str, tag: str) -> None:
        self.score.anchors.append(anchor)
        match = ANCHOR_RE.match(anchor.strip())
        if not match:
            self.score.anchor_problems.append(f"malformed: {anchor!r}")
            return
        index = int(match.group(1))
        if index < 1 or (self.source_count is not None and index > self.source_count):
            self.score.anchor_problems.append(
                f"source {index} out of range 1..{self.source_count}: {anchor!r}")
            return
        self.score.anchors_valid += 1
        if tag == "h3":
            self.score.anchored_h3 += 1


def score_note(html: str, *, source_count: int | None = None,
               must_mention: list[str] | None = None,
               must_not_mention: list[str] | None = None) -> NoteScore:
    """Count what a generated note actually contains.

    source_count: how many sources the draft was built from, so an anchor
    pointing at source 4 of 2 is caught. None skips that check.
    must_mention: facts the note is expected to carry, matched
    case-insensitively with collapsed whitespace.
    must_not_mention: phrases whose presence is a failure — chiefly the
    adversarial case, where an injected instruction showing up in the output
    means the model treated source text as something to obey.
    """
    parser = _Counter(source_count)
    parser.feed(html or "")
    parser.close()
    score = parser.score

    if must_mention or must_not_mention:
        haystack = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).lower()
        for needle in must_mention or []:
            flat = re.sub(r"\s+", " ", needle).strip().lower()
            if flat and flat in haystack:
                score.must_mention_hit.append(needle)
            else:
                score.must_mention_missed.append(needle)
        for needle in must_not_mention or []:
            flat = re.sub(r"\s+", " ", needle).strip().lower()
            if flat and flat in haystack:
                score.forbidden_hit.append(needle)
    return score
