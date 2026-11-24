"""Is a Boolean answer the function the question asked for? No model, exact.

Live finding (2026-11-24, ESD tutorial 3): a worksheet of PLA/PAL design was
"solved" with nothing able to say whether a simplified function was right.
Logic is the one subject where that can be checked for free: take the
function from the question — a minterm list `F(ABC) = Σ(0,1,2,4)` or an
expression `F_1 = x_1x_2 + x_1\\bar{x}_3` — and the answer's `F_1 = …` from the
green band, and compare them on every input.

Only what parses is checked. Anything it cannot read is skipped, never
flagged: a false alarm would teach the student to ignore the mark.
"""
from __future__ import annotations

import itertools
import re
import unicodedata

MAX_VARS = 6

# ── turning LaTeX-ish text into tokens ──────────────────────────────────────

_COMBINING_BAR = {"\u0304", "\u0305"}            # x̄ written with a combining mark


def _plain(text: str) -> str:
    """LaTeX and Unicode spellings → one form: A' for NOT A, + for OR, juxtaposition for AND."""
    t = text or ""
    t = re.sub(r"<[^>]+>", " ", t)
    t = t.replace("$", " ").replace("\\,", " ").replace("\\;", " ").replace("\\ ", " ")
    t = re.sub(r"\\(?:mathrm|text|mathit)\{([^}]*)\}", r"\1", t)
    # \bar{x}_1, \overline{x_1}, \bar x_1, \overline{AB} (whole group)
    t = re.sub(r"\\(?:bar|overline)\s*\{([^{}]*)\}(_\{?\d+\}?)?", lambda m: f"({m.group(1)}{m.group(2) or ''})'", t)
    t = re.sub(r"\\(?:bar|overline)\s*([A-Za-z])(_\{?\d+\}?)?", lambda m: f"{m.group(1)}{m.group(2) or ''}'", t)
    t = re.sub(r"\\(?:neg|lnot)\s*", "~", t)
    t = re.sub(r"\\(?:cdot|land|wedge)", " ", t).replace("·", " ").replace("*", " ")
    t = re.sub(r"\\(?:lor|vee)", "+", t).replace("∨", "+")
    t = t.replace("¬", "~").replace("!", "~").replace("’", "'").replace("′", "'")
    # x̄1 / x1̄ with a combining overline: move the mark after the variable
    out, i = [], 0
    while i < len(t):
        ch = t[i]
        if ch in _COMBINING_BAR:
            # the mark belongs to the variable just written (letter + digits)
            j = len(out)
            while j > 0 and out[j - 1].isdigit():
                j -= 1
            if j > 0 and out[j - 1].isalpha():
                # x̄1 → x1' : keep digits that FOLLOW the mark too
                k = i + 1
                while k < len(t) and t[k].isdigit():
                    out.append(t[k])
                    k += 1
                out.append("'")
                i = k
                continue
        out.append(ch)
        i += 1
    t = "".join(out)
    t = unicodedata.normalize("NFKC", t)
    return re.sub(r"_\{?(\d+)\}?", r"\1", t)


def _tokens(expr: str, names: list[str]) -> list[str] | None:
    """Variables (longest name first), ', ~, +, (, ). None if anything else is left."""
    s = _plain(expr).replace(" ", "")
    order = sorted(names, key=len, reverse=True)
    toks, i = [], 0
    while i < len(s):
        if s[i] in "'~+()":
            toks.append(s[i])
            i += 1
            continue
        if s[i] in "01" and (i + 1 == len(s) or not s[i + 1].isdigit()):
            toks.append(s[i])
            i += 1
            continue
        hit = next((n for n in order if s.startswith(n, i)), None)
        if hit is None:
            return None
        toks.append(hit)
        i += len(hit)
    return toks


class _Parser:
    def __init__(self, toks: list[str], names: list[str]):
        self.t, self.i, self.names = toks, 0, names

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def take(self):
        tok = self.t[self.i]
        self.i += 1
        return tok

    def expr(self):
        terms = [self.term()]
        while self.peek() == "+":
            self.take()
            terms.append(self.term())
        return lambda env: any(f(env) for f in terms)

    def term(self):
        factors = []
        while self.peek() is not None and self.peek() not in "+)":
            factors.append(self.factor())
        if not factors:
            raise ValueError("empty term")
        return lambda env: all(f(env) for f in factors)

    def factor(self):
        neg = False
        while self.peek() == "~":
            self.take()
            neg = not neg
        tok = self.take()
        if tok == "(":
            inner = self.expr()
            if self.take() != ")":
                raise ValueError("unbalanced")
            f = inner
        elif tok in ("0", "1"):
            f = (lambda v: (lambda env: v))(tok == "1")
        elif tok in self.names:
            f = (lambda n: (lambda env: env[n]))(tok)
        else:
            raise ValueError(f"unexpected {tok}")
        while self.peek() == "'":
            self.take()
            neg = not neg
        return (lambda g: (lambda env: not g(env)))(f) if neg else f


def evaluate(expr: str, names: list[str]):
    """expr → a function of {name: bool}, or None when it does not parse."""
    toks = _tokens(expr, names)
    if not toks:
        return None
    p = _Parser(toks, names)
    try:
        f = p.expr()
    except (ValueError, IndexError):
        return None
    return f if p.i == len(toks) else None


# ── reading the question and the answer ─────────────────────────────────────

_FN = r"([A-Z](?:_?\{?\d+\}?)?)"                    # F, F1, F_1, F_{1}
_SIGMA = re.compile(_FN + r"\s*\(([^()=]{1,40})\)\s*=\s*(?:\\sum|Σ|∑|\\Sigma)\s*(?:_?m)?\s*\(([\d,\s]+)\)"
                    r"(?:\s*\+\s*(?:d|\\sum\s*_?d|Σ\s*d)\s*\(([\d,\s]+)\))?")
_EXPR = re.compile(_FN + r"(?:\s*\([^()=]{1,40}\))?\s*=\s*([^=,;]+?)(?=,|;|$|\s+and\s|\s+[A-Z](?:_?\{?\d+\}?)?\s*(?:\([^()]*\))?\s*=)")
_VAR = re.compile(r"[A-Za-z]\d*")


def _fname(raw: str) -> str:
    return re.sub(r"[_{}]", "", raw)


def _names_of(var_list: str) -> list[str]:
    """"ABCD", "A,B,C" or "x_1 x_2 x_3" → the variable names, MSB first."""
    return _VAR.findall(_plain(var_list).replace(",", "").replace(" ", ""))


def reference_functions(question: str) -> dict[str, dict]:
    """{name: {"names": [...], "ones": set, "dc": set} | {"expr": str}} from the question."""
    q = _plain(question)
    found: dict[str, dict] = {}
    for m in _SIGMA.finditer(_plain_keep_sigma(question)):
        names = _names_of(m.group(2))
        if not names or len(names) > MAX_VARS:
            continue
        ones = {int(x) for x in re.findall(r"\d+", m.group(3))}
        dc = {int(x) for x in re.findall(r"\d+", m.group(4) or "")}
        found[_fname(m.group(1))] = {"names": names, "ones": ones, "dc": dc}
    for m in _EXPR.finditer(q):
        name = _fname(m.group(1))
        if name not in found and not re.search(r"Σ|∑|sum", m.group(2)):
            found[name] = {"expr": m.group(2).strip()}
    return found


def _plain_keep_sigma(text: str) -> str:
    t = re.sub(r"<[^>]+>", " ", text or "").replace("$", " ").replace("\\,", " ")
    t = re.sub(r"\\(?:mathrm|text)\{([^}]*)\}", r"\1", t)
    return re.sub(r"_\{?(\d+)\}?", r"\1", t)


def answer_functions(band: str) -> dict[str, str]:
    """{name: expression} from an answer band: "F1 = x_1, F2 = x_1x_2 + x_3"."""
    t = _plain(band)
    t = re.sub(r"^\s*Answer:\s*", "", t)
    return {_fname(m.group(1)): m.group(2).strip() for m in _EXPR.finditer(t)}


# ── comparing ───────────────────────────────────────────────────────────────

def _variables(*exprs: str) -> list[str]:
    seen: list[str] = []
    for e in exprs:
        for v in _VAR.findall(_plain(e).replace(" ", "")):
            if v not in seen:
                seen.append(v)
    return sorted(seen)


def wrong_inputs(ref: dict, answer: str) -> list[int] | None:
    """Minterm numbers where the answer differs from the reference; [] when
    they agree; None when either side cannot be read."""
    if "ones" in ref:
        names = ref["names"]
        ans = evaluate(answer, names)
        if ans is None:
            return None
        ones, dc = ref["ones"], ref["dc"]
        ref_f = None
    else:
        names = _variables(ref["expr"], answer)
        if not names or len(names) > MAX_VARS:
            return None
        ref_f, ans = evaluate(ref["expr"], names), evaluate(answer, names)
        if ref_f is None or ans is None:
            return None
        ones, dc = None, set()
    bad = []
    for i, bits in enumerate(itertools.product([False, True], repeat=len(names))):
        if i in dc:
            continue
        env = dict(zip(names, bits))
        want = (i in ones) if ones is not None else ref_f(env)
        if bool(ans(env)) != want:
            bad.append(i)
    return bad


def check(question: str, band_text: str) -> list[str]:
    """Problems for a part: each answered function that is not the asked one."""
    refs = reference_functions(question)
    if not refs:
        return []
    out = []
    for name, expr in answer_functions(band_text).items():
        ref = refs.get(name) or (next(iter(refs.values())) if len(refs) == 1 and name in ("F", "Y") else None)
        if ref is None:
            continue
        bad = wrong_inputs(ref, expr)
        if bad:
            shown = ", ".join(str(b) for b in bad[:4]) + ("…" if len(bad) > 4 else "")
            out.append(f"{name} as answered is not the asked function: it differs on "
                       f"input{'s' if len(bad) > 1 else ''} {shown} (minterm numbers)")
    return out
