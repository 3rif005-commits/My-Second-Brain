"""Ingest router — PDF, URL, and audio/video ingestion pipeline."""

import os
import tempfile
import uuid
from fastapi import APIRouter, Header, HTTPException, UploadFile, File, Form, status
from pydantic import BaseModel

from services.database import get_supabase
from services.pdf_extractor import extract_pdf
from services.url_extractor import extract_url
from services.llm import generate_mastery_guide, extract_metadata

router = APIRouter(prefix="/ingest", tags=["ingest"])


def get_user_id(authorization: str) -> str:
    """Validate the Supabase JWT by calling the Supabase auth API.

    This works for both HS256 (legacy) and ES256 (current) tokens because
    Supabase's own auth server handles the algorithm decision, so we don't
    need to know which key type is in use.
    """
    token = authorization.removeprefix("Bearer ").strip()
    try:
        response = get_supabase().auth.get_user(token)
        if not response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )
        return response.user.id
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token validation failed: {e}",
        )


class UrlIngestRequest(BaseModel):
    url: str


@router.post("/pdf")
async def ingest_pdf(
    file: UploadFile = File(...),
    authorization: str = Header(),
    x_llm_model: str | None = Header(default=None),
):
    """Upload a PDF → extract text → LLM generates mastery guide → save note."""
    user_id = get_user_id(authorization)
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    # Write to a temp file so fitz can open it
    suffix = ".pdf"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        source_text = extract_pdf(tmp_path)
    finally:
        os.unlink(tmp_path)

    if not source_text.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from PDF.")

    # Generate mastery guide HTML
    html_content = generate_mastery_guide(source_text, title=file.filename, model_override=x_llm_model)

    # Extract title & topics
    try:
        meta = extract_metadata(source_text)
        title = meta.get("title") or file.filename or "Untitled"
        topics = meta.get("topics") or []
    except Exception:
        title = file.filename or "Untitled"
        topics = []

    # Save note to Supabase
    db = get_supabase()
    result = (
        db.table("notes")
        .insert({
            "user_id": user_id,
            "title": title,
            "content": [],           # BlockNote JSON will be set by client after streaming
            "content_text": source_text[:10000],
            "source_type": "pdf",
            "source_filename": file.filename,
            "topics": topics,
        })
        .execute()
    )
    note = result.data[0]

    return {
        "note_id": note["id"],
        "title": title,
        "html": html_content,
        "topics": topics,
    }


@router.post("/url")
async def ingest_url(
    body: UrlIngestRequest,
    authorization: str = Header(),
    x_llm_model: str | None = Header(default=None),
):
    """Fetch a URL → extract article text → LLM generates mastery guide → save note."""
    user_id = get_user_id(authorization)

    try:
        title, source_text = extract_url(body.url)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    html_content = generate_mastery_guide(source_text, title=title, model_override=x_llm_model)

    try:
        meta = extract_metadata(source_text)
        topics = meta.get("topics") or []
    except Exception:
        topics = []

    db = get_supabase()
    result = (
        db.table("notes")
        .insert({
            "user_id": user_id,
            "title": title,
            "content": [],
            "content_text": source_text[:10000],
            "source_type": "url",
            "source_url": body.url,
            "topics": topics,
        })
        .execute()
    )
    note = result.data[0]

    return {
        "note_id": note["id"],
        "title": title,
        "html": html_content,
        "topics": topics,
    }


@router.post("/")
async def ingest_auto(
    authorization: str = Header(),
    x_llm_model: str | None = Header(default=None),
    file: UploadFile | None = File(default=None),
    url: str | None = Form(default=None),
):
    """Auto-dispatch: if file is present → PDF ingest, else URL ingest."""
    if file:
        return await ingest_pdf(file=file, authorization=authorization, x_llm_model=x_llm_model)
    if url:
        return await ingest_url(body=UrlIngestRequest(url=url), authorization=authorization, x_llm_model=x_llm_model)
    raise HTTPException(status_code=400, detail="Provide either a file or a url.")
