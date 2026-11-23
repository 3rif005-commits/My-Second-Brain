"""The answer of a skill that writes the editor's HTML dialect → what the editor applies.

A Markdown skill goes through md_to_blocks.py, which escapes everything it does
not recognise. A skill with `format: html` (the worksheet solver) writes the
study guide's dialect directly, so it can use what Markdown cannot say here: a
green answer band (`<p data-background-color="green">`), highlighted headings,
toggles holding numbered steps with equations inside them, code blocks.

Two things are still easier for a model to write one way and for the editor to
read another, and this module bridges them:

- Mid-sentence maths. Models write `$v = d/t$` without being asked; the editor's
  inline formula is `<span data-inline-content-type="inlineMath" data-latex=…>`
  (customBlocks.tsx InlineMathSpec, parsed by BlockNote). The LaTeX is also left
  as the span's text, so the sandboxed preview card shows it rather than a gap.
- Diagrams. `<pre><code class="language-mermaid">` becomes a live diagram
  block (an `interactive` block holding the Mermaid source), carried in the
  `data-sb-blocks` envelope the editor already restores (lib/embeddedBlocks.ts).

The model never writes that envelope itself: any it wrote is removed first, so
text in a source cannot smuggle a ready-made block into the note.
"""
from __future__ import annotations

import html
import json
import re

from services.workspace.synthesis import _strip_fences

# The same delimiter rules as the editor's paste path (notionPaste.ts
# INLINE_MATH): no space just inside either `$`, no `$` or newline within, and
# a `\$` is a literal dollar sign, never an opener.
_INLINE_MATH = re.compile(r"(?<![$\\])\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\$)")
_DISPLAY_IN_TEXT = re.compile(r"(?<![$\\])\$\$(.+?)\$\$")
_LONE_DISPLAY = re.compile(r"<p>\s*\$\$([^<]+?)\$\$\s*</p>")
_NUMBER = re.compile(r"^-?\d+(?:[.,]\d+)*$")
_MATHY = re.compile(r"[A-Za-z\\^_{}=+\-*/()\[\]|<>]")

_TAG = re.compile(r"(<[^>]*>)")
_EMBED_ATTR = re.compile(r"""\sdata-sb-blocks\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE)
_MERMAID = re.compile(
    r"<pre[^>]*>\s*<code[^>]*class=\"[^\"]*language-mermaid[^\"]*\"[^>]*>(.*?)</code>\s*</pre>",
    re.DOTALL | re.IGNORECASE)
# lib/liveRuntime.ts MERMAID_START: what the interactive block will draw.
_MERMAID_START = re.compile(
    r"^(?:%%.*\n\s*)*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|"
    r"erDiagram|gantt|pie|mindmap|timeline|journey|quadrantChart|gitGraph|xychart-beta|"
    r"sankey-beta|block-beta)\b")
_DIAGRAM_TITLES = {
    "flowchart": "Flowchart", "graph": "Graph", "sequenceDiagram": "Sequence diagram",
    "classDiagram": "Class diagram", "stateDiagram": "State diagram",
    "stateDiagram-v2": "State diagram", "erDiagram": "ER diagram", "mindmap": "Mind map",
    "timeline": "Timeline", "gantt": "Gantt chart", "pie": "Pie chart",
}


def _looks_like_math(latex: str) -> bool:
    """Letters or operators make a formula. A bare number counts too ("roots
    are $2$ and $3$"): a price cannot be one, because the delimiter rules
    already refuse "$5 and $10" (a space before the closing $)."""
    return bool(_MATHY.search(latex)) or bool(_NUMBER.match(latex))


_WRAPPED = re.compile(r"^(?:\$\$([^$]*)\$\$|\$([^$]*)\$|\\\(([\s\S]*)\\\)|\\\[([\s\S]*)\\\])$")
_PAREN_MATH = re.compile(r"\\\((.+?)\\\)")
_BRACKET_MATH = re.compile(r"\\\[(.+?)\\\]")
_LONE_BRACKET = re.compile(r"<p>\s*\\\[(.+?)\\\]\s*</p>", re.DOTALL)
_MATH_DIV = re.compile(r'(<div data-type="math">)(.*?)(</div>)', re.DOTALL)


def _unwrap(latex: str) -> str:
    r"""LaTeX without delimiters around it. Nemotron wrote `\(\mathbf{E}\)`
    inside formulas: kept, it shows as a red KaTeX error."""
    t = latex.strip()
    while (m := _WRAPPED.match(t)):
        t = next(g for g in m.groups() if g is not None).strip()
    return t


def _math_span(latex: str) -> str:
    latex = _unwrap(html.unescape(latex))
    return (f'<span data-inline-content-type="inlineMath" '
            f'data-latex="{html.escape(latex, quote=True)}">'
            f"{html.escape(latex, quote=False)}</span>")


# Maths a model wrote outside dollar signs, in two shapes seen live on
# Nemotron: bare LaTeX ("density ⟨u⟩ = \\frac{1}{2} \\epsilon_0 E_0^2 and") and
# typed Unicode ("f ≈ 4.74 × 10¹⁴ Hz"). Both appear next to real formulas and
# make the eye jump between two fonts, so a run of math-like words around a
# \\command or a Unicode maths sign becomes a formula. Ordinary words (two or
# more letters, unless a unit with a power like m² or a function like cos)
# end the run.
_LATEX_CMD = re.compile(r"\\[A-Za-z]+")
_SUP = dict(zip("⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺", "0123456789-+"))
_SUB = dict(zip("₀₁₂₃₄₅₆₇₈₉", "0123456789"))
_SYMBOLS = {"×": r"\times ", "≈": r"\approx ", "−": "-", "π": r"\pi ", "ε": r"\varepsilon ",
            "μ": r"\mu ", "λ": r"\lambda ", "ω": r"\omega ", "θ": r"\theta ", "Δ": r"\Delta ",
            "√": r"\sqrt", "∞": r"\infty ", "≤": r"\le ", "≥": r"\ge ", "⟨": r"\langle ",
            "⟩": r"\rangle ", "·": r"\cdot ", "½": r"\tfrac12 ", "¼": r"\tfrac14 "}
_UNICODE_MATH = set(_SUP) | set(_SUB) | set(_SYMBOLS) - {"·"}
_FUNCTIONS = {"sin", "cos", "tan", "exp", "ln", "log"}
_TRAIL = ".,;:"


def _mathy(word: str) -> bool:
    w = word.rstrip(_TRAIL)
    if not w or any(c in w for c in ':"?!'):    # a path, a quote, a question: prose
        return False
    if _LATEX_CMD.search(w):
        return True                            # \sqrt{2gs}: letters inside a command are maths
    for m in re.finditer(r"(?<![\\A-Za-z])[A-Za-z]{2,}", w):
        after = w[m.end():m.end() + 1]
        if m.group(0) not in _FUNCTIONS and not (after and after in _SUP):
            return False                       # an ordinary word
    return bool(re.search(r"[\d=+\-*/^_{}()<>|\[\]]|\\[A-Za-z]|^[A-Za-z]", w)
                or any(c in _UNICODE_MATH for c in w))


def _to_latex(chunk: str) -> str:
    chunk = re.sub(r"[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+", lambda m: "^{" + "".join(_SUP[c] for c in m.group(0)) + "}", chunk)
    chunk = re.sub(r"[₀₁₂₃₄₅₆₇₈₉]+", lambda m: "_{" + "".join(_SUB[c] for c in m.group(0)) + "}", chunk)
    chunk = re.sub(r"(?<!\\)\b([A-Za-z]{2,})(?=\^)", lambda m: m.group(1) if m.group(1) in _FUNCTIONS
                   else r"\text{" + m.group(1) + "}", chunk)
    chunk = re.sub(r"\b(" + "|".join(_FUNCTIONS) + r")\b", r"\\\1", chunk)
    for k, v in _SYMBOLS.items():
        chunk = chunk.replace(k, v)
    return re.sub(r"\s+", " ", chunk).strip()


def _bare_latex(text: str) -> str:
    """Wrap runs of bare LaTeX or typed Unicode maths in `text` as formulas."""
    if not (_LATEX_CMD.search(text) or any(c in _UNICODE_MATH for c in text)):
        return text
    words = re.split(r"(\s+)", text)
    out, run = [], []

    def flush() -> None:
        if not run:
            return
        whole = "".join(run)
        chunk = whole.rstrip()
        tail_ws = whole[len(chunk):]
        trail = ""
        while chunk and chunk[-1] in _TRAIL:
            trail, chunk = chunk[-1] + trail, chunk[:-1]
        # "U = ⟨u⟩ × volume": the × belongs to the word after it, which is prose
        dangling = re.search(r"\s*[=+\-−×·≈*/]+$", chunk)
        if dangling:
            trail, chunk = chunk[dangling.start():] + trail, chunk[:dangling.start()]
        if _LATEX_CMD.search(chunk) or any(c in _UNICODE_MATH for c in chunk):
            latex = chunk if _LATEX_CMD.search(chunk) and not any(c in _UNICODE_MATH - set("⟨⟩") for c in chunk) \
                else _to_latex(chunk)
            out.append(_math_span(latex) + trail + tail_ws)
        else:
            out.append(whole)
        run.clear()

    for w in words:
        if not w:
            continue
        if w.isspace():
            (run if run else out).append(w)
        elif _mathy(w):
            run.append(w)
            if w[-1] in ",;":                 # a clause ends here; so does the formula
                flush()
        else:
            flush()
            out.append(w)
    flush()
    return "".join(out)


def _inline_math_in_text(text: str) -> str:
    """One text node: every formula becomes a span, and what is left between
    them is prose, where a `\\$` is the writer's literal dollar sign."""
    # \( … \) and \[ … \] are the other LaTeX delimiters (Nemotron uses them).
    text = _PAREN_MATH.sub(lambda m: f"${m.group(1).strip()}$", text)
    text = _BRACKET_MATH.sub(lambda m: f"$${m.group(1).strip()}$$", text)
    found: list[tuple[int, int, str]] = [
        (m.start(), m.end(), m.group(1)) for m in _DISPLAY_IN_TEXT.finditer(text)]
    for m in _INLINE_MATH.finditer(text):
        if any(a <= m.start() < b for a, b, _ in found):
            continue
        # "$5-$10": a digit right after the closing `$` means it opened the next amount.
        if not _looks_like_math(m.group(1)) or text[m.end():m.end() + 1].isdigit():
            continue
        found.append((m.start(), m.end(), m.group(1)))
    out, cursor = [], 0
    for start, end, latex in sorted(found):
        out.append(_bare_latex(text[cursor:start]).replace("\\$", "$"))
        out.append(_math_span(latex))
        cursor = end
    out.append(_bare_latex(text[cursor:]).replace("\\$", "$"))
    return "".join(out)


def inline_math(doc: str) -> str:
    """`$…$` in the text of `doc` → inline formula spans.

    Text inside code, a display-maths block or an existing formula span is left
    alone: there a dollar sign is a shell prompt, a variable, or already maths.
    """
    doc = _MATH_DIV.sub(lambda m: m.group(1) + _unwrap(m.group(2)) + m.group(3), doc)
    doc = _LONE_BRACKET.sub(
        lambda m: f'<div data-type="math">{html.escape(html.unescape(m.group(1)).strip(), quote=False)}</div>',
        doc)
    doc = _LONE_DISPLAY.sub(
        lambda m: f'<div data-type="math">{html.escape(html.unescape(m.group(1)).strip(), quote=False)}</div>',
        doc)
    out: list[str] = []
    code_depth = 0
    skip_until: str | None = None      # the closing tag of a math div / formula span
    for part in _TAG.split(doc):
        if not part:
            continue
        if part.startswith("<"):
            low = part.lower()
            if re.match(r"<(pre|code)\b", low):
                code_depth += 1
            elif re.match(r"</(pre|code)\s*>", low):
                code_depth = max(0, code_depth - 1)
            elif skip_until is None and re.match(r"<div\b", low) and 'data-type="math"' in low:
                skip_until = "</div"
            elif skip_until is None and re.match(r"<span\b", low) and "data-inline-content-type" in low:
                skip_until = "</span"
            elif skip_until and low.startswith(skip_until):
                skip_until = None
            out.append(part)
        elif code_depth or skip_until or ("$" not in part and "\\" not in part
                                          and not any(c in _UNICODE_MATH for c in part)):
            out.append(part)
        else:
            out.append(_inline_math_in_text(part))
    return "".join(out)


_QUESTION = re.compile(r"(?=<h[34][\s>])", re.IGNORECASE)
_MERMAID_COMMENT = re.compile(r"^\s*%%.*$\n?", re.MULTILINE)


def _diagram_block(m: re.Match) -> str:
    source = _MERMAID_COMMENT.sub("", html.unescape(m.group(1))).strip()
    kind = _MERMAID_START.match(source)
    if not kind:
        return m.group(0)          # not something the block can draw: stays a code block
    block = {"type": "interactive",
             "props": {"title": _DIAGRAM_TITLES.get(kind.group(1), "Diagram"),
                       "html": source}}
    return f'<div data-sb-blocks="{html.escape(json.dumps([block]), quote=True)}"></div>'


def _last_diagram_only(part: str) -> str:
    """Some models (Nemotron, seen twice) draft a diagram, then write
    "%% Let me rebuild correctly" and draw it again, two or three times under
    one question. The last one is their corrected answer; the earlier drafts
    were wrong both times, and a wrong automaton in revision notes is worse
    than none."""
    found = list(_MERMAID.finditer(part))
    for m in reversed(found[:-1]):
        part = part[:m.start()] + part[m.end():]
    return part


def diagrams(doc: str) -> str:
    """Mermaid code blocks → live diagram blocks: one per question or part,
    without the model's %% notes."""
    doc = "".join(_last_diagram_only(p) for p in _QUESTION.split(doc))
    return _MERMAID.sub(_diagram_block, doc)


# The worksheet's rule boxes: the callout type is only a colour there, ranked
# by importance, and each level has a cap (SKILL.md, RULES & FORMULAS).
_RULE_BOX = re.compile(r'(<div data-type="callout" data-callout-type=")([A-Z]+)("\s+data-callout-icon="📐")')
_RULE_LEVELS = ["CAUTION", "WARNING", "IMPORTANT", "OVERVIEW", "NOTE"]
_RULE_CAPS = {"CAUTION": 2, "WARNING": 3}


def rule_caps(doc: str) -> str:
    """At most 2 red and 3 orange rule boxes. A box over its level's cap moves
    down one level (and on, if that one is full too). Models read the caps
    and still exceed them: Nemotron wrote 4 orange in one run."""
    used: dict[str, int] = {}

    def demote(m: re.Match) -> str:
        level = m.group(2)
        if level in _RULE_LEVELS:
            i = _RULE_LEVELS.index(level)
            while _RULE_LEVELS[i] in _RULE_CAPS and used.get(_RULE_LEVELS[i], 0) >= _RULE_CAPS[_RULE_LEVELS[i]]:
                i += 1
            level = _RULE_LEVELS[i]
        used[level] = used.get(level, 0) + 1
        return m.group(1) + level + m.group(3)

    return _RULE_BOX.sub(demote, doc)


# ---- the revision sheet's rules, from the solutions ---------------------------
#
# The model wrote the box list from memory, so the same worksheet gave a
# different set each run: a law used in three questions could be missing, and
# a box could hold one exercise's result instead of the law. The boxes are now
# checked against the Rule lines of the solutions: every rule used has a box,
# a rule used often is never ranked low, and the boxes go most important first.

_RULE_LINE = re.compile(
    r'<p><strong>Rules?:</strong>\s*(.*?)</p>\s*(?:<div data-type="math">(.*?)</div>)?',
    re.IGNORECASE | re.DOTALL)
_HEADING = re.compile(r"<h([2-4])[^>]*>(.*?)</h\1>", re.IGNORECASE | re.DOTALL)
_SHEET = re.compile(r"<h2[^>]*>\s*Revision sheet\s*</h2>", re.IGNORECASE)
_RULES_H3 = re.compile(r"<h3[^>]*>\s*Rules\s*(?:&amp;|&|and)\s*formulas\s*</h3>", re.IGNORECASE)
_BOX_OPEN = re.compile(r'<div data-type="callout" data-callout-type="([A-Z]+)"\s+data-callout-icon="📐">')
_BOX_NAME = re.compile(r"<p><strong>(.*?)</strong>")
_EMPTY_CASES = re.compile(
    r"<p><em>In this worksheet:</em>(?:(?!</p>)[^$\\=])*</p>", re.IGNORECASE)
_STOP = {"of", "the", "a", "an", "in", "for", "and", "to", "on", "law", "rule", "formula", "s",
         "vacuum", "general", "form", "definition", "condition"}


def _plain(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html)).strip()


_NAMED = re.compile(r"([A-Za-zÀ-ÿ]+)['’]s\b")


class _Name(frozenset):
    """A rule name's word stems, and the person it is named after if any."""
    named: str | None = None


def _tokens(name: str) -> _Name:
    text = _plain(name).replace("’", "'")
    words = re.findall(r"[a-z0-9]+", text.lower().replace("'s", ""))
    out = _Name(w[:6] for w in words if w not in _STOP)
    person = _NAMED.search(text)
    out.named = person.group(1).lower()[:6] if person else None
    return out


def _same_rule(a: frozenset[str], b: frozenset[str]) -> bool:
    """Two names of one law. The same law named after someone ("Faraday's law",
    "Faraday's law for plane waves"); otherwise at least two shared stems
    covering two thirds of the shorter name ("Energy density in EM fields" =
    "Electromagnetic energy density"), so "intensity of a beam" ≠ "intensity
    of a plane wave" and "wave relation" ≠ "wave equation"."""
    if not (a and b):
        return False
    if a == b:
        return True
    na, nb = getattr(a, "named", None), getattr(b, "named", None)
    if na and na == nb:
        return True
    shared = len(a & b)
    return shared >= 2 and shared >= 2 * min(len(a), len(b)) / 3


def _ref(headings: list[tuple[int, str]]) -> str:
    """'Ex. 01a' from the exercise heading and the part's letter."""
    ex = next((t for lvl, t in headings if lvl == 2), "")
    num = re.search(r"\d+", ex)
    part = next((re.match(r"\(?([a-z])\)", t.strip()) for lvl, t in headings if lvl == 4), None)
    if not num:
        return ""
    return f"Ex. {num.group(0)}{part.group(1) if part else ''}"


def _rule_uses(body: str) -> list[dict]:
    """Every rule named in the solutions: name, formula, where it is used."""
    uses: list[dict] = []
    path: list[tuple[int, str]] = []
    events = sorted([(m.start(), "h", m) for m in _HEADING.finditer(body)]
                    + [(m.start(), "r", m) for m in _RULE_LINE.finditer(body)], key=lambda e: e[0])
    for _, kind, m in events:
        if kind == "h":
            lvl = int(m.group(1))
            path = [(l, t) for l, t in path if l < lvl] + [(lvl, _plain(m.group(2)))]
            continue
        names = [n.strip() for n in re.split(r"\s+·\s+|\s*;\s*", _plain(m.group(1))) if n.strip()]
        formula = (m.group(2) or "").strip()
        parts = [f.strip() for f in re.split(r"\\qquad", formula)] if formula else []
        for i, name in enumerate(names):
            f = parts[i] if len(parts) == len(names) else (formula if i == 0 else "")
            uses.append({"name": name, "tokens": _tokens(name), "formula": f, "ref": _ref(path),
                         "question": " / ".join(t for _, t in path)})
    return uses


def _split_boxes(section: str) -> tuple[str, list[tuple[str, str]], str]:
    """The rules section → (text before the boxes, [(level, box html)], after)."""
    boxes: list[tuple[str, str]] = []
    first = last = None
    pos = 0
    while (m := _BOX_OPEN.search(section, pos)):
        depth, i = 0, m.start()
        for t in re.finditer(r"<div\b|</div>", section[m.start():]):
            depth += 1 if t.group(0) != "</div>" else -1
            if depth == 0:
                i = m.start() + t.end()
                break
        else:
            break
        if first is None:
            first = m.start()
        boxes.append((m.group(1), section[m.start():i]))
        last = pos = i
    if first is None:
        return section, [], ""
    return section[:first], boxes, section[last:]


def _box(level: str, name: str, refs: list[str], formula: str) -> str:
    where = f" ({', '.join(refs)})" if refs else ""
    title = name[:1].upper() + name[1:]
    math = f'<div data-type="math">{formula}</div>' if formula else ""
    return (f'<div data-type="callout" data-callout-type="{level}" data-callout-icon="📐">'
            f"<p><strong>{title}</strong>{where}</p>{math}</div>")


def _pair_loose_names(named: list, rules: list[dict]) -> list:
    """A box and a rule that match nothing else but share a word stem are one
    law named twice ("Transversality condition" / "Transverse wave
    condition"): the box takes the rule's name, so its content is kept."""
    free_rules = [r for r in rules if not any(_same_rule(r["tokens"], b[2]) for b in named)]
    out = []
    for lvl, html, toks in named:
        if not any(_same_rule(r["tokens"], toks) for r in rules) and free_rules:
            best = max(free_rules, key=lambda r: len(r["tokens"] & toks))
            if best["tokens"] & toks:
                free_rules.remove(best)
                toks = best["tokens"]
        out.append((lvl, html, toks))
    return out


def rule_sheet(doc: str) -> str:
    """Checks the revision sheet's rule boxes against the solutions' Rule lines."""
    sheet = _SHEET.search(doc)
    if not sheet:
        return doc
    rules_h3 = _RULES_H3.search(doc, sheet.end())
    if not rules_h3:
        return doc
    end = re.compile(r"<h[23][\s>]", re.IGNORECASE).search(doc, rules_h3.end())
    stop = end.start() if end else len(doc)
    # "In this worksheet: used to find E from B" says nothing to memorise; the
    # line is for the special formulas. Nemotron wrote the empty kind in most
    # runs despite the instruction, so a line with no formula goes.
    section = _EMPTY_CASES.sub("", doc[rules_h3.end():stop])
    head, boxes, tail = _split_boxes(section)

    # one entry per distinct rule, in order of first use
    rules: list[dict] = []
    for u in _rule_uses(doc[:sheet.start()]):
        hit = next((r for r in rules if _same_rule(r["tokens"], u["tokens"])), None)
        if hit:
            hit["refs"] += [u["ref"]] if u["ref"] and u["ref"] not in hit["refs"] else []
            hit["questions"] |= {u["question"]}
            hit["formula"] = hit["formula"] or u["formula"]
        else:
            rules.append({**u, "refs": [u["ref"]] if u["ref"] else [], "questions": {u["question"]}})

    levels = _RULE_LEVELS
    named = [(lvl, html, _tokens(m.group(1)) if (m := _BOX_NAME.search(html)) else frozenset())
             for lvl, html in boxes]
    # A box no solution uses is a rule the model remembered, not one this
    # worksheet needs (live: the example's "Definition of momentum").
    if rules:
        named = _pair_loose_names(named, rules)
        named = [b for b in named if any(_same_rule(r["tokens"], b[2]) for r in rules)]
    out: list[tuple[str, str]] = []
    for lvl, html, toks in named:
        uses = sum(len(r["questions"]) for r in rules if _same_rule(r["tokens"], toks))
        floor = "WARNING" if uses >= 3 else "IMPORTANT" if uses == 2 else None
        if lvl in levels and floor and levels.index(lvl) > levels.index(floor):
            html = html.replace(f'data-callout-type="{lvl}"', f'data-callout-type="{floor}"', 1)
            lvl = floor
        out.append((lvl, html))
    for r in rules:
        if any(_same_rule(r["tokens"], toks) for _, _, toks in named):
            continue
        n = len(r["questions"])
        lvl = "WARNING" if n >= 3 else "IMPORTANT" if n == 2 else "OVERVIEW"
        out.append((lvl, _box(lvl, r["name"], r["refs"], r["formula"])))

    out.sort(key=lambda b: levels.index(b[0]) if b[0] in levels else len(levels))
    joined = "\n".join(html for _, html in out)
    if not named:
        head = head.rstrip() + ("\n" if joined else "")
    return doc[:rules_h3.end()] + head + joined + tail + doc[stop:]


_STRAY_DIVIDER = re.compile(r"(<h[12][^>]*>.*?</h[12]>\s*)<hr\s*/?>", re.IGNORECASE | re.DOTALL)


def finish(answer: str) -> str:
    """The model's answer → the HTML the editor applies."""
    doc = _EMBED_ATTR.sub("", _strip_fences(answer))
    # A divider separates two questions; right under a title it separates nothing.
    doc = _STRAY_DIVIDER.sub(r"\1", doc)
    return inline_math(diagrams(rule_caps(rule_sheet(doc))))
