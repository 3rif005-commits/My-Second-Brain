"""Source tools: the AI can put into the note what the source viewer's buttons can.

Design: docs/AI_SOURCE_TOOLS_PLAN.md. The viewer inserts quotes with a page
pill, tables, formulas, PDF figures, video frames, clips and audio. These tools
mirror those buttons for the workspace AI panel.

Two rules shape everything here:

- **Tokens, not URLs.** An insert tool never hands the model a link to copy:
  models damage 300-character signed URLs. It returns a short token such as
  `[[src:7f3a1c]]`; the model puts the token in its reply, and the record
  behind it travels to the client as a `source_insert` event. The panel's
  Insert turns the token into the real block (frontend/lib/sourceInserts.ts).
  The open note is still never written by a tool.
- **Text first.** The model reads tables as markdown, formulas as LaTeX,
  figures as a short description and video frames as the transcript around
  them. Pixels go to a vision model only through `look_at`, and the
  description it writes is saved, so each figure is looked at once.

Every tool reads only sources of the notes this turn may send (`SourceTurn`
is built from the notes that passed the privacy gate).
"""
from __future__ import annotations

import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from services.database import get_supabase

#: A capture sits inside a note for good; a short-lived link broke pictures the
#: next day (ledger B2). Same lifetime as the viewer's captures.
LONG_LIVED = 10 * 365 * 24 * 3600
#: Clips and audio the AI may cut in one go. yt-dlp + ffmpeg on Render's free
#: plan can take minutes; a long clip also lands in the note as a large file.
MAX_CLIP_SECONDS = 120
#: Captures (frame, clip, audio, or a look at a moment) per turn.
MAX_CAPTURES_PER_TURN = 1
#: Elements find_elements returns at once.
MAX_ELEMENTS = 40

_VIDEO_KINDS = {"video", "youtube"}
_SHOWN_TYPES = ("heading", "image", "table", "formula")

DESCRIBE_PROMPT = (
    "This image is a figure from a study source (a lecture slide, paper or "
    "book). Describe it in 1-3 plain sentences: what it shows, and every label, "
    "axis, value or piece of text in it that matters. No preamble, no markdown."
)


class SourceToolError(Exception):
    """User-facing: told to the model, which tells the user."""


@dataclass
class SourceTurn:
    """What one chat turn may reach: the notes whose sources are in scope."""
    note_ids: list[str]
    user_id: str
    captures: int = 0
    _sources: list[dict] | None = field(default=None, repr=False)

    def sources(self) -> list[dict]:
        if self._sources is None:
            if not self.note_ids:
                self._sources = []
            else:
                self._sources = (get_supabase().table("note_resources").select("*")
                                 .in_("note_id", self.note_ids).eq("user_id", self.user_id)
                                 .order("order_index").execute().data or [])
        return self._sources

    def source(self, ref: Any) -> dict:
        """A source by its id, or by the id's first characters (the excerpts
        show `src=` and eight characters, to keep the prompt short)."""
        ref = str(ref or "").strip().lower()
        if not ref:
            raise SourceToolError("source_id is required — take it from src= in the "
                                  "excerpts or from workspace.list_sources.")
        rows = self.sources()
        exact = [r for r in rows if str(r["id"]).lower() == ref]
        if exact:
            return exact[0]
        hits = [r for r in rows if len(ref) >= 6 and str(r["id"]).lower().startswith(ref)]
        if len(hits) == 1:
            return hits[0]
        if not hits:
            raise SourceToolError(f"No source {ref} on this note. Call workspace.list_sources "
                                  "for the ids.")
        raise SourceToolError(f"{ref} matches several sources; send the full id.")

    def element(self, element_id: Any) -> tuple[dict, dict]:
        """An element and its source — only if the source is in scope."""
        eid = str(element_id or "").strip()
        if not eid:
            raise SourceToolError("element_id is required — take it from workspace.find_elements.")
        rows = (get_supabase().table("resource_elements").select("*")
                .eq("id", eid).eq("user_id", self.user_id).limit(1).execute().data or [])
        by_id = {str(r["id"]): r for r in self.sources()}
        if not rows or str(rows[0]["resource_id"]) not in by_id:
            raise SourceToolError(f"No element {eid} in this note's sources. Call "
                                  "workspace.find_elements for the ids.")
        return rows[0], by_id[str(rows[0]["resource_id"])]


# ── helpers ──────────────────────────────────────────────────────────────────

def new_token() -> str:
    return f"[[src:{secrets.token_hex(3)}]]"


def parse_time(value: Any) -> float:
    """Seconds from 754, 754.5, "12:34" or "1:02:03"."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        t = float(value)
    else:
        s = str(value or "").strip()
        if not s:
            raise SourceToolError("a time is required (seconds, or mm:ss).")
        try:
            parts = [float(p) for p in s.split(":")]
        except ValueError:
            raise SourceToolError(f"'{s}' is not a time; use seconds or mm:ss.")
        if len(parts) > 3:
            raise SourceToolError(f"'{s}' is not a time; use seconds or mm:ss.")
        t = 0.0
        for p in parts:
            t = t * 60 + p
    if t < 0:
        raise SourceToolError("a time cannot be negative.")
    return t


def fmt_time(t: float) -> str:
    s = int(t)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def _norm(text: str) -> str:
    """Letters and digits only, lower case — a quote survives a model's
    changes to dashes, quotes and line breaks, never to its words."""
    return " ".join(re.findall(r"[0-9a-z]+", (text or "").lower()))


def _owner_note(source: dict) -> str:
    return str(source.get("note_id") or "")


def _counts(source_ids: list[str], user_id: str) -> dict[str, dict[str, int]]:
    if not source_ids:
        return {}
    rows = (get_supabase().table("resource_elements").select("resource_id,element_type")
            .in_("resource_id", source_ids).eq("user_id", user_id)
            .in_("element_type", ["image", "table", "formula"]).limit(10000)
            .execute().data or [])
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        per = out.setdefault(str(r["resource_id"]), {})
        per[r["element_type"]] = per.get(r["element_type"], 0) + 1
    return out


def _save(element_id: str, fields: dict) -> None:
    """Best effort: before migration 034 the columns do not exist, and the
    tool still answers — it just makes the text again next time."""
    try:
        get_supabase().table("resource_elements").update(fields).eq("id", element_id).execute()
    except Exception:                                   # noqa: BLE001
        pass


def _chunks(source_id: str, user_id: str) -> list[dict]:
    return (get_supabase().table("resource_chunks")
            .select("chunk_text,anchor_type,anchor_start,anchor_end,chunk_index")
            .eq("resource_id", source_id).eq("user_id", user_id)
            .order("chunk_index").limit(3000).execute().data or [])


def _transcript_near(source_id: str, user_id: str, t: float, span: float = 20.0) -> str:
    near = [c for c in _chunks(source_id, user_id)
            if c.get("anchor_type") == "time"
            and float(c.get("anchor_start") or 0) <= t + span
            and float(c.get("anchor_end") or c.get("anchor_start") or 0) >= t - span]
    return " ".join((c.get("chunk_text") or "").strip() for c in near)[:1200]


def _vision(user_id: str, note_id: str, image: bytes, prompt: str, mime: str = "image/png") -> str:
    """One vision call, under the note's own privacy level: a provider that may
    not see the note never gets its pictures."""
    from services import privacy
    from services.ai.router import candidates, complete_with_fallback
    with privacy.handling([note_id], user_id):
        if not candidates("vision", user_id):
            raise SourceToolError(
                "No vision-capable AI provider may look at this note's pictures "
                "(none is set up, or the note's privacy level rules them out). "
                "Work from the text you have.")
        try:
            out = complete_with_fallback("vision", user_id, [{
                "role": "user",
                "content": [{"type": "text", "text": prompt},
                            {"type": "image", "data": image, "mime": mime}],
            }], max_tokens=400)
        except RuntimeError as e:
            raise SourceToolError(f"The vision call failed: {e}")
    return " ".join((out or "").split())


def _insert(record: dict, summary: str, **extra) -> dict:
    """What an insert tool returns: the model sees token + summary + how to
    use it; `insert` is popped by the engine and sent to the client."""
    token = new_token()
    return {
        "token": token,
        "summary": summary,
        "use": (f"Put {token} on its own line in your reply where this belongs. "
                "Insert turns it into the real block. Never write a URL for it."),
        **extra,
        "insert": {"token": token, **record},
    }


def _source_ref(source: dict) -> dict:
    return {"source_id": str(source["id"]), "note_id": _owner_note(source),
            "title": source.get("title") or "Source"}


# ── tools ────────────────────────────────────────────────────────────────────

def roster(turn: SourceTurn) -> str:
    """One line per source for the prompt: `Sources: Talk (youtube, src=bbbbbbbb); …`."""
    try:
        rows = turn.sources()
    except Exception:                                   # noqa: BLE001 — the prompt goes without
        return ""
    if not rows:
        return ""
    return "Sources: " + "; ".join(
        f"{r.get('title') or 'source'} ({r.get('kind')}, src={str(r['id'])[:8]})" for r in rows)


def list_sources(args: dict, turn: SourceTurn) -> dict:
    rows = turn.sources()
    counts = _counts([str(r["id"]) for r in rows], turn.user_id)
    out = []
    for r in rows:
        meta = r.get("meta") or {}
        item = {"source_id": str(r["id"]), "title": r.get("title"), "kind": r.get("kind"),
                "status": r.get("status")}
        if meta.get("pages"):
            item["pages"] = meta["pages"]
        if meta.get("duration"):
            item["duration"] = fmt_time(float(meta["duration"]))
        c = counts.get(str(r["id"])) or {}
        if c:
            item["figures"] = c.get("image", 0)
            item["tables"] = c.get("table", 0)
            item["formulas"] = c.get("formula", 0)
        out.append(item)
    return {"summary": f"{len(out)} source{'' if len(out) == 1 else 's'}", "sources": out}


def _element_text(el: dict) -> str:
    t = el["element_type"]
    content = (el.get("content") or "").strip()
    if t == "image":
        return el.get("description") or "(figure, no description yet — workspace.look_at reads it)"
    if t == "formula":
        return el.get("latex") or (f"(LaTeX not read yet; raw text: {content[:200]})"
                                   if content else "(LaTeX not read yet)")
    if t == "table":
        return content[:600] + (" …" if len(content) > 600 else "")
    return content[:300]


def find_elements(args: dict, turn: SourceTurn) -> dict:
    source = turn.source(args.get("source_id"))
    if source.get("kind") in _VIDEO_KINDS:
        raise SourceToolError("A video has no figures or tables. Use workspace.capture_frame, "
                              "capture_clip, capture_audio, or search_source to read its "
                              "transcript.")
    q = (get_supabase().table("resource_elements")
         .select("*").eq("resource_id", str(source["id"])).eq("user_id", turn.user_id))
    page = args.get("page")
    if page not in (None, ""):
        try:
            q = q.eq("page", int(page))
        except (TypeError, ValueError):
            raise SourceToolError("page must be a number.")
    kind = str(args.get("type") or "").strip()
    alias = {"figure": "image", "picture": "image", "diagram": "image"}
    kind = alias.get(kind, kind)
    if kind:
        if kind not in ("text", *_SHOWN_TYPES):
            raise SourceToolError("type is one of figure, table, formula, heading, text.")
        q = q.eq("element_type", kind)
    elif page in (None, ""):
        # The whole source: its structure and its non-text elements. Its text is
        # what the excerpts and quotes are for.
        q = q.in_("element_type", list(_SHOWN_TYPES))
    rows = q.order("page").order("order_index").limit(500).execute().data or []
    shown = rows[:MAX_ELEMENTS]
    elements = [{"element_id": str(el["id"]), "page": el.get("page"),
                 "type": "figure" if el["element_type"] == "image" else el["element_type"],
                 "text": _element_text(el)} for el in shown]
    more = len(rows) - len(shown)
    out = {"summary": f"{len(shown)} element{'' if len(shown) == 1 else 's'}"
                      f"{f' (+{more} more)' if more else ''} in {source.get('title')}",
           "source_id": str(source["id"]), "elements": elements}
    if more:
        out["more"] = f"{more} more — narrow by page or type."
    return out


#: Passages search_source returns at once.
MAX_PASSAGES = 5
_WORD = re.compile(r"[^\W_]{3,}", re.UNICODE)


def _label(anchor_type: str, value: float) -> str:
    if anchor_type == "time":
        return fmt_time(value)
    return f"p. {int(value)}" if anchor_type == "page" else f"§{int(value)}"


def search_source(args: dict, turn: SourceTurn) -> dict:
    """A source's own words: the excerpts are a few retrieved passages, so a
    quote from anywhere else (a video's transcript above all) starts here."""
    source = turn.source(args.get("source_id"))
    query = str(args.get("query") or "").strip()
    terms = {w.lower() for w in _WORD.findall(query)}
    if not terms:
        raise SourceToolError("query is required: words to look for in the source.")
    phrase = _norm(query)
    chunks = _chunks(str(source["id"]), turn.user_id)
    if not chunks:
        raise SourceToolError(
            f"{source.get('title')} has no text stored (for a video: its transcript could not "
            "be fetched). Tell the user; reprocessing the source may fix it.")
    scored = []
    for c in chunks:
        text = c.get("chunk_text") or ""
        low = text.lower()
        hits = sum(1 for t in terms if t in low)
        if not hits:
            continue
        score = hits / len(terms) + (1.0 if phrase and phrase in _norm(text) else 0.0)
        scored.append((score, -int(c.get("chunk_index") or 0), c))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    # The best matches, then in source order: "where is X first mentioned"
    # reads the list top down.
    best = sorted((c for _, _, c in scored[:MAX_PASSAGES]),
                  key=lambda c: int(c.get("chunk_index") or 0))
    passages = [{"where": _label(c.get("anchor_type") or "page", float(c.get("anchor_start") or 0)),
                 "text": " ".join((c.get("chunk_text") or "").split())[:900]} for c in best]
    n = len(passages)
    return {"summary": f"{n} passage{'' if n == 1 else 's'} in {source.get('title')}",
            "source_id": str(source["id"]), "passages": passages,
            **({} if n else {"note": "No passage has those words; try other words."})}


def insert_quote(args: dict, turn: SourceTurn) -> dict:
    source = turn.source(args.get("source_id"))
    text = " ".join(str(args.get("text") or "").split())
    if not text:
        raise SourceToolError("text is required: the exact words from the source.")
    if len(text) > 1500:
        raise SourceToolError("A quote is at most 1,500 characters; quote less.")
    chunks = _chunks(str(source["id"]), turn.user_id)
    wanted = _norm(text)
    probe = wanted[:160]
    hit = next((c for c in chunks if probe and probe in _norm(c.get("chunk_text") or "")), None)
    if hit is None and probe:
        # A quote can cross a chunk boundary: try each pair of neighbours.
        for a, b in zip(chunks, chunks[1:]):
            if probe in _norm(f"{a.get('chunk_text') or ''} {b.get('chunk_text') or ''}"):
                hit = a
                break
    if hit is None:
        raise SourceToolError("Those words are not in that source. Quote it word for word, "
                              "from the excerpts, workspace.search_source or "
                              "workspace.find_elements.")
    anchor_type = hit.get("anchor_type") or "page"
    value: float = float(hit.get("anchor_start") or 0)
    if args.get("page") not in (None, "") and anchor_type == "page":
        value = float(int(args["page"]))
    elif args.get("time") not in (None, "") and anchor_type == "time":
        value = parse_time(args["time"])
    if anchor_type == "page":
        label = f"p. {int(value)}"
    elif anchor_type == "time":
        label = fmt_time(value)
    else:
        label = f"§{int(value)}"
    record = {"kind": "quote", **_source_ref(source), "text": text,
              "anchor_type": anchor_type, "value": value if anchor_type == "time" else int(value),
              "label": label}
    return _insert(record, f"quote from {source.get('title')}, {label}")


def insert_formula(args: dict, turn: SourceTurn) -> dict:
    el, source = turn.element(args.get("element_id"))
    if el["element_type"] != "formula":
        raise SourceToolError("That element is not a formula.")
    latex = element_latex(el, turn.user_id, _owner_note(source))
    record = {"kind": "formula", **_source_ref(source), "latex": latex,
              "anchor_type": "page", "value": el.get("page"), "label": f"p. {el.get('page')}"}
    return _insert(record, f"formula, p. {el.get('page')}", latex=latex)


def insert_table(args: dict, turn: SourceTurn) -> dict:
    el, source = turn.element(args.get("element_id"))
    if el["element_type"] != "table":
        raise SourceToolError("That element is not a table.")
    md = (el.get("content") or "").strip()
    if not md:
        raise SourceToolError("That table has no text to insert.")
    record = {"kind": "table", **_source_ref(source), "markdown": md,
              "anchor_type": "page", "value": el.get("page"), "label": f"p. {el.get('page')}"}
    return _insert(record, f"table, p. {el.get('page')}")


def insert_figure(args: dict, turn: SourceTurn) -> dict:
    from services.workspace import storage
    el, source = turn.element(args.get("element_id"))
    if el["element_type"] not in ("image", "formula") or not el.get("image_path"):
        raise SourceToolError("That element is not a figure.")
    url = storage.signed_url(el["image_path"], LONG_LIVED)
    caption = str(args.get("caption") or "").strip()[:300]
    record = {"kind": "figure", **_source_ref(source), "url": url, "caption": caption,
              "anchor_type": "page", "value": el.get("page"), "label": f"p. {el.get('page')}"}
    extra = {"description": el["description"]} if el.get("description") else {}
    return _insert(record, f"figure, p. {el.get('page')}", **extra)


def _video_source(args: dict, turn: SourceTurn) -> dict:
    source = turn.source(args.get("source_id"))
    if source.get("kind") not in _VIDEO_KINDS:
        raise SourceToolError("Frames, clips and audio come from video sources only.")
    if turn.captures >= MAX_CAPTURES_PER_TURN:
        raise SourceToolError("One capture per message: it can take a minute. Tell the user "
                              "and offer the next one in your reply.")
    return source


def _capture(source: dict, kind: str, start: float, end: float | None) -> dict:
    from services.workspace.media import CaptureError, capture
    try:
        return capture(source, kind, start, end)
    except CaptureError as e:
        raise SourceToolError(f"The capture failed: {e}")


def capture_frame(args: dict, turn: SourceTurn) -> dict:
    source = _video_source(args, turn)
    t = parse_time(args.get("at"))
    turn.captures += 1
    cap = _capture(source, "frame", t, None)
    record = {"kind": "frame", **_source_ref(source), "url": cap["url"],
              "caption": str(args.get("caption") or "").strip()[:300],
              "anchor_type": "time", "value": t, "label": fmt_time(t)}
    said = _transcript_near(str(source["id"]), turn.user_id, t)
    return _insert(record, f"frame at {fmt_time(t)}",
                   **({"transcript_near": said} if said else {}))


def _span(args: dict) -> tuple[float, float]:
    start, end = parse_time(args.get("start")), parse_time(args.get("end"))
    if end <= start:
        raise SourceToolError("end must be after start.")
    if end - start > MAX_CLIP_SECONDS:
        raise SourceToolError(f"At most {MAX_CLIP_SECONDS} seconds at a time; cut a shorter piece.")
    return start, end


def capture_clip(args: dict, turn: SourceTurn) -> dict:
    source = _video_source(args, turn)
    start, end = _span(args)
    turn.captures += 1
    cap = _capture(source, "clip", start, end)
    label = f"{fmt_time(start)}–{fmt_time(end)}"
    record = {"kind": "clip", **_source_ref(source), "url": cap["url"],
              "caption": str(args.get("caption") or "").strip()[:300] or label,
              "anchor_type": "time", "value": start, "label": fmt_time(start)}
    return _insert(record, f"clip {label}")


def capture_audio(args: dict, turn: SourceTurn) -> dict:
    source = _video_source(args, turn)
    start, end = _span(args)
    turn.captures += 1
    cap = _capture(source, "audio", start, end)
    label = f"{fmt_time(start)}–{fmt_time(end)}"
    record = {"kind": "audio", **_source_ref(source), "url": cap["url"],
              "caption": str(args.get("caption") or "").strip()[:300] or label,
              "anchor_type": "time", "value": start, "label": fmt_time(start)}
    return _insert(record, f"audio {label}")


def describe_element(el: dict, user_id: str, note_id: str) -> str:
    """A figure's saved description, or a new one from one vision call."""
    if el.get("description"):
        return el["description"]
    from services.workspace import storage
    from services.workspace.figures import _downscale
    if not el.get("image_path"):
        raise SourceToolError("That element has no picture.")
    image = _downscale(storage.download(el["image_path"]))
    if image is None:
        raise SourceToolError("That crop holds no figure (too small or blank).")
    text = _vision(user_id, note_id, image, DESCRIBE_PROMPT)
    if text:
        _save(str(el["id"]), {"description": text,
                              "described_at": datetime.now(timezone.utc).isoformat()})
    return text


def element_latex(el: dict, user_id: str, note_id: str) -> str:
    """A formula's saved LaTeX, or a new reading saved for next time."""
    if el.get("latex"):
        return el["latex"]
    from services import privacy
    from services.workspace import storage
    from services.workspace.media import CaptureError, formula_to_latex
    if not el.get("image_path"):
        content = (el.get("content") or "").strip()
        if content:
            return content
        raise SourceToolError("That formula has no picture to read.")
    try:
        with privacy.handling([note_id], user_id):
            latex = formula_to_latex(storage.download(el["image_path"]), user_id)
    except CaptureError as e:
        raise SourceToolError(str(e))
    if latex:
        _save(str(el["id"]), {"latex": latex})
    return latex


def look_at(args: dict, turn: SourceTurn) -> dict:
    """Pixels to a vision model, once: what it sees is saved as text."""
    if args.get("element_id"):
        el, source = turn.element(args["element_id"])
        if el["element_type"] == "formula":
            latex = element_latex(el, turn.user_id, _owner_note(source))
            return {"summary": f"read the formula on p. {el.get('page')}", "latex": latex}
        if el["element_type"] != "image":
            return {"summary": "already text", "text": _element_text(el)}
        text = describe_element(el, turn.user_id, _owner_note(source))
        return {"summary": f"looked at the figure on p. {el.get('page')}", "description": text}
    if args.get("source_id") and args.get("at") not in (None, ""):
        # A moment in a video: capture the frame (it can then be inserted
        # without capturing it again) and describe it.
        source = _video_source(args, turn)
        t = parse_time(args["at"])
        turn.captures += 1
        cap = _capture(source, "frame", t, None)
        from services.workspace import storage
        text = _vision(turn.user_id, _owner_note(source), storage.download(cap["path"]),
                       DESCRIBE_PROMPT.replace("a figure from a study source "
                                               "(a lecture slide, paper or book)",
                                               "a frame from a video the user is studying"),
                       mime="image/jpeg")
        record = {"kind": "frame", **_source_ref(source), "url": cap["url"], "caption": "",
                  "anchor_type": "time", "value": t, "label": fmt_time(t)}
        return _insert(record, f"looked at {fmt_time(t)}", description=text)
    raise SourceToolError("Give element_id (a figure or formula), or source_id and at "
                          "(a moment in a video).")


# ── schemas ──────────────────────────────────────────────────────────────────

_SRC = {"type": "string", "description": "the source's id: src= in the excerpts, or from "
                                         "workspace.list_sources"}
_EL = {"type": "string", "description": "an element_id from workspace.find_elements"}
_TIME = {"type": ["number", "string"], "description": "seconds, or mm:ss"}
_CAPTION = {"type": "string", "description": "optional caption shown under it"}


def _schema(name: str, description: str, props: dict, required: list[str]) -> dict:
    return {"name": name, "description": description,
            "parameters": {"type": "object", "properties": props, "required": required}}


SCHEMAS: list[dict] = [
    _schema("workspace.list_sources",
            "The open note's sources: id, title, kind, pages or duration, and how many "
            "figures, tables and formulas each has.", {}, []),
    _schema("workspace.find_elements",
            "A PDF source's figures, tables, formulas and headings, as text (tables as "
            "markdown, formulas as LaTeX, figures as a description). Give page for "
            "everything on one page, type to list one kind.",
            {"source_id": _SRC, "page": {"type": "integer"},
             "type": {"type": "string", "enum": ["figure", "table", "formula", "heading", "text"]}},
            ["source_id"]),
    _schema("workspace.search_source",
            "Search one source's own text (a PDF's pages, a video's transcript) for "
            "words; gives up to 5 passages with their page or time, in source order. "
            "Use it to find exact words to quote, or a moment to capture.",
            {"source_id": _SRC, "query": {"type": "string", "description": "words to look for"}},
            ["source_id", "query"]),
    _schema("workspace.insert_quote",
            "Quote a source word for word, with a pill that jumps back to the place. "
            "Returns a token for your reply.",
            {"source_id": _SRC, "text": {"type": "string", "description": "the exact words"},
             "page": {"type": "integer", "description": "optional; found from the text"},
             "time": _TIME}, ["source_id", "text"]),
    _schema("workspace.insert_formula",
            "A formula from a source as an editable math block. Returns a token.",
            {"element_id": _EL}, ["element_id"]),
    _schema("workspace.insert_table",
            "A table from a source as a real table block. Returns a token.",
            {"element_id": _EL}, ["element_id"]),
    _schema("workspace.insert_figure",
            "A figure (picture, diagram) from a PDF source, with a page pill. Returns a token.",
            {"element_id": _EL, "caption": _CAPTION}, ["element_id"]),
    _schema("workspace.capture_frame",
            "A still frame from a video source at one moment, with a time pill. Takes up "
            "to a minute; one capture per message. Returns a token and the transcript "
            "around that moment.",
            {"source_id": _SRC, "at": _TIME, "caption": _CAPTION}, ["source_id", "at"]),
    _schema("workspace.capture_clip",
            f"A video clip from a video source, at most {MAX_CLIP_SECONDS} s. Takes up to a "
            "minute; one capture per message. Returns a token.",
            {"source_id": _SRC, "start": _TIME, "end": _TIME, "caption": _CAPTION},
            ["source_id", "start", "end"]),
    _schema("workspace.capture_audio",
            f"The audio of a stretch of a video source, at most {MAX_CLIP_SECONDS} s. One "
            "capture per message. Returns a token.",
            {"source_id": _SRC, "start": _TIME, "end": _TIME, "caption": _CAPTION},
            ["source_id", "start", "end"]),
    _schema("workspace.look_at",
            "Look at a figure's or formula's pixels (element_id), or at a moment of a video "
            "(source_id + at), when its text is not enough — the user asks about that "
            "figure or moment, or a figure has no description yet. Costs a vision call; "
            "what it sees is saved, so never look at the same figure twice.",
            {"element_id": _EL, "source_id": _SRC, "at": _TIME}, []),
]

_RUN = {
    "workspace.list_sources": list_sources,
    "workspace.find_elements": find_elements,
    "workspace.search_source": search_source,
    "workspace.insert_quote": insert_quote,
    "workspace.insert_formula": insert_formula,
    "workspace.insert_table": insert_table,
    "workspace.insert_figure": insert_figure,
    "workspace.capture_frame": capture_frame,
    "workspace.capture_clip": capture_clip,
    "workspace.capture_audio": capture_audio,
    "workspace.look_at": look_at,
}

NAMES = frozenset(_RUN)
#: Tools that read only; the rest make a block, a file or a vision call.
READS = frozenset({"workspace.list_sources", "workspace.find_elements",
                   "workspace.search_source"})


def execute(tool: str, args: dict, turn: SourceTurn) -> dict:
    fn = _RUN.get(tool)
    if fn is None:
        raise SourceToolError(f"unknown tool: {tool}")
    return fn(args or {}, turn)
