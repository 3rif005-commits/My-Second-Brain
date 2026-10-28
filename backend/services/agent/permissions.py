"""Permission gate — enforces D6 tiers from the AI substrate spec.

Every tool call passes through check() before execution. Returns Allow,
Deny(reason), or NeedsApproval(reason, key) — the last one is serialized as a
tool_denied SSE event carrying `requires_approval`, which the client turns into
a Confirm button and replays as `AgentRequest.approvals`.

Why approval cannot be an argument: the model writes the arguments. A
`confirm=true` flag in a tool call proves only that the model emitted it, and
the model's context contains text from the user's PDFs, web pages and MCP
servers — all attacker-controllable. Approval has to arrive on a separate
channel from the one the untrusted text can reach, which is the client.
"""
from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from typing import Any

from models.agent import Tier


@dataclass(frozen=True)
class Allow:
    pass


@dataclass(frozen=True)
class Deny:
    reason: str


@dataclass(frozen=True)
class NeedsApproval:
    """Allowed in principle, but a human has to say so first."""
    reason: str
    key: str


# Irreversible from inside the app: always a human decision, whatever the
# conversation says.
_DESTRUCTIVE = {"brain.delete_note", "editor.delete_block"}

# These change data that already exists. Fine on their own — but a turn that
# has read untrusted text must not perform one unasked: that is the indirect
# prompt-injection path (private data + untrusted content + the ability to act).
# Additive tools (create_note, create_row, link_notes) stay unguarded: the worst
# an injection achieves is a new note the user can delete.
_MUTATES_EXISTING = {
    "brain.update_note", "brain.patch_note", "brain.move_note",
    "brain.set_mastery", "brain.update_row",
    "editor.replace_block", "editor.insert_block",
}


# Writes text that enters every future system prompt (services/memory.py). An
# injection that lands here outlives the conversation that planted it, and a
# private fact copied here would ride along to cloud models later.
_PERSISTS_INTO_PROMPT = {"memory.remember"}

# Sends a model-written query to an outside service (services/web_research.py).
# HACKATHON-TAVILY
_LEAVES_THE_APP = {"web.search_web"}


def approval_key(tool: str, args: dict[str, Any]) -> str:
    """Identifies one approvable action: tool + the thing it acts on.

    Scoping by target means approving one deletion does not approve the next
    one, and a replayed approval cannot be redirected to another note. A
    memory entry has no id yet: its key is its exact text, so approving one
    sentence never approves a different one the model writes on the replay.
    """
    if tool in _PERSISTS_INTO_PROMPT:
        from services.memory import approval_target
        return f"{tool}:{approval_target(str(args.get('content') or ''))}"
    target = (args.get("id") or args.get("note_id") or args.get("row_id")
              or args.get("block_id") or "*")
    return f"{tool}:{target}"


# Map each known tool to the minimum tier required. A tool can be present in
# the same tier multiple ways (e.g. denied for local_only); those checks
# happen below.
_TOOL_MIN_TIER: dict[str, Tier] = {
    # Read-only tools — all tiers
    "brain.search_brain":   Tier.EXTERNAL,
    "brain.get_note":       Tier.EXTERNAL,
    "brain.list_notes":     Tier.EXTERNAL,
    "brain.get_backlinks":  Tier.EXTERNAL,
    # Write tools — internal only
    "brain.create_note":    Tier.INTERNAL_API,
    "brain.update_note":    Tier.INTERNAL_API,
    "brain.patch_note":     Tier.INTERNAL_API,
    "brain.link_notes":     Tier.INTERNAL_API,
    "brain.set_mastery":    Tier.INTERNAL_API,
    "brain.move_note":      Tier.INTERNAL_API,
    "brain.delete_note":    Tier.INTERNAL_API,
    # Database tools (Milestone 14, task 49) — read tools are as safe as
    # brain.list_notes/get_note (scoped read-only queries through the same
    # compiler); the two writes sit at the same tier as create_note/
    # update_note above. Without an entry here every one of these 5 would
    # be denied at the gate with "unknown tool" before ever reaching
    # execute_brain_tool, regardless of any dispatch wiring below — the
    # brief's own research didn't name this file, but engine.py's call
    # sequence (permission_check before execute_brain_tool) makes it
    # load-bearing for the in-app agent path.
    "brain.list_databases":      Tier.EXTERNAL,
    "brain.get_database_schema": Tier.EXTERNAL,
    "brain.query_database":      Tier.EXTERNAL,
    "brain.create_row":          Tier.INTERNAL_API,
    "brain.update_row":          Tier.INTERNAL_API,
    # About you (services/memory.py) — the app's own data, like a note write.
    "memory.remember":           Tier.INTERNAL_API,
    # Web research (Tavily) — only the query leaves; gated below. HACKATHON-TAVILY
    "web.search_web":            Tier.INTERNAL_API,
    # Editor tools — inline and ingest surfaces only
    "editor.insert_block":          Tier.INTERNAL_API,
    "editor.replace_block":         Tier.INTERNAL_API,
    "editor.delete_block":          Tier.INTERNAL_API,
    "editor.generate_interactive":  Tier.INTERNAL_API,
}


_TIER_ORDER: dict[Tier, int] = {
    Tier.EXTERNAL: 0,
    Tier.INTERNAL_API: 1,
    Tier.INTERNAL_LOCAL: 2,
}


def _tier_at_least(actual: Tier, required: Tier) -> bool:
    return _TIER_ORDER[actual] >= _TIER_ORDER[required]


def check(
    tool: str,
    tier: Tier,
    args: dict[str, Any],
    note_meta: dict[str, Any] | None,
    *,
    untrusted_context: bool = False,
    approvals: Collection[str] = (),
    private_context: bool = False,
    mcp_ask_first: bool = False,
) -> Allow | Deny | NeedsApproval:
    """Decide whether a tool call is permitted.

    Args:
        tool: namespaced tool name, e.g. "brain.search_brain"
        tier: the caller's permission tier
        args: the tool's arguments (used for local_only and target scoping)
        note_meta: when the tool targets a note, the note's row (or None)
        untrusted_context: this turn has read content the user did not write —
            retrieved note text (ingested from PDFs, websites, transcripts) or
            an MCP server's output
        approvals: approval keys the user granted on the client for this turn
        private_context: this turn runs on the device with private notes in
            reach — anything sent to an MCP server could carry them out
        mcp_ask_first: the MCP server is set to "Ask me first" (stored as
            trust_level "read_only"; "full" = don't ask). It was saved but never
            read, so the setting looked like a safeguard and did nothing.
    """
    is_mcp = tool.startswith("mcp.")

    if is_mcp:
        if tier == Tier.EXTERNAL:
            return Deny(reason="MCP tools are not available in external tier")
    else:
        min_tier = _TOOL_MIN_TIER.get(tool)
        if min_tier is None:
            return Deny(reason=f"unknown tool: {tool}")

        if not _tier_at_least(tier, min_tier):
            return Deny(
                reason=f"tool {tool} requires {min_tier.value}, caller is {tier.value}"
            )

        # local_only enforcement (does NOT apply to INTERNAL_LOCAL)
        if tier in (Tier.EXTERNAL, Tier.INTERNAL_API):
            if note_meta and note_meta.get("local_only"):
                return Deny(
                    reason=f"note is local_only — tool {tool} cannot be invoked in {tier.value} mode"
                )

    key = approval_key(tool, args)

    if tool in _DESTRUCTIVE:
        if key in approvals:
            return Allow()
        return NeedsApproval(
            reason="Deleting is permanent — confirm it in the app first.",
            key=key,
        )

    if tool in _PERSISTS_INTO_PROMPT and (untrusted_context or private_context):
        if key in approvals:
            return Allow()
        content = " ".join(str(args.get("content") or "").split())[:300]
        return NeedsApproval(
            reason=(f'Remember "{content}" in About you? Every future chat will see it.'),
            key=key,
        )

    # Private notes stay on the device; an MCP server is off the device.
    if private_context and is_mcp:
        if key in approvals:
            return Allow()
        return NeedsApproval(
            reason=("This turn can read your private notes — confirm before "
                    "anything is sent to an outside server."),
            key=key,
        )

    # The model writes the query. After it has read notes (personal or private)
    # or untrusted text, the words it sends out are the user's call: the
    # reason shows them. One OK covers the web searches of this answer.
    # HACKATHON-TAVILY
    if tool in _LEAVES_THE_APP and (untrusted_context or private_context):
        if key in approvals:
            return Allow()
        query = " ".join(str(args.get("query") or "").split())[:200]
        return NeedsApproval(
            reason=f'Search the web for "{query}"? Only these words are sent to Tavily.',
            key=key,
        )

    if is_mcp and mcp_ask_first:
        if key in approvals:
            return Allow()
        return NeedsApproval(
            reason="This server is set to ask before each use — confirm to run it.",
            key=key,
        )

    # An MCP server is an outside party: sending it anything after reading
    # untrusted text is the exfiltration half of an injection.
    if untrusted_context and (tool in _MUTATES_EXISTING or is_mcp):
        if key in approvals:
            return Allow()
        return NeedsApproval(
            reason=("This turn read text from your sources, which the app "
                    "treats as untrusted — confirm this change first."),
            key=key,
        )

    return Allow()
