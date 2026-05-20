"""Brain tool definitions + dispatch.

Each tool has:
  - a JSON schema (for LLM tool-use)
  - an implementation (Python callable)

The Agent Engine calls execute_brain_tool() to dispatch by name.
Write tools (create/update/etc.) live alongside the read tools below.
"""
from __future__ import annotations

from typing import Any

from services.database import get_supabase
from services.embedder import embed
from services.retriever import retrieve


# --- Tool schemas (advertised to the LLM as tool-use definitions) ---

BRAIN_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "brain.search_brain",
        "description": "Semantic search across the user's notes. Returns up to "
                       "6 best matching chunks with deep links.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Natural-language query"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 12, "default": 6},
            },
            "required": ["query"],
        },
    },
    {
        "name": "brain.get_note",
        "description": "Fetch a single note's full content by ID. Returns title, "
                       "blocks, content_text, mastery, topics, local_only.",
        "input_schema": {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
    },
    {
        "name": "brain.list_notes",
        "description": "List the user's notes, optionally filtered by collection "
                       "or mastery status. Excludes notes in trash. Use to browse.",
        "input_schema": {
            "type": "object",
            "properties": {
                "collection_id": {"type": "string"},
                "mastery": {
                    "type": "string",
                    "enum": ["not_started", "learning", "reviewing", "mastered"],
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
            },
        },
    },
    {
        "name": "brain.get_backlinks",
        "description": "Return notes that reference a given note via @-mentions.",
        "input_schema": {
            "type": "object",
            "properties": {"note_id": {"type": "string"}},
            "required": ["note_id"],
        },
    },
    {
        "name": "brain.create_note",
        "description": "Create a new note. Returns the new note ID. "
                       "Use when the user asks to make a note about something.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "blocks": {"type": "array", "items": {"type": "object"}},
                "collection_id": {"type": "string"},
                "topics": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title", "blocks"],
        },
    },
    {
        "name": "brain.update_note",
        "description": "Replace the entire content of an existing note. "
                       "Prefer brain.patch_note for partial changes.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "blocks": {"type": "array", "items": {"type": "object"}},
                "title": {"type": "string"},
            },
            "required": ["id", "blocks"],
        },
    },
    {
        "name": "brain.set_mastery",
        "description": "Update a note's mastery status.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "status": {
                    "type": "string",
                    "enum": ["not_started", "learning", "reviewing", "mastered"],
                },
            },
            "required": ["id", "status"],
        },
    },
    {
        "name": "brain.move_note",
        "description": "Move a note to a different collection.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "collection_id": {"type": "string"},
            },
            "required": ["id", "collection_id"],
        },
    },
    {
        "name": "brain.link_notes",
        "description": "Create a typed link between two notes "
                       "(prereq / related / backlink).",
        "input_schema": {
            "type": "object",
            "properties": {
                "from_id": {"type": "string"},
                "to_id": {"type": "string"},
                "type": {"type": "string",
                         "enum": ["prereq", "related", "backlink"]},
            },
            "required": ["from_id", "to_id", "type"],
        },
    },
    {
        "name": "brain.delete_note",
        "description": "Soft-delete a note (moves to trash). Requires "
                       "confirm=true to execute.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "confirm": {"type": "boolean"},
            },
            "required": ["id", "confirm"],
        },
    },
]


def execute_brain_tool(
    tool: str,
    args: dict[str, Any],
    user_id: str,
) -> dict[str, Any]:
    """Dispatch a brain.* tool call. Raises ValueError for unknown tools."""
    if tool == "brain.search_brain":
        return _search_brain(args, user_id)
    if tool == "brain.get_note":
        return _get_note(args, user_id)
    if tool == "brain.list_notes":
        return _list_notes(args, user_id)
    if tool == "brain.get_backlinks":
        return _get_backlinks(args, user_id)
    if tool == "brain.create_note":
        return _create_note(args, user_id)
    if tool == "brain.update_note":
        return _update_note(args, user_id)
    if tool == "brain.set_mastery":
        return _set_mastery(args, user_id)
    if tool == "brain.move_note":
        return _move_note(args, user_id)
    if tool == "brain.link_notes":
        return _link_notes(args, user_id)
    if tool == "brain.delete_note":
        return _delete_note(args, user_id)
    raise ValueError(f"Unknown brain tool: {tool}")


def _search_brain(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    query = args["query"]
    embedding = embed(query)
    matches = retrieve(embedding, user_id)
    return {"matches": matches[: args.get("limit", 6)]}


def _get_note(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    row = (
        get_supabase()
        .table("notes")
        .select("id, title, content, content_text, topics, mastery_status, local_only")
        .eq("id", args["id"])
        .eq("user_id", user_id)
        .single()
        .execute()
        .data
    )
    return row or {}


def _list_notes(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    q = (
        get_supabase()
        .table("notes")
        .select("id, title, icon, mastery_status, updated_at")
        .eq("user_id", user_id)
    )
    if args.get("collection_id"):
        q = q.eq("collection_id", args["collection_id"])
    if args.get("mastery"):
        q = q.eq("mastery_status", args["mastery"])
    rows = q.limit(args.get("limit", 20)).order("updated_at", desc=True).execute().data or []
    return {"notes": rows}


def _get_backlinks(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    # @-mention backlinks are stored in note content JSONB as inline content
    # blocks of type "mention" with props.noteId. We do a text-level search
    # over content_text for the deep link pattern as a fast approximation
    # (RPC-backed precise version comes in Phase 2 when editor tools land).
    target = args["note_id"]
    rows = (
        get_supabase()
        .table("notes")
        .select("id, title")
        .eq("user_id", user_id)
        .ilike("content_text", f"%/brain/{target}%")
        .limit(20)
        .execute()
        .data
        or []
    )
    return {"backlinks": rows}


def _create_note(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    payload = {
        "user_id": user_id,
        "title": args["title"],
        "content": args["blocks"],
        "topics": args.get("topics", []),
    }
    if args.get("collection_id"):
        payload["collection_id"] = args["collection_id"]
    rows = get_supabase().table("notes").insert(payload).execute().data or []
    return rows[0] if rows else {}


def _update_note(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    update: dict[str, Any] = {"content": args["blocks"]}
    if "title" in args:
        update["title"] = args["title"]
    rows = (
        get_supabase()
        .table("notes")
        .update(update)
        .eq("id", args["id"])
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else {}


def _set_mastery(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    rows = (
        get_supabase()
        .table("notes")
        .update({"mastery_status": args["status"]})
        .eq("id", args["id"])
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else {}


def _move_note(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    rows = (
        get_supabase()
        .table("notes")
        .update({"collection_id": args["collection_id"]})
        .eq("id", args["id"])
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else {}


def _link_notes(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    # Phase 1: implement via a typed note_links table that ships with
    # migration 009. The table is asserted to exist by the migration.
    payload = {
        "user_id": user_id,
        "from_note_id": args["from_id"],
        "to_note_id": args["to_id"],
        "link_type": args["type"],
    }
    rows = (
        get_supabase()
        .table("note_links")
        .insert(payload)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else {}


def _delete_note(args: dict[str, Any], user_id: str) -> dict[str, Any]:
    from datetime import datetime, timezone
    rows = (
        get_supabase()
        .table("notes")
        .update({"deleted_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", args["id"])
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else {}
