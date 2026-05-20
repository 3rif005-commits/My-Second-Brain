"""
Second Brain MCP server — exposes your knowledge base as tools for Claude Desktop.

Setup:
  pip install mcp httpx
  Add to ~/.config/claude/claude_desktop_config.json (Linux) or
       ~/Library/Application Support/Claude/claude_desktop_config.json (Mac):

  {
    "mcpServers": {
      "second-brain": {
        "command": "python",
        "args": ["/absolute/path/to/backend/mcp_server.py"],
        "env": {
          "FASTAPI_URL": "http://localhost:8000",
          "INTERNAL_API_KEY": "your-internal-key-from-.env",
          "SECOND_BRAIN_USER_ID": "your-supabase-user-uuid"
        }
      }
    }
  }

Tools exposed:
  - search_brain(query)  — semantic search across your notes
  - get_note(note_id)    — full content of a specific note
  - list_notes()         — all notes with titles and topics
"""

import asyncio
import json
import os
import sys
import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, CallToolResult

FASTAPI_URL = os.environ.get("FASTAPI_URL", "http://localhost:8000")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "changeme-internal-key")
USER_ID = os.environ.get("SECOND_BRAIN_USER_ID", "")

if not USER_ID:
    print("ERROR: SECOND_BRAIN_USER_ID env var is not set.", file=sys.stderr)
    sys.exit(1)

server = Server("second-brain")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="search_brain",
            description=(
                "Search the user's Second Brain knowledge base for notes semantically "
                "related to a query. Returns note titles, summaries, topics, and direct URLs. "
                "Use this whenever the user asks about a topic they might have studied or saved notes on. "
                "IMPORTANT: always include the note URL from the 'Open:' field as a clickable link "
                "in your response whenever you reference or summarize a note."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "What to search for — a concept, question, or topic",
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Max notes to return (default 5)",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="get_note",
            description=(
                "Retrieve the full text content of a specific note by its ID. "
                "Use after search_brain to get more detail on a relevant note. "
                "IMPORTANT: always include the note URL from the 'Open:' field as a clickable link "
                "in your response when presenting or summarizing this note."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "note_id": {"type": "string", "description": "UUID of the note"},
                },
                "required": ["note_id"],
            },
        ),
        Tool(
            name="list_notes",
            description=(
                "List all notes in the Second Brain with their titles, topics, and mastery status. "
                "Use to give the user an overview of their knowledge base. "
                "When presenting results, format each note as a link: [title](http://localhost:3000/brain/id)."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    headers = {"x-internal-key": INTERNAL_API_KEY, "Content-Type": "application/json"}

    async with httpx.AsyncClient(base_url=FASTAPI_URL, timeout=30) as client:
        if name == "search_brain":
            query = arguments.get("query", "")
            top_k = int(arguments.get("top_k", 5))
            resp = await client.post(
                "/internal/search",
                headers=headers,
                json={"query": query, "user_id": USER_ID, "top_k": top_k},
            )
            resp.raise_for_status()
            data = resp.json()
            notes = data.get("results", [])
            if not notes:
                return [TextContent(type="text", text="No relevant notes found in Second Brain.")]
            lines = [f"Found {len(notes)} relevant note(s):\n"]
            for n in notes:
                deep_link = n.get("deep_link", "")
                full_url = f"{FRONTEND_URL}{deep_link}" if deep_link.startswith("/") else deep_link
                title = n.get("title", "Untitled")
                lines.append(
                    f"### [{title}]({full_url})\n"
                    f"- **URL:** {full_url}\n"
                    f"- **Topics:** {', '.join(n.get('topics', [])) or 'none'}\n"
                    f"- **Summary:** {n.get('summary', n.get('content_text', ''))[:300]}\n"
                )
            return [TextContent(type="text", text="\n".join(lines))]

        elif name == "get_note":
            note_id = arguments.get("note_id", "")
            resp = await client.post(
                "/internal/note",
                headers=headers,
                json={"note_id": note_id, "user_id": USER_ID},
            )
            resp.raise_for_status()
            note = resp.json()
            note_url = f"{FRONTEND_URL}/brain/{note.get('id', '')}"
            text = (
                f"# {note.get('title', 'Untitled')}\n\n"
                f"**Open:** {note_url}\n"
                f"**Topics:** {', '.join(note.get('topics', []))}\n"
                f"**Mastery:** {note.get('mastery_status', 'not_started')}\n"
                f"**Source:** {note.get('source_type', 'manual')}\n\n"
                f"{note.get('content_text', '(no text content)')}"
            )
            return [TextContent(type="text", text=text)]

        elif name == "list_notes":
            resp = await client.post(
                "/internal/notes",
                headers=headers,
                params={"user_id": USER_ID},
            )
            resp.raise_for_status()
            data = resp.json()
            notes = data.get("notes", [])
            if not notes:
                return [TextContent(type="text", text="No notes found in Second Brain.")]
            lines = [f"Second Brain — {len(notes)} note(s):\n"]
            for n in notes:
                note_url = f"{FRONTEND_URL}/brain/{n.get('id', '')}"
                lines.append(
                    f"- [{n.get('title', 'Untitled')}]({note_url}) "
                    f"| topics: {', '.join(n.get('topics', [])) or 'none'} "
                    f"| mastery: {n.get('mastery_status', 'not_started')}"
                )
            return [TextContent(type="text", text="\n".join(lines))]

        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
