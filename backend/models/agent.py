"""Pydantic models for the agent stream wire format and tool plumbing."""
from enum import Enum
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter


class Tier(str, Enum):
    EXTERNAL = "external"
    INTERNAL_API = "internal_api"
    INTERNAL_LOCAL = "internal_local"


class Mode(str, Enum):
    # AUTO lets the switchboard decide (services/routing). API is the older
    # client's "cloud" choice and now means the same as AUTO; LOCAL pins the
    # turn to the on-device model.
    AUTO = "auto"
    LOCAL = "local"
    API = "api"


# --- Stream event types ---


class TextEvent(BaseModel):
    type: Literal["text"] = "text"
    content: str


class ToolCallEvent(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    id: str
    tool: str
    args: dict[str, Any]


class ToolResultEvent(BaseModel):
    type: Literal["tool_result"] = "tool_result"
    id: str
    summary: str
    data: dict[str, Any] | None = None


class ToolDeniedEvent(BaseModel):
    type: Literal["tool_denied"] = "tool_denied"
    id: str
    tool: str
    reason: str
    # Set when the call was refused only for want of a human decision. The
    # client renders a Confirm button and replays the turn with the key in
    # AgentRequest.approvals.
    requires_approval: bool = False
    approval_key: str | None = None


class SkillActiveEvent(BaseModel):
    type: Literal["skill_active"] = "skill_active"
    name: str


class ContextEvent(BaseModel):
    type: Literal["context"] = "context"
    notes: list[dict[str, Any]]


class DoneEvent(BaseModel):
    type: Literal["done"] = "done"
    thread_id: str
    message_id: str


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    content: str


class IngestCreatedEvent(BaseModel):
    type: Literal["ingest_created"] = "ingest_created"
    note_id: str


StreamEventType = Union[
    TextEvent,
    ToolCallEvent,
    ToolResultEvent,
    ToolDeniedEvent,
    SkillActiveEvent,
    ContextEvent,
    IngestCreatedEvent,
    DoneEvent,
    ErrorEvent,
]

StreamEvent = TypeAdapter(
    Annotated[StreamEventType, Field(discriminator="type")]
)


# --- Request models ---


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str
    # Set by the client on an answer the route event marked `private_used`:
    # it was written from private notes on the device, so a later turn that
    # runs in the cloud sends a placeholder instead of its text.
    private: bool = False


class AgentRequest(BaseModel):
    thread_id: str | None = None        # None = create new thread
    messages: list[ChatMessage]
    query: str                          # latest user message text
    mode: Mode = Mode.API
    current_note_id: str | None = None  # set when invoked from inline /ai
    surface: Literal["chat", "inline", "ingest", "interactive", "workspace"] = "chat"
    # Approval keys ("<tool>:<target id>") the user granted in the UI after a
    # previous turn asked. Never written by the model — that is the point.
    approvals: list[str] = Field(default_factory=list)
    # Routing (services/routing). `slot` is a manual pick from the composer
    # ("local", "fast", "strong", ...); None lets the switchboard decide.
    slot: str | None = None
    # Private note ids the user let through to the cloud for this request
    # only, from the privacy prompt. Like approvals: client-only, never model.
    release: list[str] = Field(default_factory=list)
    # The user chose "send without them" on the privacy prompt.
    withheld_ok: bool = False
    # Decision id of the answer this request re-runs on another slot.
    override_of: str | None = None
    # Workspace only: run this job directly (the `/name` command) — no model
    # turn, the result comes back as a card. `focus` is the rest of the line.
    job: str | None = None
    focus: str = ""
