"""Pinned MCP tools: a tool reaches the model only as the user last saw it.

An MCP server can add a tool or rewrite a description at any moment, and the
model reads descriptions as instructions ("tool poisoning", the "rug pull":
trusted on Monday, changed on Tuesday). OpenShell's answer is that new access
waits for a human; here, every tool the user accepted is stored as a
fingerprint of exactly what the model is shown (name, cleaned description,
cleaned input schema), in `mcp_servers.approved_tools`.

  approved  fingerprint matches → offered to the model
  new       not pinned yet      → held until approved in Settings
  changed   pinned, different   → held until approved again

`approved_tools` NULL means nothing was ever pinned: the first successful
discovery pins what the server offers then — trust on first use, as SSH does
with a host key. The user added the server a moment ago and is the one who
chose it; what this guards against is the server changing *afterwards*.

Without migration 032 the column does not exist; the app then behaves as it
did before pinning (every tool offered) and says so in the log.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Iterable

logger = logging.getLogger(__name__)

APPROVED, NEW, CHANGED = "approved", "new", "changed"


def bare_name(namespaced: str) -> str:
    """mcp.<server>.<tool> → <tool>."""
    return namespaced.split(".", 2)[2] if namespaced.count(".") >= 2 else namespaced


def fingerprint(tool) -> str:
    """Of what the model is shown — so a change only in characters the
    cleaning removes does not ask the user to re-approve anything."""
    body = json.dumps({"name": bare_name(tool.name), "description": tool.description,
                       "input_schema": tool.input_schema},
                      sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def status_of(tool, approved: dict[str, str] | None) -> str:
    pinned = (approved or {}).get(bare_name(tool.name))
    if pinned is None:
        return NEW
    return APPROVED if pinned == fingerprint(tool) else CHANGED


def usable(tools: Iterable, approved: dict[str, str] | None) -> list:
    return [t for t in tools if status_of(t, approved) == APPROVED]


def review(tools: list, approved: dict[str, str] | None) -> dict[str, Any]:
    """What Settings shows: each tool with its status and fingerprint, and the
    pinned tools the server no longer offers."""
    offered = {bare_name(t.name) for t in tools}
    return {
        "tools": [{**t.to_llm_schema(), "status": status_of(t, approved),
                   "fingerprint": fingerprint(t)} for t in tools],
        "removed": sorted(set(approved or {}) - offered),
    }


def pins_for(tools: Iterable) -> dict[str, str]:
    return {bare_name(t.name): fingerprint(t) for t in tools}


def approve(approved: dict[str, str] | None, tools: list,
            wanted: dict[str, str]) -> tuple[dict[str, str], list[str]]:
    """Accept the tools the user approved, but only as they were shown to the
    user: `wanted` carries the fingerprints the Settings page displayed, and a
    tool that changed again between showing and clicking is not approved.
    Returns (new pins, names refused)."""
    current = pins_for(tools)
    pins = dict(approved or {})
    refused = []
    for name, seen in wanted.items():
        if current.get(name) == seen:
            pins[name] = seen
        else:
            refused.append(name)
    return pins, refused


# ── storage ─────────────────────────────────────────────────────────────────

def save(server_id: str, user_id: str, pins: dict[str, str]) -> bool:
    from services.database import get_supabase
    try:
        get_supabase().table("mcp_servers").update({"approved_tools": pins}) \
            .eq("id", server_id).eq("user_id", user_id).execute()
        return True
    except Exception as e:                                # noqa: BLE001
        logger.warning("could not store MCP tool pins for %s: %s", server_id, e)
        return False


def offered(row: dict, cfg, tools: list, user_id: str) -> list:
    """The tools of one server the model may see now, pinning on first use.
    Sets `cfg.usable` (bare names) for the dispatch check."""
    if "approved_tools" not in row:            # migration 032 not applied
        logger.warning("mcp_servers.approved_tools missing (migration 032): "
                       "MCP tools are not pinned")
        cfg.usable = None
        return tools
    approved = row.get("approved_tools")
    if approved is None and tools:
        approved = pins_for(tools)
        save(row["id"], user_id, approved)
    allowed = usable(tools, approved)
    held = len(tools) - len(allowed)
    if held:
        logger.info("MCP server %s: %d tool(s) held until approved", cfg.name, held)
    cfg.usable = {bare_name(t.name) for t in allowed}
    return allowed
