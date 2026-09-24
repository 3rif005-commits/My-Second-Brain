"""Check a note's section anchors against the sources, and repair the wrong ones.

An anchor `{s:p:N}` / `data-anchor="s:p:N"` says "this section came from page
N of source s". On the Markdown path the model sometimes numbered every
section source 1 although half the note was about source 2 (E6d: 2 of 6 runs
failed an anchor guardrail). The note was right; only the pointers back were
wrong, and a pointer to the wrong lecture is worse than none.

So each section's text is compared with every page of every source by the
distinctive words they share (weighted by how rare the word is across pages).
When another source matches clearly better than the one claimed, the anchor is
rewritten to that source's best page; a section with no anchor gets one when
the match is clear. Anything less clear is left exactly as the model wrote it.
"""
from __future__ import annotations

import html as _html
import math
import re
from collections import Counter

_PAGE = re.compile(r"\[page (\d+)\]")
_WORD = re.compile(r"[a-zA-Z][a-zA-Z\-]{3,}")
_H3 = re.compile(r'<h3(?P<attrs>[^>]*)>(?P<title>.*?)</h3>', re.S)
_ANCHOR = re.compile(r'\s*data-anchor="(\d+):p:(\d+)"')
_NEXT = re.compile(r"<h[123][\s>]")

#: How much better another source must match before an anchor is moved to it.
MARGIN = 1.5
#: The minimum match for adding an anchor where the model wrote none.
MIN_SCORE = 8.0


def _words(text: str) -> set[str]:
    text = _html.unescape(re.sub(r"<[^>]+>", " ", text))
    return {w.lower() for w in _WORD.findall(text)}


def source_pages(sources: list[dict]) -> dict[tuple[int, int], set[str]]:
    """{(source, page): words on that page}, from the `[page N]` tags."""
    pages: dict[tuple[int, int], set[str]] = {}
    for s_no, src in enumerate(sources, start=1):
        text = src.get("text") or ""
        marks = list(_PAGE.finditer(text))
        for i, m in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            pages.setdefault((s_no, int(m.group(1))), set()).update(
                _words(text[m.end():end]))
    return pages


def _best(section: set[str], pages: dict, idf: dict[str, float],
          source: int | None = None) -> tuple[tuple[int, int] | None, float]:
    best, score = None, 0.0
    for key, words in pages.items():
        if source is not None and key[0] != source:
            continue
        s = sum(idf[w] for w in section & words)
        if s > score:
            best, score = key, s
    return best, score


def repair_anchors(html: str, sources: list[dict]) -> tuple[str, int]:
    """Return (html, number of anchors changed or added)."""
    pages = source_pages(sources)
    if len({s for s, _ in pages}) < 2:
        return html, 0              # one source: nothing to confuse it with
    df = Counter(w for words in pages.values() for w in words)
    idf = {w: math.log(len(pages) / n) + 1.0 for w, n in df.items()}

    out, pos, changed = [], 0, 0
    heads = list(_H3.finditer(html))
    for i, h in enumerate(heads):
        nxt = _NEXT.search(html, h.end())
        body = html[h.end(): nxt.start() if nxt else len(html)]
        words = _words(h.group("title") + " " + body)
        claimed = _ANCHOR.search(h.group("attrs"))
        best, best_score = _best(words, pages, idf)
        new_attrs = h.group("attrs")
        if best is not None:
            if claimed:
                src = int(claimed.group(1))
                _, own = _best(words, pages, idf, source=src)
                if best[0] != src and best_score >= MARGIN * max(own, 1e-9):
                    new_attrs = _ANCHOR.sub(f' data-anchor="{best[0]}:p:{best[1]}"',
                                            new_attrs, count=1)
            elif best_score >= MIN_SCORE:
                new_attrs = f'{new_attrs} data-anchor="{best[0]}:p:{best[1]}"'
        if new_attrs != h.group("attrs"):
            changed += 1
            out.append(html[pos:h.start()])
            out.append(f"<h3{new_attrs}>{h.group('title')}</h3>")
            pos = h.end()
    out.append(html[pos:])
    return "".join(out), changed
