"""A worksheet solved unit by unit: Map → Write → Check → Fix.

Design: docs/INTERACTIVE_NOTES_DESIGN.md · plan: docs/plans/2026-11-24-units-phase1.md

The solver used to write the whole page in one call and the app treated it as
finished. Checking 30 answers against the sheet by hand was slow, and the only
fix was to run everything again. Now:

  1. map    — one call returns the plan as data: every exercise, question and
              sub-part, with its own words in the sheet (so the sheet can tint it),
              its kind, its rule names and its highlight. The note gets a
              skeleton of empty toggle headings, each tagged `data-unit="KEY"`.
  2. write  — one call per exercise, in parallel, each landing in its heading.
  3. check  — free checks on what was written (a missing band, a number the
              sheet does not have, a question that could not be found).
  4. fix    — Redo one unit, with or without a note on what to change.

The skill's instructions (SKILL.md) are never edited: every call sends them
whole, then a short engine note saying what this call writes — the way
chaptered.py writes one chapter of a study guide. The skill text and the
sources come first and are the same in every call, so a provider cache pays
for them once.

Keys are the plan's path: "1" exercise 1, "1.2" its second question, "1.2.1"
that question's first sub-part; "" is the title, "revision" the revision sheet.
"""
from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
import contextvars
from typing import Iterator

from services import privacy

logger = logging.getLogger(__name__)

SKILL = "solve-worksheet"
#: skills that run unit by unit instead of in one call
UNIT_SKILLS = {SKILL}
WORKERS = 4
MAP_OUTPUT_CAP = 8000

HIGHLIGHTS = ("red", "orange", "yellow")
HIGHLIGHT_CAPS = {"red": 2, "orange": 3, "yellow": 4}
KINDS = ("Recall", "Short", "Multi-step", "Open")
RULE_LEVELS = ("must know", "core", "needed", "supporting", "background")

NEEDS_LABEL = "Needs:"
QUOTE_PROBLEM = "this question's words were not found in the sheet"
GREY = '<span data-style-type="textColor" data-value="gray">'
NOT_SOLVED = "<p><em>Not solved yet.</em></p>"


# ── the plan ────────────────────────────────────────────────────────────────

MAP_NOTE = """
---
THIS CALL ONLY PLANS THE PAGE. Write no solution and no HTML.
Do the BEFORE WRITING steps above (find the worksheet, list every question and
sub-part with the worksheet's own numbering, give each a kind from DEPTH,
choose the HEADING HIGHLIGHTS, name the general laws) and answer with JSON only:

{"title": "<the worksheet's title>",
 "worksheet": <the number N of the === SOURCE N === that is the worksheet>,
 "exercises": [
   {"label": "<the worksheet's label, e.g. Exercise 01>",
    "topic": "<2 to 5 words>",
    "shared": "<data shared by the whole exercise, condensed, every value with its unit, or an empty string>",
    "page": <the page where it starts>,
    "questions": [
      {"label": "<its number, e.g. 1 or Q1, or an empty string>",
       "title": "<the thing it is about, 1 to 4 words>",
       "importance": "red" | "orange" | "yellow" | "",
       "question": "<the grey line: the question condensed, every given value with its unit, maths between $ signs>",
       "quote": "<8 to 20 words of the question copied EXACTLY, character for character, from the source text>",
       "page": <page>,
       "kind": "Recall" | "Short" | "Multi-step" | "Open",
       "rules": ["<rule name>"],
       "needs": ["<what the answer must contain besides steps and the band, e.g. K-map F1, truth table, PAL programming table, circuit>"],
       "parts": [<the sub-parts, each with the same fields as a question and its letter as label, e.g. "(a)"; [] when there are none>]}]}],
 "rules": [{"name": "<rule name>", "importance": "must know" | "core" | "needed" | "supporting" | "background"}]}

- Every question and every sub-part of the worksheet appears once, in the
  worksheet's order. Skip none, merge none.
- A question with sub-parts may leave its own "question", "quote", "kind" and
  "rules" empty: its parts carry them. An exercise with a single question
  still has one entry in "questions".
- "quote" must be findable in the source text above: copy it, never reword it.
- A rule name is what you would write on the Rule line, the same words every
  time; every name used by a question is also in the top-level "rules".
- "needs" lists what the answer must SHOW, from the question and from the
  method the course uses for it: a Karnaugh map for each function minimised
  (3 or 4 variables), a truth table, a PLA/PAL programming table, a circuit
  for "design/draw/implement a circuit", a diagram, code. Name each one with
  what it is of ("K-map F2", "circuit"). [] when the steps and the band are enough.
- Highlights follow HEADING HIGHLIGHTS: red at most 2, orange at most 3,
  yellow at most 4, on questions and sub-parts only.
"""


def _text(v) -> str:
    return str(v or "").strip()


def _int(v) -> int | None:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _json_object(raw: str) -> dict:
    m = re.search(r"\{.*\}", raw or "", re.S)
    if not m:
        raise ValueError("The plan was not JSON.")
    return json.loads(m.group(0))


def squash(text: str) -> str:
    """Lower case, one space, no LaTeX dollar signs: how a quote is looked for."""
    t = re.sub(r"[$\\{}]", "", (text or "").lower())
    t = t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", t).strip()


def _alnum(text: str) -> tuple[str, list[int]]:
    """Letters and digits only, lower case, with maths letters made plain
    (NFKC: the PDF's italic 𝑌 is a Y), and where each came from in `text`."""
    import unicodedata
    out, where = [], []
    for i, ch in enumerate(text or ""):
        for c in unicodedata.normalize("NFKC", ch).lower():
            if c.isalnum():
                out.append(c)
                where.append(i)
    return "".join(out), where


def locate_quote(quote: str, source_text: str) -> tuple[int, str] | None:
    """(page, the quote's words as the source writes them) or None.

    Matched on letters and digits only: the model copies words, not the
    PDF's spacing, punctuation or maths letters (live: "for Y." against the
    sheet's "for 𝑌."). A long quote is tried whole, then by its start. The
    span returned is the source's own text, so the viewer's tint matches the
    PDF's text layer. Page 0: an untagged source."""
    q, _ = _alnum(quote)
    if len(q) < 6:
        return None
    parts = re.split(r"^\[page (\d+)\]$", source_text or "", flags=re.M)
    pages = [(0, source_text or "")] if len(parts) == 1 else \
        [(int(pg), body) for pg, body in zip(parts[1::2], parts[2::2])]
    for probe in (q, q[:40]):
        for page, body in pages:
            flat, where = _alnum(body)
            at = flat.find(probe)
            if at >= 0:
                span = body[where[at]:where[at + len(probe) - 1] + 1]
                return page, re.sub(r"\s+", " ", span).strip()
    return None


def find_quote(quote: str, source_text: str) -> int | None:
    """The page holding `quote` (0 for an untagged source), or None."""
    hit = locate_quote(quote, source_text)
    return hit[0] if hit else None


def _unit(key: str, parent: str | None, depth: int, raw: dict, label: str, title: str,
          source: int) -> dict:
    importance = _text(raw.get("importance")).lower()
    kind = _text(raw.get("kind"))
    return {
        "key": key, "parent_key": parent, "depth": depth,
        "label": label, "title": title,
        "question": _text(raw.get("question")),
        "quote": _text(raw.get("quote")),
        "source": source, "page": _int(raw.get("page")),
        "kind": kind if kind in KINDS else "",
        "rules": [_text(r) for r in (raw.get("rules") or []) if _text(r)],
        "needs": [_text(n) for n in (raw.get("needs") or []) if _text(n)][:8],
        "importance": importance if importance in HIGHLIGHTS and depth >= 3 else "",
        "problems": [],
    }


def parse_plan(raw: str, sources: list[dict]) -> dict:
    """The map call's answer → {title, worksheet, units: [...], rules: [...]}.

    Raises ValueError with a reason a person can read when the plan is unusable.
    Every unit's quote is looked for in the worksheet's text; one that is not
    there is a problem to show, and its page is taken from where it was found.
    """
    data = _json_object(raw)
    exercises = data.get("exercises") or []
    if not isinstance(exercises, list) or not exercises:
        raise ValueError("The plan found no questions in the sources.")
    sheet = _int(data.get("worksheet")) or 1
    if sheet > len(sources):
        sheet = 1
    sheet_text = (sources[sheet - 1].get("text") or "") if sources else ""

    title = _text(data.get("title")) or (sources[sheet - 1].get("title") if sources else "Worksheet")
    units: list[dict] = [{"key": "", "parent_key": None, "depth": 1, "label": "",
                          "title": f"{title}: Solutions", "question": "", "quote": "",
                          "source": sheet, "page": None, "kind": "", "rules": [],
                          "needs": [], "importance": "", "problems": []}]
    for e, ex in enumerate(exercises, start=1):
        if not isinstance(ex, dict):
            continue
        label = _text(ex.get("label")) or f"Exercise {e}"
        topic = _text(ex.get("topic"))
        ek = str(e)
        exu = _unit(ek, "", 2, ex, label, f"{label} · {topic}" if topic else label, sheet)
        exu["question"] = _text(ex.get("shared"))
        questions = [q for q in (ex.get("questions") or []) if isinstance(q, dict)]
        units.append(exu)
        if len(questions) == 1 and not (questions[0].get("parts") or []):
            # SKILL.md: an exercise with a single question has no level 3 —
            # the exercise IS the question.
            q = questions[0]
            for f in ("question", "quote", "kind", "rules", "needs"):
                exu[f] = _unit(ek, "", 2, q, "", "", sheet)[f] or exu[f]
            exu["page"] = exu["page"] or _int(q.get("page"))
            continue
        lone = len(questions) == 1
        for qi, q in enumerate(questions, start=1):
            parts = [p for p in (q.get("parts") or []) if isinstance(p, dict)]
            if lone:
                # One question with sub-parts: its parts sit right under the exercise.
                for f in ("question", "quote", "kind", "rules", "needs"):
                    exu[f] = exu[f] or _unit(ek, "", 2, q, "", "", sheet)[f]
                for pi, p in enumerate(parts, start=1):
                    pl = _text(p.get("label")) or f"({chr(96 + pi)})"
                    units.append(_unit(f"{ek}.{pi}", ek, 3, p, pl,
                                       f"{pl} {_text(p.get('title'))}".strip(), sheet))
                break
            qk = f"{ek}.{qi}"
            qlabel = _text(q.get("label"))
            if len(parts) == 1:
                # One sub-part is the question itself, not a level below it
                # (live: each task of an exercise came back as "(a)" alone).
                p = parts[0]
                merged = {**p, **{f: q.get(f) for f in ("question", "quote", "kind", "rules", "importance", "needs")
                                  if q.get(f)}}
                units.append(_unit(qk, ek, 3, merged, qlabel,
                                   _text(q.get("title")) or _text(p.get("title")) or qlabel or f"Question {qi}",
                                   sheet))
                continue
            units.append(_unit(qk, ek, 3, q, qlabel, _text(q.get("title")) or qlabel or f"Question {qi}",
                               sheet))
            for pi, p in enumerate(parts, start=1):
                pl = _text(p.get("label")) or f"({chr(96 + pi)})"
                units.append(_unit(f"{qk}.{pi}", qk, 4, p, pl,
                                   f"{pl} {_text(p.get('title'))}".strip(), sheet))
    if len(units) < 2:
        raise ValueError("The plan found no questions in the sources.")

    _cap_highlights(units)
    for u in units:
        u["needs"] = ensure_needs(u.get("question", ""), u.get("needs") or [])
    for u in units:
        u["position"] = units.index(u)
        if not u["key"] or not u["quote"]:
            continue
        hit = locate_quote(u["quote"], sheet_text)
        if hit is None:
            u["problems"].append(QUOTE_PROBLEM + ": check that it was read right")
        else:
            page, u["quote"] = hit
            if page:
                u["page"] = page

    # A unit with no words of its own (an exercise whose questions carry them)
    # takes the page of its first part that was found (live: Exercise 5 said
    # page 2, the teacher's solution page, while its tasks are on page 1).
    for u in units:
        if u["key"] and not u["quote"]:
            kid = next((k for k in units if k["key"].startswith(u["key"] + ".") and k["quote"]
                        and not k["problems"]), None)
            if kid and kid["page"]:
                u["page"] = kid["page"]

    rules = []
    for r in data.get("rules") or []:
        name = _text(r.get("name") if isinstance(r, dict) else r)
        level = _text(r.get("importance") if isinstance(r, dict) else "").lower()
        if name and not any(x["name"].lower() == name.lower() for x in rules):
            rules.append({"name": name, "importance": level if level in RULE_LEVELS else "needed"})
    for u in units:                      # a rule a question uses is always listed
        for name in u["rules"]:
            if not any(x["name"].lower() == name.lower() for x in rules):
                rules.append({"name": name, "importance": "needed"})
    return {"title": title, "worksheet": sheet, "units": units, "rules": rules}


_DESIGN = re.compile(r"\b(design|implement|realis|realiz|draw|build)\w*", re.I)
_DEVICE = re.compile(r"\b(PLA|PAL)\b")


def ensure_needs(question: str, needs: list[str]) -> list[str]:
    """What a logic question must show, whatever the model planned.

    Live 2026-11-24 (ESD 2 Tutorial 3): the map planned truth tables but no
    Karnaugh map for Σ(…) functions of 3 and 4 variables, and no circuit for
    "design a PLA". Rules any course would apply, added in code:
    - each Σ-function of 3 or 4 variables → "K-map F";
    - design/implement … with a PLA or PAL → its programming table and a circuit.
    """
    from services.workspace.logic_check import reference_functions
    out = list(needs)
    have = " ".join(out).lower()
    for name, ref in reference_functions(question or "").items():
        if "names" in ref and 3 <= len(ref["names"]) <= 4 and not re.search(
                rf"k-?map\W*{re.escape(name.lower())}\b|karnaugh\W*{re.escape(name.lower())}\b", have):
            out.append(f"K-map {name}")
    dev = _DEVICE.search(question or "")
    if dev and _DESIGN.search(question or ""):
        if not re.search(rf"{dev.group(1).lower()}.*table|programming table", have):
            out.append(f"{dev.group(1)} programming table")
        if not re.search(r"circuit|diagram", have):
            out.append("circuit")
    return out[:8]


def _cap_highlights(units: list[dict]) -> None:
    """At most 2 red, 3 orange, 4 yellow; over a cap moves down one level.
    Models read caps and still exceed them (rule_caps in skill_html.py)."""
    used: dict[str, int] = {}
    for u in units:
        level = u["importance"]
        while level and used.get(level, 0) >= HIGHLIGHT_CAPS[level]:
            nxt = HIGHLIGHTS.index(level) + 1
            level = HIGHLIGHTS[nxt] if nxt < len(HIGHLIGHTS) else ""
        u["importance"] = level
        if level:
            used[level] = used.get(level, 0) + 1


def children(units: list[dict], key: str) -> list[dict]:
    return [u for u in units if u["parent_key"] == key]


def leaves(units: list[dict]) -> list[dict]:
    """The units an answer band belongs to: no sub-units, not the title."""
    return [u for u in units if u["key"] and not children(units, u["key"])]


# ── the skeleton ────────────────────────────────────────────────────────────

def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def heading(u: dict) -> str:
    """The unit's toggle heading, opening tag to </summary>, as the skill writes it."""
    title = _esc(u["title"])
    if u["importance"]:
        title = f'<span data-style-type="backgroundColor" data-value="{u["importance"]}">{title}</span>'
    d = u["depth"]
    return f'<details><summary><h{d} data-unit="{u["key"]}">{title}</h{d}></summary>'


def _skeleton_unit(u: dict, units: list[dict]) -> str:
    kids = children(units, u["key"])
    body = []
    if u["question"]:
        body.append(f"<p>{GREY}{_esc(u['question'])}</span></p>")
    if u.get("needs"):
        # Editable before Solve all: the note's line is what gets written.
        body.append(f"<p>{GREY}{NEEDS_LABEL} {_esc(' · '.join(u['needs']))}</span></p>")
    if kids:
        body.extend(_skeleton_unit(k, units) for k in kids)
    else:
        body.append(NOT_SOLVED)
    return heading(u) + "\n" + "\n".join(body) + "\n</details>"


def skeleton_html(plan: dict) -> str:
    """The page before anything is solved: the title, every exercise and
    question as the toggle headings it will have, each with its grey question
    line, and the revision sheet's heading. Maths stays `$…$` here; the caller
    runs it through skill_html.inline_math like any answer."""
    units = plan["units"]
    root = units[0]
    parts = [f'<h1 data-unit="">{_esc(root["title"])}</h1>']
    parts += [_skeleton_unit(u, units) for u in children(units, "")]
    parts.append('<h2 data-unit="revision">Revision sheet</h2>')
    parts.append("<p><em>Written once every question is solved.</em></p>")
    return "\n".join(parts)


# ── writing ─────────────────────────────────────────────────────────────────

def _outline(units: list[dict]) -> str:
    lines = []
    for u in units[1:]:
        pad = "  " * (u["depth"] - 2)
        extra = f" — {u['kind']}" if u["kind"] else ""
        rules = f"; rules: {', '.join(u['rules'])}" if u["rules"] else ""
        lines.append(f"{pad}{u['key']}: {u['title']}{extra}{rules}")
    return "\n".join(lines)


def _unit_spec(u: dict, units: list[dict]) -> str:
    """The headings this call must write, with their grey lines and plan."""
    out = []

    def walk(x: dict) -> None:
        pad = "  " * (x["depth"] - u["depth"])
        out.append(f"{pad}{heading(x)}")
        if x["question"]:
            out.append(f"{pad}  grey line: {x['question']}")
        bits = [f"kind {x['kind']}" if x["kind"] else "",
                f"MUST SHOW: {', '.join(x['needs'])}" if x.get("needs") else "",
                f"rules: {', '.join(x['rules'])}" if x["rules"] else ""]
        if any(bits):
            out.append(f"{pad}  plan: {'; '.join(b for b in bits if b)}")
        for k in children(units, x["key"]):
            walk(k)
        out.append(f"{pad}</details>")

    walk(u)
    return "\n".join(out)


WRITE_NOTE = """
---
THIS CALL WRITES ONE PART OF THE SOLUTIONS PAGE, from the plan below. The
other parts are written separately and joined after.

The whole worksheet, as planned:
{outline}

Write ONLY {what}. Use exactly these headings, in this order, each with its
data-unit attribute and its highlight exactly as written (the attribute ties
each answer to its question in the sheet), and put each grey line right under
its heading:
{spec}

- No <h1>, no Overview, no revision sheet and no Answer key: they are written
  separately.
- Name the rules exactly as in the plan: {rules}. Add no highlight.
- Every item a part MUST SHOW is written, inside its Solution toggle, as its
  own block between the steps: a Karnaugh map is a table with Gray-code
  headers (00, 01, 11, 10) and one line per group under it ("m12, m13 →
  $AB\bar C$"); a PLA/PAL programming table has one row per product term,
  inputs as 1/0/–, outputs as ×; a circuit is a Mermaid flowchart LR (inputs,
  one node per gate named by type and term, arrows as wires, the output); a
  truth table is a table. Never describe in words something the part must show.
- Everything else follows the instructions above, at full depth for this part.
{extra}Write it now:"""


def unit_prompt_prefix(skill_body: str, sources_block: str) -> str:
    """The part of every unit call that never changes for this note."""
    return f"{skill_body}\n\n{sources_block}"


def write_note(u: dict, units: list[dict], rules: list[dict], extra: str = "") -> str:
    what = f'"{u["title"]}" (data-unit="{u["key"]}")'
    return WRITE_NOTE.format(outline=_outline(units), what=what,
                             spec=_unit_spec(u, units),
                             rules=", ".join(r["name"] for r in rules) or "(none planned)",
                             extra=extra)


def redo_extra(current_html: str, note: str) -> str:
    note = (note or "").strip()
    ask = (f'The student read this part and asks: "{note}". Do what they ask and '
           "keep everything they did not ask to change." if note else
           "The student wants it written again: solve it afresh from the sheet, "
           "check every step, and keep what was right.")
    return ("\nITS CURRENT VERSION, which this call replaces:\n"
            f"{current_html.strip()}\n\n{ask}\n\n")


_UNIT_HEAD = re.compile(r"<h([1-4])\b([^>]*)>", re.I)
_UNIT_ATTR = re.compile(r'\sdata-unit="([^"]*)"')


def restore_keys(html: str, expected: list[dict]) -> str:
    """Every heading of the written part gets the data-unit it was asked for.

    A model drops or mangles attributes now and then; the headings it writes
    come in the planned order, so a heading without a known key takes the next
    planned key of the same level."""
    wanted = [(u["depth"], u["key"]) for u in expected]
    known = {k for _, k in wanted}
    seen: set[str] = set()
    out, pos = [], 0
    for m in _UNIT_HEAD.finditer(html):
        level, attrs = int(m.group(1)), m.group(2)
        a = _UNIT_ATTR.search(attrs)
        key = a.group(1) if a else None
        if key not in known or key in seen:
            key = next((k for d, k in wanted if d == level and k not in seen), None)
            attrs = _UNIT_ATTR.sub("", attrs)
            if key is not None:
                attrs += f' data-unit="{key}"'
        if key is not None:
            seen.add(key)
        out.append(html[pos:m.start()] + f"<h{level}{attrs}>")
        pos = m.end()
    out.append(html[pos:])
    return "".join(out)


def subtree(units: list[dict], key: str) -> list[dict]:
    return [u for u in units if u["key"] == key or u["key"].startswith(key + ".")]


# ── free checks ─────────────────────────────────────────────────────────────

_BAND = re.compile(r'data-background-color="green"', re.I)
_GREY_LINE = re.compile(r'<span data-style-type="textColor" data-value="gray">(.*?)</span>', re.S)
_NUMBER = re.compile(r"(?<![\w.])\d+(?:[.,]\d+)?")
_TAGS = re.compile(r"<[^>]+>")


def _segments(html: str) -> dict[str, str]:
    """Each data-unit heading → the HTML from it to the next data-unit heading."""
    marks = [(m.start(), m.group(1)) for m in re.finditer(r'<h[1-4][^>]*\sdata-unit="([^"]*)"', html)]
    return {key: html[start:(marks[i + 1][0] if i + 1 < len(marks) else len(html))]
            for i, (start, key) in enumerate(marks)}


def _numbers(text: str) -> set[str]:
    return {n.replace(",", ".") for n in _NUMBER.findall(text)}


def _significant(n: str) -> bool:
    """A number worth checking: a decimal, or three digits or more. "2" or
    "10" turn up everywhere and prove nothing."""
    return "." in n or len(n) >= 3


def free_checks(html: str, units: list[dict], sheet_text: str,
                everyone: list[dict] | None = None) -> dict[str, list[str]]:
    """Problems per unit key, found without a model. Leaves need exactly one
    answer band; a number in a grey question line must be in the sheet."""
    segs = _segments(html)
    in_sheet = _numbers(_TAGS.sub(" ", sheet_text or ""))
    out: dict[str, list[str]] = {}
    for u in units:
        seg = segs.get(u["key"])
        if seg is None:
            if u["key"]:
                out.setdefault(u["key"], []).append("this question was not written: Redo it")
            continue
        probs: list[str] = []
        if not children(units, u["key"]):
            # Several bands are fine: a question asking for F1 and F2 has two
            # answers (live 2026-11-24, ESD tutorial 3). None is a gap.
            if not _BAND.findall(seg):
                probs.append("no answer band")
        grey = _GREY_LINE.search(seg)
        if grey and sheet_text:
            missing = sorted(n for n in _numbers(_TAGS.sub(" ", grey.group(1)))
                             if _significant(n) and n not in in_sheet)
            if missing:
                probs.append("not in the sheet: " + ", ".join(missing[:4])
                             + " — check the question's data")
        # What the part must show (the map's "needs"): a K-map or a table is a
        # <table>, a circuit or a diagram is a Mermaid block — in this part or
        # its sub-parts (live: PLA/PAL design came back as words only).
        if u.get("needs"):
            body = "".join(segs.get(x["key"], "") for x in units
                           if x["key"] == u["key"] or x["key"].startswith(u["key"] + "."))
            tables = len(re.findall(r"<table\b", body, re.I))
            drawings = len(re.findall(r"language-mermaid|data-sb-blocks", body, re.I))
            missing = []
            for need in u["needs"]:
                if _DRAWING_NEED.search(need):
                    if drawings:
                        drawings -= 1
                    else:
                        missing.append(need)
                elif _TABLE_NEED.search(need):
                    if tables:
                        tables -= 1
                    else:
                        missing.append(need)
            if missing:
                probs.append("missing: " + ", ".join(missing) + " — Redo it")
        # A Boolean answer is checked against the function the question gives.
        bands = _BAND_P.findall(seg)
        if bands:
            from services.workspace import logic_check
            asked = " ; ".join(x["question"] for x in _ancestry(u, everyone or units)
                               if x.get("question"))
            for band in bands:
                probs += logic_check.check(asked, band)
        if probs:
            out[u["key"]] = probs
    return out


_TABLE_NEED = re.compile(r"k-?map|karnaugh|table", re.I)
_DRAWING_NEED = re.compile(r"circuit|diagram|schematic|drawing|logic gate", re.I)


def _ancestry(u: dict, units: list[dict]) -> list[dict]:
    """The unit and the units above it, nearest first (their questions hold
    the data a sub-part answers)."""
    chain, k = [], u
    while k is not None:
        chain.append(k)
        k = next((x for x in units if x["key"] == k.get("parent_key")), None) if k.get("parent_key") else None
    return chain


# ── the answer key ──────────────────────────────────────────────────────────

_BAND_P = re.compile(r'<p[^>]*data-background-color="green"[^>]*>(.*?)</p>', re.S | re.I)
_ANSWER_LABEL = re.compile(r"^\s*<strong>[^<]*:</strong>\s*", re.I)


def _short_label(u: dict, units: list[dict]) -> str:
    chain, k = [], u
    while k and k["key"]:
        chain.append(k["label"] or k["title"])
        k = next((x for x in units if x["key"] == k["parent_key"]), None)
    chain.reverse()
    # "Exercise 01" → "01": the table's rows are short.
    if chain:
        chain[0] = re.sub(r"^(?:exercise|exercice|ex\.?|problem|question)\s*", "", chain[0],
                          flags=re.I) or chain[0]
    return " ".join(c for c in chain if c)


def answer_key(html: str, units: list[dict]) -> str:
    """A Q | Answer table from the green bands, in page order. No model."""
    segs = _segments(html)
    rows = []
    for u in units:
        seg = segs.get(u["key"])
        if not u["key"] or seg is None or children(units, u["key"]):
            continue
        for band in _BAND_P.findall(seg):
            rows.append(f"<tr><td>{_esc(_short_label(u, units))}</td>"
                        f"<td>{_ANSWER_LABEL.sub('', band).strip()}</td></tr>")
    if not rows:
        return ""
    return ("<h3>Answer key</h3>\n<table><tr><th>Q</th><th>Answer</th></tr>\n"
            + "\n".join(rows) + "</table>")


FINISH_NOTE = """
---
THIS CALL WRITES THE TOP AND THE END OF A SOLUTIONS PAGE whose questions are
already solved. The solved questions are below. Write exactly two things, in
this order, and nothing else:
1. The OVERVIEW callout of THE TOP OF THE PAGE (no <h1>).
2. <h2>Revision sheet</h2> then <h3>Rules &amp; formulas</h3> and its boxes, as
   RULES & FORMULAS says, one box per rule named on the Rule lines below. Do
   NOT write the Answer key: it is built from the green bands.

THE SOLVED QUESTIONS:
{solved}

Write it now:"""

_OVERVIEW = re.compile(r'<div data-type="callout" data-callout-type="OVERVIEW".*?</details>\s*</div>',
                       re.S | re.I)
_SHEET_H2 = re.compile(r"<h2[^>]*>\s*Revision sheet\s*</h2>", re.I)


def split_finish(answer: str) -> tuple[str, str]:
    """(overview callout, revision sheet from its <h2>), either may be ''."""
    ov = _OVERVIEW.search(answer)
    sheet = _SHEET_H2.search(answer)
    return (ov.group(0) if ov else "", answer[sheet.start():] if sheet else "")


# ── running it ──────────────────────────────────────────────────────────────

class Runner:
    """One note's unit calls: the skill text and the sources are built once,
    and each call adds only its engine note. `complete(prompt_prefix, note,
    max_tokens)` is the model; tests pass a fake."""

    def __init__(self, skill_body: str, sources: list[dict], complete):
        self.sources = sources
        self.prefix = unit_prompt_prefix(skill_body, _sources_block(sources))
        self.complete = complete

    def plan(self) -> dict:
        raw = self.complete(self.prefix, MAP_NOTE, MAP_OUTPUT_CAP)
        return parse_plan(raw, self.sources)

    def sheet_text(self, plan: dict) -> str:
        i = plan.get("worksheet") or 1
        return (self.sources[i - 1].get("text") or "") if self.sources else ""

    def write(self, plan: dict, key: str, current_html: str = "", note: str = "",
              redo: bool = False) -> dict:
        """One unit (with everything under it) → {key, raw, problems}."""
        from services.workspace.synthesis import OUTPUT_CAP, _strip_fences
        units = plan["units"]
        u = next(x for x in units if x["key"] == key)
        extra = redo_extra(current_html, note) if redo else ""
        raw = _strip_fences(self.complete(self.prefix, write_note(u, units, plan["rules"], extra),
                                          OUTPUT_CAP))
        if not raw.strip():
            raise ValueError("The model returned nothing.")
        raw = restore_keys(raw, subtree(units, key))
        problems = free_checks(raw, subtree(units, key), self.sheet_text(plan), units)
        # One repair pass for what the free checks can name exactly — a part
        # that must show a K-map or a circuit and doesn't, a missing answer
        # band (live 2026-11-24: Nemotron skipped every K-map it was told to
        # write). The model gets its own answer and the list; the better of
        # the two answers is kept.
        fixable = {k: [p for p in v if p.startswith(("missing:", "no answer band"))]
                   for k, v in problems.items()}
        fixable = {k: v for k, v in fixable.items() if v}
        if fixable:
            todo = "; ".join(f"{k}: {', '.join(v)}" for k, v in fixable.items())
            again = _strip_fences(self.complete(self.prefix, write_note(
                u, units, plan["rules"], redo_extra(raw, "Add what is missing, keep the rest: " + todo)),
                OUTPUT_CAP))
            if again.strip():
                again = restore_keys(again, subtree(units, key))
                second = free_checks(again, subtree(units, key), self.sheet_text(plan), units)
                if sum(map(len, second.values())) < sum(map(len, problems.values())):
                    raw, problems = again, second
        return {"key": key, "raw": raw, "problems": problems}

    def finish(self, plan: dict, written_raw: list[str]) -> dict:
        """The Overview, the revision sheet (its boxes checked against the Rule
        lines) and the answer key, from the solved questions."""
        from services.workspace import skill_html
        from services.workspace.synthesis import OUTPUT_CAP, _strip_fences
        solved = "\n".join(written_raw)
        answer = _strip_fences(self.complete(self.prefix, FINISH_NOTE.format(solved=solved),
                                             OUTPUT_CAP))
        overview, sheet = split_finish(answer)
        if not sheet:
            sheet = "<h2>Revision sheet</h2>\n<h3>Rules &amp; formulas</h3>"
        # rule_sheet adds a box for every rule a solution uses and drops the
        # ones none uses — the same check the one-call page gets.
        doc = skill_html.rule_caps(skill_html.rule_sheet(solved + "\n" + sheet))
        sheet = doc[_SHEET_H2.search(doc).start():] if _SHEET_H2.search(doc) else sheet
        key_table = answer_key(solved, plan["units"])
        sheet = sheet.rstrip() + ("\n" + key_table if key_table else "")
        return {"overview": overview,
                "revision": _SHEET_H2.sub('<h2 data-unit="revision">Revision sheet</h2>', sheet, count=1)}


def _sources_block(sources: list[dict]) -> str:
    """The note's sources exactly as every other skill gets them."""
    from prompts.note_synthesis import TOTAL_SOURCE_BUDGET, _source_block, split_budget
    from services.workspace.skill_run import strip_extraction_ids
    budgets = split_budget([len((s.get("text") or "").strip()) for s in sources],
                           TOTAL_SOURCE_BUDGET)
    blocks = [_source_block(i, {**s, "text": strip_extraction_ids(s.get("text") or "")}, b)
              for i, (s, b) in enumerate(zip(sources, budgets), start=1)]
    return (f"---\nSOURCE MATERIAL — {len(sources)} source(s) attached:\n\n"
            + "\n".join(blocks) + "\n---")


def finished(raw: str) -> str:
    """A unit's raw answer → the HTML the editor applies (maths, diagrams)."""
    from services.workspace import skill_html
    return skill_html.finish(raw)


def solve_parallel(runner: Runner, plan: dict, keys: list[str]) -> Iterator[dict]:
    """Write each unit in `keys`, WORKERS at a time; yield each as it lands
    ({key, raw, problems} or {key, error})."""
    ctx = contextvars.copy_context()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(ctx.copy().run, runner.write, plan, k): k for k in keys}
        for f in as_completed(futures):
            try:
                yield f.result()
            except Exception as e:                  # noqa: BLE001
                logger.warning(f"unit {futures[f]} failed: {e}")
                yield {"key": futures[f], "error": str(e)[:300]}


# ── the note's units in the database ────────────────────────────────────────

#: what the client gets for each unit
PUBLIC = ("key", "parent_key", "depth", "label", "title", "question", "quote", "page", "needs",
          "kind", "rules", "importance", "state", "problems", "block_id", "pending",
          "resource_id", "position", "versions")


def _db():
    from services.database import get_supabase
    return get_supabase()


def save_plan(note_id: str, user_id: str, plan: dict, source_ids: list[str]) -> list[dict]:
    """Replace this note's units with the plan's. The title row keeps the
    plan's rule list (its `rules`), so a later call can rebuild the plan."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for u in plan["units"]:
        src = u.get("source") or plan.get("worksheet") or 1
        rows.append({
            "note_id": note_id, "user_id": user_id, "key": u["key"], "skill": SKILL,
            "parent_key": u["parent_key"], "depth": u["depth"], "label": u["label"],
            "title": u["title"], "question": u["question"], "quote": u["quote"],
            "resource_id": source_ids[src - 1] if 0 < src <= len(source_ids) else None,
            "page": u["page"], "kind": u["kind"],
            "rules": plan["rules"] if u["key"] == "" else u["rules"],
            "importance": u["importance"],
            "needs": u.get("needs") or [],
            # Not written yet, whatever the map found: Solve all writes every
            # exercise still "planned". The problems show on the mark meanwhile.
            "state": "planned",
            "problems": u["problems"], "position": u["position"], "updated_at": now,
        })
    # The revision sheet's heading is in the skeleton: it needs a row too, or
    # the note cannot find where to put the sheet (live: never written).
    rows.append({"note_id": note_id, "user_id": user_id, "key": "revision", "skill": SKILL,
                 "parent_key": None, "depth": 2, "label": "", "title": "Revision sheet",
                 "question": "", "quote": "", "resource_id": None, "page": None, "kind": "",
                 "rules": [], "needs": [], "importance": "", "state": "planned", "problems": [],
                 "position": len(rows), "updated_at": now})
    db = _db()
    db.table("note_units").delete().eq("note_id", note_id).execute()
    try:
        db.table("note_units").insert(rows).execute()
    except Exception as e:                          # noqa: BLE001
        # Before migration 036 there is no `needs` column: keep working
        # without it rather than losing the plan.
        if "needs" not in str(e):
            raise
        logger.warning("note_units.needs missing — run migration 036")
        db.table("note_units").insert([{k: v for k, v in r.items() if k != "needs"}
                                       for r in rows]).execute()
    return rows


def load_rows(note_id: str, user_id: str) -> list[dict]:
    return (_db().table("note_units").select("*").eq("note_id", note_id)
            .eq("user_id", user_id).order("position").execute().data or [])


def plan_from_rows(rows: list[dict], source_ids: list[str]) -> dict:
    """The stored rows → the plan shape the writers take."""
    if not rows:
        raise ValueError("This note has no solving plan: run /solve-worksheet first.")
    root = next((r for r in rows if r["key"] == ""), rows[0])
    sheet = (source_ids.index(root["resource_id"]) + 1
             if root.get("resource_id") in source_ids else 1)
    units = []
    for r in rows:
        if r["key"] in ("revision", "overview"):
            continue                    # places in the page, not parts of the plan
        units.append({"key": r["key"], "parent_key": r["parent_key"], "depth": r["depth"],
                      "label": r["label"] or "", "title": r["title"] or "",
                      "question": r["question"] or "", "quote": r["quote"] or "",
                      "source": sheet, "page": r["page"], "kind": r["kind"] or "",
                      "rules": [] if r["key"] == "" else list(r["rules"] or []),
                      "importance": r["importance"] or "", "problems": list(r["problems"] or []),
                      "needs": list(r.get("needs") or []),
                      "position": r["position"]})
    rules = [x for x in (root.get("rules") or []) if isinstance(x, dict)]
    return {"title": root["title"], "worksheet": sheet, "units": units, "rules": rules}


def update_unit(note_id: str, user_id: str, key: str, fields: dict) -> None:
    from datetime import datetime, timezone
    (_db().table("note_units").update({**fields, "updated_at": datetime.now(timezone.utc).isoformat()})
     .eq("note_id", note_id).eq("user_id", user_id).eq("key", key).execute())


def bind_blocks(note_id: str, user_id: str, pairs: list[dict]) -> int:
    """[{key, block_id}] → each unit's heading block, once the skeleton or a
    written unit is in the note."""
    n = 0
    for p in pairs:
        key, block = str(p.get("key") if p.get("key") is not None else ""), str(p.get("block_id") or "")
        if block:
            update_unit(note_id, user_id, key, {"block_id": block})
            n += 1
    return n


def public(rows: list[dict]) -> list[dict]:
    return [{k: r.get(k) for k in PUBLIC} for r in rows]


def _record_written(note_id: str, user_id: str, plan: dict, key: str,
                    problems: dict[str, list[str]], pending: bool = False) -> None:
    """Every unit of a written subtree: written, or flagged with what was found."""
    for u in subtree(plan["units"], key):
        # What the map found (a question not found in the sheet) still holds.
        probs = [p for p in u["problems"] if p.startswith(QUOTE_PROBLEM)] + problems.get(u["key"], [])
        update_unit(note_id, user_id, u["key"], {
            "state": "flagged" if probs else "written", "problems": probs,
            **({"pending": True} if pending and u["key"] == key else {})})


# ── entry points ────────────────────────────────────────────────────────────

def _model(user_id: str, temperature: float | None):
    """complete(prefix, note, max_tokens) on the user's summarize chain. The
    prefix — the skill and the sources — is marked for the provider's cache."""
    from core.config import settings
    from services.ai.client import sampling
    from services.ai.router import complete_with_fallback

    def complete(prefix: str, note: str, max_tokens: int) -> str:
        content = ([{"type": "text", "text": prefix, "cache": True},
                    {"type": "text", "text": note}]
                   if settings.synthesis_prompt_cache else prefix + note)
        with sampling(temperature):
            return complete_with_fallback("summarize_text", user_id,
                                          [{"role": "user", "content": content}],
                                          max_tokens=max_tokens)
    return complete


def _runner(note_id: str, user_id: str) -> tuple[Runner, list[str], object]:
    from prompts._skill_text import style_block
    from services.workspace import skill_run
    skill = skill_run.registry().get(SKILL)
    if skill is None:
        raise ValueError(f"No job named {SKILL!r}.")
    blocks, source_ids = skill_run._blocks_for(note_id)
    blocked = skill_run._runnable(skill, len(source_ids))
    if blocked:
        raise ValueError(f"{skill_run.job_title(SKILL)}: {blocked}.")
    body = f"{skill.body}{style_block(skill.name)}"
    return Runner(body, blocks, _model(user_id, skill.temperature)), source_ids, skill


def estimate_solve(runner: Runner, plan: dict, user_id: str) -> dict:
    """What Solve all would cost: one call per exercise plus the last one,
    each sending the skill and the sources. No model call."""
    from services.ai.pricing import estimate_usd, tokens_from_chars
    from services.ai.router import pick
    calls = len(children(plan["units"], "")) + 1
    input_tokens = tokens_from_chars(len(runner.prefix) * calls + 4000 * calls)
    output_tokens = tokens_from_chars(40_000)
    provider = pick("summarize_text", user_id)
    model = provider.model if provider else None
    return {"calls": calls, "input_tokens": input_tokens, "output_tokens": output_tokens,
            "usd": estimate_usd(model, input_tokens, output_tokens)}


def map_result(note_id: str, user_id: str, focus: str = "") -> dict:
    """The /solve-worksheet job: plan the page and return its skeleton.

    Called from skill_run.produce_skill_result, which runs it under the run
    log and the budget. The plan is stored at once, so Solve all and every
    Redo read the same plan."""
    from services.workspace import skill_html
    runner, source_ids, _ = _runner(note_id, user_id)
    if focus:
        runner.prefix += f"\n\nTHE STUDENT'S REQUEST, in their words: {focus}\n"
    plan = runner.plan()
    rows = save_plan(note_id, user_id, plan, source_ids)
    html = skill_html.inline_math(skeleton_html(plan))
    n_q = len(leaves(plan["units"]))
    n_ex = len(children(plan["units"], ""))
    return {"kind": "units", "html": html, "source_ids": source_ids,
            "units": public(rows), "found": {"exercises": n_ex, "questions": n_q},
            "solve": estimate_solve(runner, plan, user_id)}


def solve_sync(note_id: str, user_id: str,
               needs: dict[str, list[str]] | None = None) -> Iterator[dict]:
    """Solve all: every exercise not yet written, then the Overview and the
    revision sheet. Yields events for the stream."""
    from core.config import settings
    from services.ai import budget as budget_guard
    from services.ai import usage as usage_log
    from services.workspace import skill_html

    runner, source_ids, _ = _runner(note_id, user_id)
    rows = load_rows(note_id, user_id)
    plan = plan_from_rows(rows, source_ids)
    # The note's "Needs:" lines win: the student may have added a K-map or
    # removed a drawing before clicking Solve all.
    for u in plan["units"]:
        if needs and u["key"] in needs and needs[u["key"]] != u["needs"]:
            u["needs"] = needs[u["key"]]
            try:
                update_unit(note_id, user_id, u["key"], {"needs": u["needs"]})
            except Exception as e:                  # noqa: BLE001 (before migration 036)
                logger.warning(f"needs not stored: {e}")
    state = {r["key"]: r["state"] for r in rows}
    exercises = [u["key"] for u in children(plan["units"], "")]
    todo = [k for k in exercises if state.get(k, "planned") == "planned"]
    mark = len(usage_log.RECENT)
    with usage_log.annotate(surface="workspace", job="skill", skill=SKILL, trigger="user",
                            note_id=note_id, user_id=user_id), \
         budget_guard.limit(settings.max_usd_per_run or None):
        budget_guard.check(estimate_solve(runner, plan, user_id)["usd"], what="Solving the worksheet")
        yield {"type": "start", "keys": todo}
        raws: dict[str, str] = {}
        for res in solve_parallel(runner, plan, todo):
            if "error" in res:
                yield {"type": "unit_error", "key": res["key"], "content": res["error"]}
                continue
            raws[res["key"]] = res["raw"]
            _record_written(note_id, user_id, plan, res["key"], res["problems"])
            yield {"type": "unit", "key": res["key"], "html": finished(res["raw"]),
                   "problems": res["problems"]}
        if raws and len(raws) == len(todo) == len(exercises):
            yield {"type": "finishing"}
            try:
                ordered = [raws[k] for k in exercises]
                fin = runner.finish(plan, ordered)
                yield {"type": "finish", "overview": skill_html.inline_math(fin["overview"]),
                       "revision": skill_html.inline_math(fin["revision"])}
            except Exception as e:                  # noqa: BLE001
                logger.warning(f"note {note_id}: revision sheet failed: {e}")
                yield {"type": "unit_error", "key": "revision", "content": str(e)[:300]}
    spent = [r["estimated_usd"] for r in list(usage_log.RECENT)[mark:]
             if r.get("estimated_usd") is not None]
    yield {"type": "done", "usd": round(sum(spent), 4) if spent else None}


@privacy.reads_note
async def solve_events(note_id: str, user_id: str, needs: dict[str, list[str]] | None = None):
    """solve_sync, run in a thread, as an async stream. The thread gets this
    context (privacy gate, run log), so its calls are gated like any other."""
    import asyncio
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def produce() -> None:
        try:
            for ev in solve_sync(note_id, user_id, needs):
                loop.call_soon_threadsafe(queue.put_nowait, ev)
        except Exception as e:                      # noqa: BLE001
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "content": str(e)[:400]})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    ctx = contextvars.copy_context()
    task = loop.run_in_executor(None, ctx.run, produce)
    while (ev := await queue.get()) is not None:
        yield ev
    await task


@privacy.reads_note
def redo(note_id: str, user_id: str, key: str, current_html: str, note: str = "") -> dict:
    """Write one unit again; the version it replaces is kept for Back to old."""
    from datetime import datetime, timezone
    from core.config import settings
    from services.ai import budget as budget_guard
    from services.ai import usage as usage_log
    runner, source_ids, _ = _runner(note_id, user_id)
    rows = load_rows(note_id, user_id)
    plan = plan_from_rows(rows, source_ids)
    if not any(u["key"] == key for u in plan["units"]) or key == "":
        raise ValueError("That part is not in this note's plan.")
    mark = len(usage_log.RECENT)
    with usage_log.annotate(surface="workspace", job="skill", skill=SKILL, trigger="user",
                            note_id=note_id, user_id=user_id), \
         budget_guard.limit(settings.max_usd_per_run or None):
        res = runner.write(plan, key, current_html=current_html, note=note, redo=True)
    row = next(r for r in rows if r["key"] == key)
    versions = list(row.get("versions") or [])[-4:] + [
        {"html": current_html, "at": datetime.now(timezone.utc).isoformat(), "note": note}]
    update_unit(note_id, user_id, key, {"versions": versions})
    # Keep / Back to old only when there was an answer to go back to.
    _record_written(note_id, user_id, plan, key, res["problems"],
                    pending=row.get("state") != "planned")
    spent = [r["estimated_usd"] for r in list(usage_log.RECENT)[mark:]
             if r.get("estimated_usd") is not None]
    return {"key": key, "html": finished(res["raw"]), "problems": res["problems"],
            "usd": round(sum(spent), 4) if spent else None}
