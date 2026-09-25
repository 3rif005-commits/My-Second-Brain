"""Agent-loop eval cases: does the assistant actually get the job done?

The corpus scores synthesis — one prompt, one document. It has never scored the
part of the app that takes ACTIONS, which means the tool loop (E4) and
progressive disclosure (E7) shipped with unit tests and no measurement.

A case here gives the agent a small in-memory brain and a request, then judges
what it did: which tools it called, in what order, what it left behind, and
what it said. The brain is in memory on purpose — the question is whether the
loop works, not whether Supabase does, and a case that mutates real notes is a
case nobody will run twice.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import patch

from models.agent import AgentRequest, ChatMessage, Mode


@dataclass
class FakeBrain:
    """The notes the agent can see and change, and a record of what it did."""
    notes: dict[str, dict]
    calls: list[tuple[str, dict]] = field(default_factory=list)

    async def execute(self, tool: str, args: dict, user_id: str) -> dict:
        self.calls.append((tool, copy.deepcopy(args)))

        if tool == "brain.search_brain":
            query = (args.get("query") or "").lower()
            hits = [n for n in self.notes.values()
                    if query in (n["title"] + " " + n.get("content_text", "")).lower()]
            return {"matches": [{"id": n["id"], "title": n["title"],
                                 "snippet": n.get("content_text", "")[:200]}
                                for n in hits]}

        if tool == "brain.get_note":
            note = self.notes.get(args.get("id", ""))
            if not note:
                raise RuntimeError(f"note {args.get('id')} not found")
            return dict(note)

        if tool == "brain.list_notes":
            return {"notes": [{"id": n["id"], "title": n["title"]}
                              for n in self.notes.values()]}

        if tool in ("brain.update_note", "brain.patch_note"):
            note = self.notes.get(args.get("id", ""))
            if not note:
                raise RuntimeError(f"note {args.get('id')} not found")
            note["content_text"] = args.get("content_text") or args.get("text") or \
                note.get("content_text", "")
            note["updated"] = True
            return {"id": note["id"], "updated": True}

        if tool == "brain.create_note":
            new_id = f"n{len(self.notes) + 1}"
            self.notes[new_id] = {"id": new_id, "title": args.get("title", ""),
                                  "content_text": args.get("content_text", ""),
                                  "local_only": False}
            return {"id": new_id}

        if tool == "brain.delete_note":
            self.notes.pop(args.get("id", ""), None)
            return {"id": args.get("id"), "deleted": True}

        raise RuntimeError(f"tool not available in the eval brain: {tool}")

    @property
    def tools_called(self) -> list[str]:
        return [name for name, _ in self.calls]


@dataclass
class AgentOutcome:
    text: str
    tools_called: list[str]
    events: list[dict]
    brain: FakeBrain

    @property
    def rounds(self) -> int:
        """Model turns: one, plus one per batch of tool calls fed back."""
        return 1 + sum(1 for e in self.events if e["type"] == "tool_result")

    @property
    def approvals_requested(self) -> list[str]:
        return [e.get("approval_key") for e in self.events
                if e["type"] == "tool_denied" and e.get("requires_approval")]


async def run_agent_case(case: dict, provider, skill_registry,
                         stream_factory=None) -> AgentOutcome:
    """Run one agent case against an in-memory brain.

    `stream_factory` exists for tests: pass a scripted stream and no model is
    called at all. Left None, the real provider answers.
    """
    from services.agent import engine

    brain = FakeBrain(notes={n["id"]: dict(n) for n in case.get("notes", [])})
    request = AgentRequest(
        # `history`: earlier messages of the same conversation, as the panel
        # replays them (text only) — so a case can be one turn of several.
        messages=[ChatMessage(**m) for m in case.get("history", [])]
        + [ChatMessage(role="user", content=case["query"])],
        query=case["query"], mode=Mode.API,
        approvals=case.get("approvals", []),
    )

    retrieved = [{"id": n["id"], "title": n["title"],
                  "content_text": n.get("content_text", ""),
                  "deep_link": f"/brain/{n['id']}"}
                 for n in case.get("notes", []) if n.get("retrieved", True)]

    patches = [
        patch.object(engine, "execute_brain_tool", brain.execute),
        patch.object(engine, "get_provider", lambda *a, **kw: provider),
        patch.object(engine, "embed", lambda q: [0.0] * 768),
        patch.object(engine, "retrieve", lambda e, u: retrieved),
        patch.object(engine, "_get_mcp_tools_for_user",
                     _no_mcp),                      # no servers in an eval
    ]
    if stream_factory is not None:
        patches.append(patch.object(engine, "stream_agent", stream_factory))

    events: list[dict] = []
    for p in patches:
        p.start()
    try:
        async for ev in engine.run_turn(request, user_id=case.get("user_id", ""),
                                        skill_registry=skill_registry):
            events.append(ev)
    finally:
        for p in patches:
            p.stop()

    text = "".join(e["content"] for e in events if e["type"] == "text")
    return AgentOutcome(text=text, tools_called=brain.tools_called,
                        events=events, brain=brain)


async def _no_mcp(user_id: str):
    return [], []


def check_agent(case: dict, outcome: AgentOutcome) -> list[str]:
    """Every expectation that did not hold, in plain words."""
    expect = case.get("expect", {})
    failures: list[str] = []

    # A turn that errored is not a model that chose to do nothing. Without
    # this line a 400 from the API scored as "never called any tool" and the
    # real cause — a rejected tool name — sat unread in the event list.
    for e in outcome.events:
        if e.get("type") == "error":
            failures.append(f"turn errored: {str(e.get('content'))[:200]}")

    for tool in expect.get("tools_used", []):
        if tool not in outcome.tools_called:
            failures.append(f"never called {tool} (called: "
                            f"{outcome.tools_called or 'nothing'})")

    for tool in expect.get("tools_forbidden", []):
        if tool in outcome.tools_called:
            failures.append(f"called {tool}, which this case forbids")

    max_rounds = expect.get("max_rounds")
    if max_rounds is not None and outcome.rounds > max_rounds:
        failures.append(f"took {outcome.rounds} rounds, limit {max_rounds}")

    for phrase in case.get("must_mention", []):
        if phrase.lower() not in outcome.text.lower():
            failures.append(f"answer never mentions {phrase!r}")

    for phrase in case.get("must_not_mention", []):
        if phrase.lower() in outcome.text.lower():
            failures.append(f"answer contains forbidden text {phrase!r}")

    active = [e.get("name") for e in outcome.events if e.get("type") == "skill_active"]
    for skill in expect.get("skills_loaded", []):
        if skill not in active:
            failures.append(f"worked without the {skill} skill (active: "
                            f"{active or 'none'})")

    if expect.get("requires_approval"):
        if not outcome.approvals_requested:
            failures.append("expected an approval request and got none")

    for note_id, expected in (expect.get("notes_after") or {}).items():
        note = outcome.brain.notes.get(note_id)
        if expected is None:
            if note is not None:
                failures.append(f"note {note_id} should have been left alone")
            continue
        if note is None:
            failures.append(f"note {note_id} is gone")
        elif expected.get("updated") and not note.get("updated"):
            failures.append(f"note {note_id} was never updated")

    if expect.get("answers") and not outcome.text.strip():
        failures.append("the agent said nothing to the user")

    return failures
