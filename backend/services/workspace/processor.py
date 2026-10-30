"""Source processing pipeline — runs in the background after a source attaches.

process_resource(resource_id):
  queued → processing → ready | failed

Steps (per kind): extract content → store selectable elements → anchored chunks
+ embeddings (grounded chat AND the text synthesis reassembles) → meta → ready →
maybe_synthesize(note_id).

There is no per-source summary and no per-source output note: the note already
exists (it is what the source attached to), and the AI draft is one synthesis
across every source on that note (services/workspace/synthesis.py).

Failure policy:
  extraction failure → status=failed (nothing usable)
  embedding failure  → warn, continue; chunk rows still inserted unembedded so
                       synthesis can still read the source text (chat degrades)
  synthesis failure  → recorded on note_synthesis, never fails the source
"""
from __future__ import annotations

import logging
import os
import tempfile

from services.database import get_supabase
from services.embedder import embed_batch
from services.workspace import storage
from services.workspace.dbretry import with_retry
from services.jobs.triggers import touch_settle
from services.workspace.synthesis import maybe_synthesize

logger = logging.getLogger(__name__)


def _pg_safe(text: str | None) -> str | None:
    """Postgres text columns reject a literal NUL byte outright (error
    22P05, "\\u0000 cannot be converted to text") — a known artifact of
    PDF text extraction on malformed/binary-embedded content streams.
    Strip it before any extracted text reaches an insert."""
    if text is None:
        return None
    return text.replace("\x00", "")


def _set_status(rid: str, status: str, error: str | None = None) -> None:
    patch: dict = {"status": status, "error": error}
    with_retry(lambda: get_supabase().table("note_resources")
               .update(patch).eq("id", rid).execute())


def _save_meta(rid: str, meta: dict) -> None:
    with_retry(lambda: get_supabase().table("note_resources")
               .update({"meta": meta}).eq("id", rid).execute())


def _insert_elements(resource: dict, elements: list[dict]) -> None:
    db = get_supabase()
    db.table("resource_elements").delete().eq("resource_id", resource["id"]).execute()
    rows = []
    for i, el in enumerate(elements):
        image_path = None
        if el.get("image_bytes"):
            image_path = f"{resource['user_id']}/{resource['id']}/elements/{i}.png"
            try:
                storage.upload(image_path, el["image_bytes"], "image/png")
            except Exception as e:
                logger.warning(f"element image upload failed: {e}")
                image_path = None
        rows.append({
            "resource_id": resource["id"],
            "user_id": resource["user_id"],
            "page": el.get("page", 0),
            "element_type": el["element_type"],
            "order_index": el.get("order_index", i),
            "bbox": el.get("bbox"),
            "content": _pg_safe(el.get("content")),
            "image_path": image_path,
        })
    for start in range(0, len(rows), 200):
        db.table("resource_elements").insert(rows[start:start + 200]).execute()


def _insert_chunks(resource: dict, chunks: list[dict]) -> None:
    if not chunks:
        return
    db = get_supabase()
    db.table("resource_chunks").delete().eq("resource_id", resource["id"]).execute()
    embeddings: list | None = None
    try:
        embeddings = embed_batch([c["chunk_text"] for c in chunks])
    except Exception as e:
        # Chat degrades for this source, but the chunk TEXT is what synthesis
        # reassembles the source from — so the rows still go in, unembedded.
        logger.warning(f"resource {resource['id']}: embedding skipped: {e}")
    rows = []
    for i, c in enumerate(chunks):
        row = {
            "resource_id": resource["id"],
            "note_id": resource["note_id"],
            "user_id": resource["user_id"],
            "chunk_index": c["chunk_index"],
            "chunk_text": _pg_safe(c["chunk_text"]),
            "anchor_type": c["anchor_type"],
            "anchor_start": c["anchor_start"],
            "anchor_end": c["anchor_end"],
        }
        if embeddings is not None:
            row["embedding"] = "[" + ",".join(str(v) for v in embeddings[i]) + "]"
        rows.append(row)
    for start in range(0, len(rows), 200):
        db.table("resource_chunks").insert(rows[start:start + 200]).execute()


def _paired(db, resource: dict, want_video: bool) -> dict | None:
    """The other half of a video + subtitle pair on this note: same name, the other kind."""
    from services.workspace.subtitles import is_subtitle, same_name
    try:
        rows = (db.table("note_resources").select("id,title,kind,storage_path,meta")
                .eq("note_id", resource["note_id"]).execute().data or [])
    except Exception:                                    # noqa: BLE001
        return None
    for r in rows:
        if r.get("id") == resource["id"] or not same_name(r.get("title"), resource.get("title")):
            continue
        if want_video and r.get("kind") == "video":
            return r
        if not want_video and r.get("kind") == "document" and is_subtitle(r.get("storage_path")):
            return r
    return None


def _lone_subtitle(db, resource: dict) -> dict | None:
    """The one subtitle file on this note that no video has claimed yet, if there is
    exactly one: a YouTube video's title rarely matches the file's name."""
    from services.workspace.subtitles import is_subtitle
    try:
        rows = (db.table("note_resources").select("id,title,kind,storage_path,meta")
                .eq("note_id", resource["note_id"]).execute().data or [])
    except Exception:                                    # noqa: BLE001
        return None
    free = [r for r in rows if r.get("id") != resource["id"] and r.get("kind") == "document"
            and is_subtitle(r.get("storage_path")) and not (r.get("meta") or {}).get("paired_video")]
    return free[0] if len(free) == 1 else None


def _mark_subtitle_paired(db, subtitle: dict, video_id: str) -> None:
    """The video now carries these cues: the subtitle source keeps its readable sections but
    leaves synthesis and chat, so the words aren't counted twice."""
    meta = dict(subtitle.get("meta") or {})
    meta["paired_video"] = video_id
    db.table("note_resources").update({"meta": meta}).eq("id", subtitle["id"]).execute()
    db.table("resource_chunks").delete().eq("resource_id", subtitle["id"]).execute()


RESUME_LIMIT = 2


def resume_interrupted(limit: int = 20) -> int:
    """Run again the sources a restart cut off. Processing runs inside the web process, so a
    deploy, the free plan's sleep or a crash leaves a source on "processing" with nothing
    working on it — a spinner forever, no retry button. Called once at startup. After
    RESUME_LIMIT restarts in a row the source is marked failed instead (it may be what crashed
    the server), so the user gets the retry button. "queued" is left alone: a deferred drop
    waits there on purpose until the user starts it."""
    rows = (get_supabase().table("note_resources").select("id,meta")
            .eq("status", "processing").limit(limit).execute().data or [])
    resumed = 0
    for r in rows:
        meta = dict(r.get("meta") or {})
        tries = int(meta.get("resumed") or 0)
        try:
            if tries >= RESUME_LIMIT:
                # "failed", the only give-up status the table's check constraint allows
                _set_status(r["id"], "failed",
                            "Processing was cut off twice (the server restarted). Try again.")
                continue
            meta["resumed"] = tries + 1
            _save_meta(r["id"], meta)
            process_resource(r["id"])
            resumed += 1
        except Exception as e:                           # noqa: BLE001
            # one bad row must not keep the others on "processing" forever
            logger.warning(f"resume_interrupted: {r['id']} skipped: {e}")
    if rows:
        logger.info(f"resume_interrupted: {resumed} resumed, {len(rows) - resumed} given up")
    return resumed


def process_resource(resource_id: str) -> None:
    """Extract one source. Its text, figures and formulas go to models on the
    note's behalf, so the note's privacy level applies (services/privacy.py)."""
    from services import privacy
    try:
        owner = (get_supabase().table("note_resources").select("note_id,user_id")
                 .eq("id", resource_id).limit(1).execute().data or [])
    except Exception:                                    # noqa: BLE001
        owner = []
    if not owner:
        return _process_resource(resource_id)
    # As the owner: their privacy levels, and their own skills (skill_store).
    from services.skill_store import as_user
    with privacy.handling([owner[0]["note_id"]], str(owner[0]["user_id"])), \
            as_user(str(owner[0]["user_id"])):
        return _process_resource(resource_id)


def _process_resource(resource_id: str) -> None:
    db = get_supabase()
    rows = db.table("note_resources").select("*").eq("id", resource_id).execute().data
    if not rows:
        logger.warning(f"process_resource: {resource_id} not found")
        return
    resource = rows[0]
    _set_status(resource_id, "processing")
    meta = dict(resource.get("meta") or {})

    try:
        # NOTE: nothing here keeps the extracted text in memory. Synthesis
        # rebuilds each source from its `resource_chunks` rows
        # (synthesis.source_text_from_chunks), because it runs long after every
        # source has settled. `_insert_chunks` IS the handoff to the model —
        # anything not in a chunk row is invisible to it. This used to assign
        # `source_text`/`video_url` locals that nothing ever read, which made it
        # look like there was a second path.
        if resource["kind"] in ("pdf", "document"):
            from services.workspace.pdf_elements import extract_pdf, chunk_pages
            suffix = os.path.splitext(resource.get("storage_path") or "")[1] or ".pdf"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(storage.download(resource["storage_path"]))
                tmp_path = tmp.name
            try:
                if suffix == ".pdf":
                    data = extract_pdf(tmp_path)
                    meta.update({"pages": data["page_count"],
                                 "page_sizes": data["page_sizes"]})
                    # first-page thumbnail
                    try:
                        import fitz
                        doc = fitz.open(tmp_path)
                        pix = doc[0].get_pixmap(dpi=72)
                        tpath = f"{resource['user_id']}/{resource_id}/thumbnail.png"
                        storage.upload(tpath, pix.tobytes("png"), "image/png")
                        meta["thumbnail_path"] = tpath
                        doc.close()
                    except Exception:
                        pass
                    _insert_elements(resource, data["elements"])
                    pages_text = data["pages_text"]
                    textless = data.get("textless_pages") or []
                    if textless:
                        # Scanned pages: a vision model reads them (services/workspace/scanned.py).
                        from services.workspace.scanned import NoVision, read_scanned_pages
                        try:
                            read = read_scanned_pages(tmp_path, textless, resource["user_id"])
                        except NoVision:
                            read = {}
                            if len(textless) == len(pages_text):
                                raise ValueError(
                                    "This PDF is scanned (no text in it). Reading it needs an AI "
                                    "provider that can read images, allowed for this note.")
                        for pno, text in read.items():
                            pages_text[pno - 1] = f"[page {pno}]\n{text}"
                        meta["scanned_pages"] = len(textless)
                        meta["scanned_pages_read"] = len(read)
                    _insert_chunks(resource, chunk_pages(pages_text))
                else:
                    # md/txt: split into sections, exactly like a website. The
                    # old path tagged the WHOLE file "[page 1]", so every chunk,
                    # anchor and jump chip on a long markdown file pointed at
                    # page 1 and note<->source sync did nothing at all. Elements
                    # are inserted too, which is what lets the website viewer
                    # render these (SourceViewer routes `document` to it).
                    from services.workspace.sections import (
                        chunk_sections, sections_as_elements, split_markdown_sections)
                    if suffix.lower() in (".srt", ".vtt"):
                        from services.workspace.subtitles import parse_subtitles, subtitle_sections
                        with open(tmp_path, "rb") as f:
                            cues = parse_subtitles(f.read())
                        if not cues:
                            raise ValueError("No subtitle cues found in this file.")
                        sub_sections = subtitle_sections(cues)
                        _insert_elements(resource, sections_as_elements(sub_sections))
                        video = _paired(db, resource, want_video=True)
                        if video:
                            meta["paired_video"] = video["id"]
                        else:
                            _insert_chunks(resource, chunk_sections(sub_sections))
                        raw = None
                    elif suffix.lower() in (".docx", ".pptx", ".xlsx"):
                        # Office files become markdown first (headings, lists, tables,
                        # slides, sheets) and then take the same section path.
                        from services.office_extract import office_to_markdown
                        raw = office_to_markdown(tmp_path, suffix)
                    else:
                        with open(tmp_path, encoding="utf-8", errors="replace") as f:
                            raw = f.read()
                    if raw is not None:
                        doc_sections = split_markdown_sections(raw)
                        _insert_elements(resource, sections_as_elements(doc_sections))
                        _insert_chunks(resource, chunk_sections(doc_sections))
            finally:
                os.unlink(tmp_path)

        elif resource["kind"] == "youtube":
            from services.workspace import youtube
            vid = youtube.youtube_video_id(resource["source_url"] or "")
            if not vid:
                raise ValueError("Not a recognizable YouTube URL.")
            ometa = youtube.fetch_metadata(resource["source_url"])
            meta.update({k: v for k, v in ometa.items() if v})
            if ometa.get("title") and resource["title"].startswith("YouTube"):
                db.table("note_resources").update(
                    {"title": ometa["title"]}).eq("id", resource_id).execute()
                resource["title"] = ometa["title"]
            chapters = youtube.fetch_chapters(resource["source_url"])
            if chapters:
                meta["chapters"] = chapters
            try:
                snippets = youtube.fetch_transcript(vid)
                meta["has_transcript"] = True
                meta["transcript"] = youtube.transcript_lines(snippets)
                _insert_chunks(resource, youtube.chunk_transcript(snippets, chapters=chapters))
            except ValueError:
                # YouTube refuses caption requests from many cloud servers
                # (Render's, seen live 2026-10-30). A subtitle file in the same
                # session stands in: the video's name, or the only one there.
                subtitle = _paired(db, resource, want_video=False) or _lone_subtitle(db, resource)
                snippets = None
                if subtitle:
                    from services.workspace.subtitles import parse_subtitles
                    try:
                        snippets = parse_subtitles(storage.download(subtitle["storage_path"]))
                    except Exception as e:                        # noqa: BLE001
                        logger.warning(f"resource {resource_id}: subtitle unreadable: {e}")
                if snippets:
                    meta["has_transcript"] = True
                    meta["transcript_from"] = "subtitles"
                    meta["transcript"] = youtube.transcript_lines(snippets)
                    _insert_chunks(resource, youtube.chunk_transcript(snippets, chapters=chapters))
                    _mark_subtitle_paired(db, subtitle, resource_id)
                else:
                    # No transcript: synthesis re-derives the video URL from the
                    # source row and takes the Gemini-native path (synthesis._complete).
                    meta["has_transcript"] = False

        elif resource["kind"] == "video":
            from services.workspace import video as vsvc
            suffix = os.path.splitext(resource.get("storage_path") or "")[1] or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(storage.download(resource["storage_path"]))
                tmp_path = tmp.name
            try:
                meta.update(vsvc.probe(tmp_path))
                chapters = meta.get("chapters") or []
                if chapters:
                    # The file's own chapter marks, each with a picture (ArtCraft study V3).
                    for i, frame in enumerate(vsvc.chapter_frames(tmp_path, chapters)):
                        if not frame:
                            continue
                        try:
                            cpath = f"{resource['user_id']}/{resource_id}/chapter_{i}.jpg"
                            storage.upload(cpath, frame, "image/jpeg")
                            chapters[i]["thumb_path"] = cpath
                        except Exception as e:
                            logger.info(f"resource {resource_id}: chapter picture skipped: {e}")
                subtitle = _paired(db, resource, want_video=False)
                try:
                    if subtitle:
                        # A subtitle file of the same name: use its cues, skip Whisper.
                        from services.workspace.subtitles import parse_subtitles
                        snippets = parse_subtitles(storage.download(subtitle["storage_path"]))
                        if not snippets:
                            raise RuntimeError("the subtitle file has no cues")
                        meta["transcript_from"] = "subtitles"
                        _mark_subtitle_paired(db, subtitle, resource_id)
                    else:
                        snippets = vsvc.transcribe(tmp_path)
                    # Speaker labels only when clearly more than one voice (speakers.py).
                    from services.workspace.speakers import label_speakers, with_speakers
                    labels = label_speakers(tmp_path, snippets)
                    if labels:
                        snippets = with_speakers(snippets, labels)
                        meta["speakers"] = max(labels) + 1
                    from services.workspace import youtube as yts
                    meta["has_transcript"] = True
                    meta["transcript"] = yts.transcript_lines(snippets)
                    _insert_chunks(resource, yts.chunk_transcript(snippets, chapters=chapters or None))
                except RuntimeError as e:
                    logger.warning(f"resource {resource_id}: {e}")
                    meta["has_transcript"] = False
            finally:
                os.unlink(tmp_path)

        elif resource["kind"] == "website":
            from services.workspace.website import extract_website, chunk_sections
            data = extract_website(resource["source_url"])
            meta.update({k: v for k, v in data["meta"].items() if v})
            if data["title"] and resource["title"] in ("Untitled source", resource["source_url"]):
                db.table("note_resources").update(
                    {"title": data["title"]}).eq("id", resource_id).execute()
                resource["title"] = data["title"]
            elements = [
                {"page": 0, "element_type": "image" if s["kind"] == "image"
                 else ("heading" if s["kind"] == "heading" else "text"),
                 "order_index": s["index"], "bbox": None,
                 "content": s["content"], "image_bytes": None}
                for s in data["sections"]
            ]
            _insert_elements(resource, elements)
            _insert_chunks(resource, chunk_sections(data["sections"]))

        else:
            raise ValueError(f"Unknown resource kind: {resource['kind']}")

        _save_meta(resource_id, meta)
        _set_status(resource_id, "ready")
        logger.info(f"source {resource_id} ready (kind={resource['kind']})")

        # One note per session: the last source to settle fires the single
        # synthesis across every source on this note. Never fails the source.
        try:
            maybe_synthesize(resource.get("note_id"))
        except Exception as e:
            logger.warning(f"source {resource_id}: synthesis trigger failed: {e}")
        _touch_settle_safely(resource.get("note_id"))

    except Exception as e:
        logger.exception(f"resource {resource_id} processing failed")
        _set_status(resource_id, "failed", str(e)[:500])
        # A source failing still counts as settling: a "when a source is
        # added" trigger on the note must not wait forever for a file that
        # will never turn ready.
        _touch_settle_safely(resource.get("note_id"))


def _touch_settle_safely(note_id: str | None) -> None:
    if not note_id:
        return
    try:
        touch_settle(note_id)
    except Exception as e:                                    # noqa: BLE001
        logger.warning(f"note {note_id}: background-job trigger touch failed: {e}")
