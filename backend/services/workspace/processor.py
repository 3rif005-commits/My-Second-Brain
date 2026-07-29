"""Resource processing pipeline — runs in the background after import.

process_resource(resource_id):
  queued → processing → ready | failed

Steps (per kind): extract content → store selectable elements → anchored chunks
+ embeddings (grounded chat) → AI summary (extended mastery-guide prompt) →
create the output note + its canvas card.

Failure policy:
  extraction failure          → status=failed (nothing usable)
  embedding failure           → warn, continue (chat degraded)
  summary failure             → status=ready + meta.summary_error (reprocess to retry)
"""
from __future__ import annotations

import logging
import os
import re
import tempfile
import time

from services.database import get_supabase
from services.embedder import embed_batch
from services.workspace import storage
from services.ai.client import complete
from services.ai.router import complete_with_fallback, pick
from prompts.workspace_summary import build_workspace_summary_prompt

logger = logging.getLogger(__name__)

_FENCE = re.compile(r"^```(?:html)?\s*|\s*```$", re.MULTILINE)


def _strip_fences(html: str) -> str:
    return _FENCE.sub("", html or "").strip()


def _with_retry(fn, attempts: int = 3, backoff: float = 0.5):
    """Retry on transient Supabase disconnects (pooled HTTP/2 connections that
    go stale behind a slow ffmpeg/yt-dlp/whisper step get dropped server-side
    and raise on the next reuse). Without this, a fully-successful capture or
    transcription run can get its terminal status write lost and the resource
    ends up mismarked `failed`, forcing a needless full reprocess."""
    for attempt in range(attempts):
        try:
            return fn()
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(backoff * (attempt + 1))


def _set_status(rid: str, status: str, error: str | None = None) -> None:
    patch: dict = {"status": status, "error": error}
    _with_retry(lambda: get_supabase().table("workspace_resources")
                .update(patch).eq("id", rid).execute())


def _save_meta(rid: str, meta: dict) -> None:
    _with_retry(lambda: get_supabase().table("workspace_resources")
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
            "content": el.get("content"),
            "image_path": image_path,
        })
    for start in range(0, len(rows), 200):
        db.table("resource_elements").insert(rows[start:start + 200]).execute()


def _insert_chunks(resource: dict, chunks: list[dict]) -> None:
    if not chunks:
        return
    db = get_supabase()
    db.table("resource_chunks").delete().eq("resource_id", resource["id"]).execute()
    try:
        embeddings = embed_batch([c["chunk_text"] for c in chunks])
    except Exception as e:
        logger.warning(f"resource {resource['id']}: embedding skipped: {e}")
        return
    rows = [
        {
            "resource_id": resource["id"],
            "workspace_id": resource["workspace_id"],
            "user_id": resource["user_id"],
            "chunk_index": c["chunk_index"],
            "chunk_text": c["chunk_text"],
            "anchor_type": c["anchor_type"],
            "anchor_start": c["anchor_start"],
            "anchor_end": c["anchor_end"],
            "embedding": "[" + ",".join(str(v) for v in emb) + "]",
        }
        for c, emb in zip(chunks, embeddings)
    ]
    for start in range(0, len(rows), 200):
        db.table("resource_chunks").insert(rows[start:start + 200]).execute()


def _generate_summary(resource: dict, source_text: str, video_url: str | None = None) -> str:
    """Returns BlockNote-compatible HTML with data-anchor attributes."""
    kind = resource["kind"]
    user_id = resource["user_id"]

    if video_url and not source_text:
        provider = pick("summarize_video", user_id)
        if provider is None or "video_native" not in provider.capabilities:
            raise RuntimeError("No transcript and no video-capable provider configured.")
        prompt = build_workspace_summary_prompt(
            "(Watch the attached video. Derive section timestamps yourself and use "
            "them as t: anchors.)", resource["title"], kind)
        return _strip_fences(complete(provider, [{
            "role": "user",
            "content": [{"type": "text", "text": prompt},
                        {"type": "video_url", "url": video_url}],
        }], max_tokens=8192))

    prompt = build_workspace_summary_prompt(source_text, resource["title"], kind)
    return _strip_fences(complete_with_fallback("summarize_text", user_id, [
        {"role": "user", "content": prompt},
    ], max_tokens=8192))


_NOTE_SOURCE_TYPE = {"pdf": "pdf", "document": "text", "youtube": "video",
                     "video": "video", "website": "url"}


def _create_output_note(resource: dict, summary_html: str | None) -> str:
    """Create the output note + its canvas card; returns note id."""
    db = get_supabase()
    plain = re.sub(r"<[^>]+>", " ", summary_html or "")[:10000]
    note = db.table("notes").insert({
        "user_id": resource["user_id"],
        "title": resource["title"],
        "content": [],
        "content_text": plain,
        "source_type": _NOTE_SOURCE_TYPE.get(resource["kind"], "text"),
        "source_url": resource.get("source_url"),
        "source_filename": os.path.basename(resource.get("storage_path") or "") or None,
    }).execute().data[0]

    db.table("workspace_resources").update({"note_id": note["id"]}).eq(
        "id", resource["id"]).execute()

    # note card sits to the right of the resource card
    db.table("workspace_pages").upsert({
        "workspace_id": resource["workspace_id"],
        "user_id": resource["user_id"],
        "note_id": note["id"],
        "pos_x": (resource.get("pos_x") or 0) + (resource.get("width") or 280) + 60,
        "pos_y": resource.get("pos_y") or 0,
        "width": 320,
        "height": 220,
    }, on_conflict="workspace_id,note_id").execute()
    return note["id"]


def process_resource(resource_id: str) -> None:
    db = get_supabase()
    rows = db.table("workspace_resources").select("*").eq("id", resource_id).execute().data
    if not rows:
        logger.warning(f"process_resource: {resource_id} not found")
        return
    resource = rows[0]
    _set_status(resource_id, "processing")
    meta = dict(resource.get("meta") or {})

    try:
        source_text = ""
        video_url: str | None = None

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
                    _insert_chunks(resource, chunk_pages(data["pages_text"]))
                    source_text = "\n\n".join(data["pages_text"])
                else:
                    # md/txt documents: single text, page = 1
                    with open(tmp_path, encoding="utf-8", errors="replace") as f:
                        raw = f.read()
                    source_text = f"[page 1]\n{raw}"
                    _insert_chunks(resource, chunk_pages([source_text]))
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
                db.table("workspace_resources").update(
                    {"title": ometa["title"]}).eq("id", resource_id).execute()
                resource["title"] = ometa["title"]
            try:
                snippets = youtube.fetch_transcript(vid)
                source_text = youtube.transcript_text(snippets)
                meta["has_transcript"] = True
                _insert_chunks(resource, youtube.chunk_transcript(snippets))
            except ValueError:
                meta["has_transcript"] = False
                video_url = resource["source_url"]  # gemini-native path

        elif resource["kind"] == "video":
            from services.workspace import video as vsvc
            suffix = os.path.splitext(resource.get("storage_path") or "")[1] or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(storage.download(resource["storage_path"]))
                tmp_path = tmp.name
            try:
                meta.update(vsvc.probe(tmp_path))
                try:
                    snippets = vsvc.transcribe(tmp_path)
                    from services.workspace import youtube as yts
                    source_text = yts.transcript_text(snippets)
                    meta["has_transcript"] = True
                    _insert_chunks(resource, yts.chunk_transcript(snippets))
                except RuntimeError as e:
                    logger.warning(f"resource {resource_id}: {e}")
                    meta["has_transcript"] = False
            finally:
                os.unlink(tmp_path)

        elif resource["kind"] == "website":
            from services.workspace.website import extract_website, chunk_sections
            data = extract_website(resource["source_url"])
            meta.update({k: v for k, v in data["meta"].items() if v})
            if data["title"] and resource["title"] in ("Untitled resource", resource["source_url"]):
                db.table("workspace_resources").update(
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
            source_text = data["tagged_text"]

        else:
            raise ValueError(f"Unknown resource kind: {resource['kind']}")

        _save_meta(resource_id, meta)

        # ---- AI summary (the output note draft) ----
        summary_html: str | None = None
        try:
            if source_text or video_url:
                summary_html = _generate_summary(resource, source_text, video_url)
                db.table("workspace_resources").update(
                    {"summary_html": summary_html}).eq("id", resource_id).execute()
            else:
                meta["summary_error"] = ("No extractable content and no video-capable "
                                         "provider — note starts blank.")
                _save_meta(resource_id, meta)
        except Exception as e:
            logger.warning(f"resource {resource_id}: summary failed: {e}")
            meta["summary_error"] = str(e)[:500]
            _save_meta(resource_id, meta)

        # ---- output note + canvas card ----
        if not resource.get("note_id"):
            _create_output_note(resource, summary_html)

        _set_status(resource_id, "ready")
        logger.info(f"resource {resource_id} ready (kind={resource['kind']})")

    except Exception as e:
        logger.exception(f"resource {resource_id} processing failed")
        _set_status(resource_id, "failed", str(e)[:500])
