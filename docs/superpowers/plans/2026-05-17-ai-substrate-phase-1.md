# AI Substrate — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AI substrate backend (Agent Engine, Skills, Brain Tools, Permissions, Model Router) and replace the existing `/brain/chat` page with a new full-page chat that streams tokens, tool-use events, and skill-activation events. Web + Android (via WebView).

**Architecture:** A `POST /agent` SSE endpoint runs an agent loop (skill activation → retrieval → system-prompt build → LLM stream → tool calls → repeat). Permission tiers (External MCP / Internal API / Internal Local) gate tool access. The model router chooses between local (LiteRT tablet via existing SmartRouter) and API (OpenRouter/Anthropic/OpenAI) based on a user-toggled mode. The frontend renders SSE events via `react-markdown` with custom fence handlers for `:::callout` and `:::interactive`, replacing the hand-rolled parser in `MessageBubble.tsx`.

**Tech Stack:** FastAPI · Python 3.11 · pytest · Pydantic v2 · httpx · Supabase (Postgres + pgvector) · Next.js 16 · React 19 · TypeScript · react-markdown 9 · remark-gfm · remark-math · rehype-katex · rehype-prism-plus · KaTeX 0.16 · Playwright

**Spec:** `docs/superpowers/specs/2026-05-17-ai-experience-redesign.md` — implements D1 (chat surface only — side panel, ⌘K, inline /ai come in Phase 2), D2 (agent + brain tools — MCP client comes in Phase 3), D3 (skills, bundled defaults + user folder), D4 (markdown + fence renderer; BlockNote xl-ai comes in Phase 2), D5, D6, D7, D8, D9 (web + Android WebView), D10 (chat-page replacement only).

**Out of Phase 1 (separate plans):**
- Phase 2: Side panel docking, ⌘K launcher, inline `/ai`, editor tools, BlockNote xl-ai integration
- Phase 3: Agentic ingest (replaces `/brain/ingest`), MCP client (external servers), Skills UI

---

## File Structure

**Backend (new):**
```
backend/
├── core/
│   └── config.py                     MODIFY — add agent settings
├── models/
│   └── agent.py                      NEW — Pydantic models for stream events, tiers
├── services/
│   └── agent/                        NEW DIRECTORY
│       ├── __init__.py               NEW
│       ├── skills.py                 NEW — file loader, frontmatter parse, classifier
│       ├── brain_tools.py            NEW — tool definitions + dispatch
│       ├── permissions.py            NEW — tier enforcement
│       ├── model.py                  NEW — Local/API router
│       └── engine.py                 NEW — the agent loop
├── routers/
│   └── agent.py                      NEW — POST /agent SSE endpoint
├── skills/                           NEW DIRECTORY (bundled defaults)
│   ├── cite-everything.md            NEW
│   ├── note-author.md                NEW
│   └── interactive-block-author.md   NEW
├── tests/                            NEW DIRECTORY
│   ├── __init__.py                   NEW
│   ├── conftest.py                   NEW
│   ├── test_skills.py                NEW
│   ├── test_permissions.py           NEW
│   ├── test_brain_tools.py           NEW
│   └── test_engine.py                NEW
├── main.py                           MODIFY — register agent router
└── requirements.txt                  MODIFY — add pytest, pytest-asyncio
```

**Backend (deleted at the end):**
```
backend/routers/chat.py               DELETE — replaced by routers/agent.py
backend/prompts/tutor.py              DELETE — replaced by skills/cite-everything.md
```

**Frontend (new):**
```
frontend/
├── lib/
│   └── markdown/
│       ├── Markdown.tsx              NEW — react-markdown wrapper
│       ├── fences.ts                 NEW — directive parser
│       └── components/
│           ├── Callout.tsx           NEW — :::callout renderer
│           ├── NoteRef.tsx           NEW — :::note-ref renderer
│           └── CodeBlock.tsx         NEW — fenced code with Prism
├── components/
│   ├── ai/                           NEW DIRECTORY
│   │   ├── Chat.tsx                  NEW — full-page chat, replaces ChatInterface
│   │   ├── MessageList.tsx           NEW — message bubbles + tool events
│   │   ├── ToolEvent.tsx             NEW — collapsible tool-call indicator
│   │   ├── SkillBadge.tsx            NEW — "🧩 Loaded skill" indicator
│   │   ├── ModeToggle.tsx            NEW — Local / API pill
│   │   └── ThreadHistory.tsx         NEW — past threads sidebar
│   ├── editor/
│   │   └── LocalOnlyBadge.tsx        NEW — toggle in NoteProperties
│   └── interactive/
│       └── InteractiveFrame.tsx      NEW — extracted from InteractiveBlockCard
├── app/
│   ├── (brain)/brain/chat/
│   │   └── page.tsx                  REWRITE — uses new Chat component
│   └── api/
│       ├── agent/
│       │   └── route.ts              NEW — SSE proxy to FastAPI /agent
│       └── threads/
│           ├── route.ts              NEW — GET (list), POST (create)
│           └── [id]/
│               └── route.ts          NEW — GET, PATCH (rename/pin), DELETE
└── package.json                      MODIFY — add markdown deps
```

**Frontend (deleted at the end):**
```
frontend/components/chat/MessageBubble.tsx          DELETE (hand-rolled parser)
frontend/components/chat/ChatInterface.tsx          DELETE (replaced by ai/Chat.tsx)
frontend/components/chat/ContextPanel.tsx           DELETE (tool events now inline)
frontend/app/api/chat/route.ts                      DELETE (replaced by api/agent)
```

**Database:**
```
supabase/migrations/009_ai_substrate.sql           NEW
```

---

## Architectural Notes

1. **Why `notes.local_only` is added now (Phase 1):** the permission gate must enforce it from day one, so it ships with the substrate. UI to toggle it is also Phase 1 (`LocalOnlyBadge`), even though the badge lives in the editor properties panel that will be more heavily used in Phase 2.

2. **Why `mcp_servers` table is created now (Phase 1):** prevents a double migration. The table exists but no UI reads/writes it until Phase 3.

3. **Why `editor.*` tools are NOT in Phase 1:** they are only invoked by inline `/ai`, which ships in Phase 2.

4. **Why MCP client is NOT in Phase 1:** the `Tool Router` interface is shaped to accept future MCP-discovered tools, but no MCP connection happens. Phase 3 plugs it in.

5. **Skill activation classifier:** Phase 1 ships a simple keyword-based classifier (regex match on skill `description`). A small-LLM classifier is a Phase 2 improvement once tool-use is proven.

6. **Streaming wire format** is fixed in this phase. All future surfaces (Phase 2 inline `/ai`, Phase 3 ingest) use the same SSE event types.

---

# Tasks

## Backend Foundation

### Task 1: Bootstrap pytest

**Files:**
- Create: `backend/tests/__init__.py` (empty)
- Create: `backend/tests/conftest.py`
- Create: `backend/pytest.ini`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add pytest deps to requirements.txt**

Append to `backend/requirements.txt`:
```
pytest>=8.0.0
pytest-asyncio>=0.23.0
pytest-mock>=3.12.0
```

- [ ] **Step 2: Create empty package init**

Create `backend/tests/__init__.py` with no content.

- [ ] **Step 3: Create pytest config**

Create `backend/pytest.ini`:
```ini
[pytest]
asyncio_mode = auto
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
pythonpath = .
```

- [ ] **Step 4: Create conftest.py with a smoke fixture**

Create `backend/tests/conftest.py`:
```python
"""Shared test fixtures."""
import pytest


@pytest.fixture
def tmp_skills_dir(tmp_path):
    """A temp directory with no skills, ready to be populated."""
    d = tmp_path / "skills"
    d.mkdir()
    return d
```

- [ ] **Step 5: Install and verify**

Run from `backend/`:
```bash
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
```
Expected: `no tests ran in <time>` — pytest discovered the empty test directory.

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/pytest.ini backend/tests/__init__.py backend/tests/conftest.py
git commit -m "test: bootstrap pytest for backend"
```

---

### Task 2: Pydantic models for the stream wire format

**Files:**
- Create: `backend/models/agent.py`
- Create: `backend/tests/test_models_agent.py`

The agent emits typed SSE events. We model them as a Pydantic discriminated union so encoding is consistent and type-checked.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_models_agent.py`:
```python
"""Tests for agent Pydantic models."""
import json
import pytest
from models.agent import (
    StreamEvent,
    TextEvent,
    ToolCallEvent,
    ToolResultEvent,
    SkillActiveEvent,
    DoneEvent,
    ErrorEvent,
    Tier,
)


def test_text_event_roundtrips():
    ev = TextEvent(content="hello")
    payload = ev.model_dump()
    assert payload == {"type": "text", "content": "hello"}


def test_tool_call_event_has_id_tool_and_args():
    ev = ToolCallEvent(id="call_1", tool="brain.search_brain", args={"query": "x"})
    assert ev.type == "tool_call"
    assert ev.model_dump()["args"] == {"query": "x"}


def test_skill_active_event_carries_name():
    ev = SkillActiveEvent(name="exam-prep-coach")
    assert ev.model_dump() == {"type": "skill_active", "name": "exam-prep-coach"}


def test_done_event_carries_ids():
    ev = DoneEvent(thread_id="t1", message_id="m1")
    assert ev.model_dump() == {"type": "done", "thread_id": "t1", "message_id": "m1"}


def test_error_event_carries_message():
    ev = ErrorEvent(content="boom")
    assert ev.model_dump() == {"type": "error", "content": "boom"}


def test_tier_enum_values():
    assert Tier.EXTERNAL.value == "external"
    assert Tier.INTERNAL_API.value == "internal_api"
    assert Tier.INTERNAL_LOCAL.value == "internal_local"


def test_stream_event_union_validates_via_type_field():
    # A raw dict with type=text should parse as TextEvent
    parsed = StreamEvent.validate_python({"type": "text", "content": "hi"})
    assert isinstance(parsed, TextEvent)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_models_agent.py -v`
Expected: ImportError — `models.agent` does not exist.

- [ ] **Step 3: Implement the models**

Create `backend/models/agent.py`:
```python
"""Pydantic models for the agent stream wire format and tool plumbing."""
from enum import Enum
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter


class Tier(str, Enum):
    EXTERNAL = "external"
    INTERNAL_API = "internal_api"
    INTERNAL_LOCAL = "internal_local"


class Mode(str, Enum):
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


StreamEventType = Union[
    TextEvent,
    ToolCallEvent,
    ToolResultEvent,
    ToolDeniedEvent,
    SkillActiveEvent,
    ContextEvent,
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


class AgentRequest(BaseModel):
    thread_id: str | None = None        # None = create new thread
    messages: list[ChatMessage]
    query: str                          # latest user message text
    mode: Mode = Mode.API
    current_note_id: str | None = None  # set when invoked from inline /ai
    surface: Literal["chat", "inline", "ingest"] = "chat"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_models_agent.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/models/agent.py backend/tests/test_models_agent.py
git commit -m "feat(agent): pydantic models for stream events and tiers"
```

---

### Task 3: Skill loader

**Files:**
- Create: `backend/services/agent/__init__.py` (empty)
- Create: `backend/services/agent/skills.py`
- Create: `backend/tests/test_skills.py`

Skills are markdown files with YAML frontmatter. The loader scans two directories (bundled + user), parses each file, and exposes a registry. The classifier picks the top-N matching skills for a given user message based on keyword overlap with each skill's `description`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_skills.py`:
```python
"""Tests for the skill loader."""
from pathlib import Path

import pytest

from services.agent.skills import (
    Skill,
    SkillRegistry,
    parse_frontmatter,
    classify_skills,
)


def test_parse_frontmatter_extracts_metadata_and_body():
    raw = """---
name: my-skill
description: Use this when X happens
tools: [search_brain, get_note]
priority: 3
---

Body text here.
Multiple lines.
"""
    skill = parse_frontmatter(raw, source_path=Path("/tmp/my-skill.md"))
    assert skill.name == "my-skill"
    assert skill.description == "Use this when X happens"
    assert skill.tools == ["search_brain", "get_note"]
    assert skill.priority == 3
    assert skill.body == "Body text here.\nMultiple lines."


def test_parse_frontmatter_defaults_when_optional_missing():
    raw = """---
name: minimal
description: bare bones
---

body
"""
    skill = parse_frontmatter(raw, source_path=Path("/tmp/minimal.md"))
    assert skill.tools is None        # None = allow all permitted by tier
    assert skill.priority == 0        # default tiebreak


def test_parse_frontmatter_rejects_missing_name():
    raw = """---
description: bare bones
---
body
"""
    with pytest.raises(ValueError, match="name"):
        parse_frontmatter(raw, source_path=Path("/tmp/x.md"))


def test_registry_loads_files_from_directory(tmp_skills_dir):
    (tmp_skills_dir / "alpha.md").write_text(
        "---\nname: alpha\ndescription: alpha skill\n---\nA"
    )
    (tmp_skills_dir / "beta.md").write_text(
        "---\nname: beta\ndescription: beta skill\n---\nB"
    )
    registry = SkillRegistry.load([tmp_skills_dir])
    assert {"alpha", "beta"} == set(registry.names())


def test_registry_user_dir_overrides_bundled(tmp_path):
    bundled = tmp_path / "bundled"
    bundled.mkdir()
    user = tmp_path / "user"
    user.mkdir()
    (bundled / "shared.md").write_text(
        "---\nname: shared\ndescription: BUNDLED\n---\nbundled body"
    )
    (user / "shared.md").write_text(
        "---\nname: shared\ndescription: USER\n---\nuser body"
    )
    registry = SkillRegistry.load([bundled, user])
    skill = registry.get("shared")
    assert skill.description == "USER"
    assert skill.body == "user body"


def test_classify_picks_skills_by_keyword_overlap():
    skills = [
        Skill(name="exam", description="quiz prep test review",
              body="", tools=None, priority=0, source_path=Path("/x")),
        Skill(name="code", description="programming algorithm code review",
              body="", tools=None, priority=0, source_path=Path("/x")),
    ]
    picked = classify_skills(query="help me prep for my quiz", skills=skills, limit=2)
    assert picked[0].name == "exam"


def test_classify_respects_priority_on_tie():
    skills = [
        Skill(name="a", description="hello", body="", tools=None,
              priority=1, source_path=Path("/x")),
        Skill(name="b", description="hello", body="", tools=None,
              priority=9, source_path=Path("/x")),
    ]
    picked = classify_skills(query="hello", skills=skills, limit=1)
    assert picked[0].name == "b"


def test_classify_returns_empty_when_no_match():
    skills = [
        Skill(name="x", description="completely different topic",
              body="", tools=None, priority=0, source_path=Path("/x")),
    ]
    picked = classify_skills(query="nothing in common at all here",
                             skills=skills, limit=3)
    assert picked == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_skills.py -v`
Expected: ImportError — `services.agent.skills` not found.

- [ ] **Step 3: Implement Skill model and parser**

Create `backend/services/agent/__init__.py` (empty file).

Create `backend/services/agent/skills.py`:
```python
"""Skill loader — reads .md files with YAML frontmatter from bundled + user dirs.

A skill = name + description + optional tools whitelist + body (the instructions).
Activation = keyword-overlap classifier picks top-N matching skills per turn.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    body: str
    tools: list[str] | None       # None = allow all permitted by tier
    priority: int                 # tiebreak; higher wins
    source_path: Path


_FRONTMATTER_RE = re.compile(
    r"^---\s*\n(?P<yaml>.*?)\n---\s*\n(?P<body>.*)$",
    re.DOTALL,
)


def parse_frontmatter(raw: str, source_path: Path) -> Skill:
    match = _FRONTMATTER_RE.match(raw)
    if not match:
        raise ValueError(f"{source_path}: missing frontmatter delimiters")
    meta = yaml.safe_load(match.group("yaml")) or {}
    body = match.group("body").strip()
    if not meta.get("name"):
        raise ValueError(f"{source_path}: 'name' is required in frontmatter")
    if not meta.get("description"):
        raise ValueError(f"{source_path}: 'description' is required")
    return Skill(
        name=meta["name"],
        description=meta["description"],
        body=body,
        tools=meta.get("tools"),
        priority=int(meta.get("priority", 0)),
        source_path=source_path,
    )


class SkillRegistry:
    def __init__(self, skills: dict[str, Skill]):
        self._skills = skills

    @classmethod
    def load(cls, dirs: list[Path]) -> "SkillRegistry":
        """Load skills from each dir in order. Later dirs override earlier
        (so user dir wins over bundled)."""
        skills: dict[str, Skill] = {}
        for d in dirs:
            if not d.exists():
                continue
            for path in sorted(d.glob("*.md")):
                raw = path.read_text(encoding="utf-8")
                skill = parse_frontmatter(raw, path)
                skills[skill.name] = skill
        return cls(skills)

    def names(self) -> list[str]:
        return list(self._skills.keys())

    def get(self, name: str) -> Skill:
        return self._skills[name]

    def all(self) -> list[Skill]:
        return list(self._skills.values())


_WORD_RE = re.compile(r"[a-zA-Z0-9]+")


def _tokenize(s: str) -> set[str]:
    return {w.lower() for w in _WORD_RE.findall(s)}


def classify_skills(
    query: str,
    skills: list[Skill],
    limit: int = 3,
) -> list[Skill]:
    """Pick top-N skills whose description shares keywords with the query.

    Phase 1: simple keyword overlap. Future: small-LLM classifier.
    Skills with zero overlap are excluded entirely.
    """
    query_tokens = _tokenize(query)
    scored: list[tuple[int, int, Skill]] = []
    for skill in skills:
        desc_tokens = _tokenize(skill.description)
        overlap = len(query_tokens & desc_tokens)
        if overlap == 0:
            continue
        scored.append((overlap, skill.priority, skill))
    # Sort: higher overlap first, then higher priority
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [s for (_, _, s) in scored[:limit]]
```

- [ ] **Step 4: Add PyYAML if missing**

Check `backend/requirements.txt`. If `PyYAML` is not present, append:
```
PyYAML>=6.0.0
```

- [ ] **Step 5: Run tests**

Run from `backend/`:
```bash
pip install -r requirements.txt
pytest tests/test_skills.py -v
```
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/services/agent/__init__.py backend/services/agent/skills.py \
        backend/tests/test_skills.py backend/requirements.txt
git commit -m "feat(agent): skill loader with frontmatter parsing and classifier"
```

---

### Task 4: Permission gate

**Files:**
- Create: `backend/services/agent/permissions.py`
- Create: `backend/tests/test_permissions.py`

The gate is called before every tool execution. It returns `Allow` or `Deny(reason)` based on tier + tool + args + (when needed) note metadata.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_permissions.py`:
```python
"""Permission gate tests — see spec §3.7 and §3.5 (tool matrix)."""
import pytest

from models.agent import Tier
from services.agent.permissions import (
    Allow,
    Deny,
    check,
)


def _is_allowed(decision):
    return isinstance(decision, Allow)


def test_external_can_read():
    assert _is_allowed(check("brain.search_brain", Tier.EXTERNAL,
                             args={"query": "x"}, note_meta=None))


def test_external_cannot_write():
    decision = check("brain.create_note", Tier.EXTERNAL,
                     args={"title": "t", "blocks": []}, note_meta=None)
    assert isinstance(decision, Deny)
    assert "external" in decision.reason.lower()


def test_external_get_note_denied_for_local_only():
    decision = check("brain.get_note", Tier.EXTERNAL,
                     args={"id": "n1"}, note_meta={"local_only": True})
    assert isinstance(decision, Deny)
    assert "local_only" in decision.reason


def test_external_get_note_allowed_for_normal():
    assert _is_allowed(check("brain.get_note", Tier.EXTERNAL,
                             args={"id": "n1"},
                             note_meta={"local_only": False}))


def test_internal_api_get_note_denied_for_local_only():
    decision = check("brain.get_note", Tier.INTERNAL_API,
                     args={"id": "n1"}, note_meta={"local_only": True})
    assert isinstance(decision, Deny)


def test_internal_api_update_denied_for_local_only():
    decision = check("brain.update_note", Tier.INTERNAL_API,
                     args={"id": "n1", "blocks": []},
                     note_meta={"local_only": True})
    assert isinstance(decision, Deny)


def test_internal_api_can_create_note():
    assert _is_allowed(check("brain.create_note", Tier.INTERNAL_API,
                             args={"title": "t", "blocks": []},
                             note_meta=None))


def test_internal_local_allows_everything_on_local_only_notes():
    assert _is_allowed(check("brain.get_note", Tier.INTERNAL_LOCAL,
                             args={"id": "n1"},
                             note_meta={"local_only": True}))
    assert _is_allowed(check("brain.update_note", Tier.INTERNAL_LOCAL,
                             args={"id": "n1", "blocks": []},
                             note_meta={"local_only": True}))


def test_delete_requires_confirm_flag_in_args():
    decision = check("brain.delete_note", Tier.INTERNAL_API,
                     args={"id": "n1"}, note_meta=None)
    assert isinstance(decision, Deny)
    assert "confirm" in decision.reason.lower()
    # With confirm flag set, allowed
    assert _is_allowed(check("brain.delete_note", Tier.INTERNAL_API,
                             args={"id": "n1", "confirm": True},
                             note_meta=None))


def test_unknown_tool_denied_by_default():
    decision = check("brain.unknown_tool", Tier.INTERNAL_LOCAL,
                     args={}, note_meta=None)
    assert isinstance(decision, Deny)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_permissions.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement the gate**

Create `backend/services/agent/permissions.py`:
```python
"""Permission gate — enforces D6 tiers from the AI substrate spec.

Every tool call passes through check() before execution. Returns Allow or
Deny(reason). Deny is serialized as a tool_denied SSE event.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from models.agent import Tier


@dataclass(frozen=True)
class Allow:
    pass


@dataclass(frozen=True)
class Deny:
    reason: str


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
) -> Allow | Deny:
    """Decide whether a tool call is permitted.

    Args:
        tool: namespaced tool name, e.g. "brain.search_brain"
        tier: the caller's permission tier
        args: the tool's arguments (used for local_only and confirm checks)
        note_meta: when the tool targets a note, the note's row (or None)
    """
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

    # Destructive ops require explicit confirm flag
    if tool == "brain.delete_note":
        if not args.get("confirm"):
            return Deny(
                reason="brain.delete_note requires confirm=true argument"
            )

    return Allow()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_permissions.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/agent/permissions.py backend/tests/test_permissions.py
git commit -m "feat(agent): permission gate enforcing tier and local_only"
```

---

### Task 5: Brain tools — read tools first

**Files:**
- Create: `backend/services/agent/brain_tools.py`
- Create: `backend/tests/test_brain_tools.py`

The brain tool layer wraps existing services (`retriever`, `database`) behind a uniform interface and exposes JSON schemas for LLM tool-use. Phase 1 implements the four read tools (`search_brain`, `get_note`, `list_notes`, `get_backlinks`). Write tools land in **Task 6**.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_brain_tools.py`:
```python
"""Tests for brain tool dispatch — read tools."""
from unittest.mock import MagicMock, patch

import pytest

from services.agent.brain_tools import (
    BRAIN_TOOL_SCHEMAS,
    execute_brain_tool,
)


def test_schemas_include_read_tools():
    names = {s["name"] for s in BRAIN_TOOL_SCHEMAS}
    assert {"brain.search_brain", "brain.get_note",
            "brain.list_notes", "brain.get_backlinks"} <= names


def test_search_brain_schema_has_query_param():
    schema = next(s for s in BRAIN_TOOL_SCHEMAS
                  if s["name"] == "brain.search_brain")
    assert "query" in schema["input_schema"]["properties"]
    assert schema["input_schema"]["required"] == ["query"]


@patch("services.agent.brain_tools.embed")
@patch("services.agent.brain_tools.retrieve")
def test_search_brain_runs_retrieve(mock_retrieve, mock_embed):
    mock_embed.return_value = [0.1, 0.2, 0.3]
    mock_retrieve.return_value = [
        {"id": "n1", "title": "Note 1", "content_text": "x",
         "deep_link": "/brain/n1", "similarity": 0.9}
    ]
    result = execute_brain_tool(
        "brain.search_brain", args={"query": "chain rule"},
        user_id="u1"
    )
    assert result["matches"][0]["id"] == "n1"
    mock_embed.assert_called_once_with("chain rule")
    mock_retrieve.assert_called_once()


@patch("services.agent.brain_tools.get_supabase")
def test_get_note_returns_row(mock_supa):
    mock_table = MagicMock()
    mock_supa.return_value.table.return_value = mock_table
    mock_table.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "id": "n1", "title": "T", "content": [], "local_only": False,
    }
    result = execute_brain_tool("brain.get_note", args={"id": "n1"},
                                user_id="u1")
    assert result["id"] == "n1"
    assert result["local_only"] is False


def test_unknown_tool_raises():
    with pytest.raises(ValueError):
        execute_brain_tool("brain.nope", args={}, user_id="u1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_brain_tools.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement read tools**

Create `backend/services/agent/brain_tools.py`:
```python
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
```

- [ ] **Step 4: Run tests**

Run: `cd backend && pytest tests/test_brain_tools.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/agent/brain_tools.py backend/tests/test_brain_tools.py
git commit -m "feat(agent): brain read tools (search, get, list, backlinks)"
```

---

### Task 6: Brain write tools

**Files:**
- Modify: `backend/services/agent/brain_tools.py`
- Modify: `backend/tests/test_brain_tools.py`

- [ ] **Step 1: Extend the test file**

Append to `backend/tests/test_brain_tools.py`:
```python
@patch("services.agent.brain_tools.get_supabase")
def test_create_note_inserts_row(mock_supa):
    mock_table = MagicMock()
    mock_supa.return_value.table.return_value = mock_table
    mock_table.insert.return_value.execute.return_value.data = [
        {"id": "new_id", "title": "T"}
    ]
    result = execute_brain_tool(
        "brain.create_note",
        args={"title": "T", "blocks": []},
        user_id="u1",
    )
    assert result["id"] == "new_id"
    mock_table.insert.assert_called_once()
    inserted_payload = mock_table.insert.call_args[0][0]
    assert inserted_payload["user_id"] == "u1"
    assert inserted_payload["title"] == "T"


@patch("services.agent.brain_tools.get_supabase")
def test_update_note_uses_patch_semantics(mock_supa):
    mock_table = MagicMock()
    mock_supa.return_value.table.return_value = mock_table
    mock_table.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": "n1"}
    ]
    execute_brain_tool(
        "brain.update_note",
        args={"id": "n1", "blocks": [{"type": "paragraph"}]},
        user_id="u1",
    )
    mock_table.update.assert_called_once()


@patch("services.agent.brain_tools.get_supabase")
def test_set_mastery_updates_status(mock_supa):
    mock_table = MagicMock()
    mock_supa.return_value.table.return_value = mock_table
    mock_table.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": "n1"}
    ]
    execute_brain_tool(
        "brain.set_mastery",
        args={"id": "n1", "status": "mastered"},
        user_id="u1",
    )
    update_call = mock_table.update.call_args[0][0]
    assert update_call["mastery_status"] == "mastered"


@patch("services.agent.brain_tools.get_supabase")
def test_delete_note_soft_deletes(mock_supa):
    mock_table = MagicMock()
    mock_supa.return_value.table.return_value = mock_table
    mock_table.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": "n1"}
    ]
    result = execute_brain_tool(
        "brain.delete_note",
        args={"id": "n1", "confirm": True},
        user_id="u1",
    )
    assert result["id"] == "n1"
    # delete_note should soft-delete by setting deleted_at, not hard-delete
    update_call = mock_table.update.call_args[0][0]
    assert "deleted_at" in update_call
```

- [ ] **Step 2: Run failing tests**

Run: `cd backend && pytest tests/test_brain_tools.py -v`
Expected: 4 new failures for tools not yet implemented.

- [ ] **Step 3: Add write tool schemas**

Append to `BRAIN_TOOL_SCHEMAS` in `backend/services/agent/brain_tools.py` (inside the list, before its closing bracket):
```python
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
```

- [ ] **Step 4: Extend the dispatcher**

In `execute_brain_tool`, add branches for new tools before the final `raise ValueError`:
```python
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
```

Append the implementations at the bottom of the file:
```python
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
```

- [ ] **Step 5: Run tests**

Run: `cd backend && pytest tests/test_brain_tools.py -v`
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/services/agent/brain_tools.py backend/tests/test_brain_tools.py
git commit -m "feat(agent): brain write tools (create/update/set_mastery/move/link/delete)"
```

---

### Task 7: Model router (Local / API)

**Files:**
- Create: `backend/services/agent/model.py`
- Create: `backend/tests/test_model_router.py`
- Modify: `backend/core/config.py` — add Mode fields

The router exposes `get_endpoint(mode, task)` → returns the URL, headers, model name, and source label. For `mode="local"` it reuses the existing `services.router.smart_router.get_endpoint()` (tablet preferred, llama.cpp fallback). For `mode="api"` it returns the cloud provider configured in env.

- [ ] **Step 1: Add config fields**

Read `backend/core/config.py` first to see existing structure, then add to the Settings class:
```python
    # AI substrate — Phase 1
    api_provider: str = "openrouter"        # "openrouter" | "anthropic" | "openai"
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    default_mode: str = "api"               # default model mode for new threads

    api_model_openrouter: str = "nvidia/nemotron-3-super-120b-a12b:free"
    api_model_anthropic: str = "claude-sonnet-4-6"
    api_model_openai: str = "gpt-4o-mini"
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_model_router.py`:
```python
"""Tests for the model router."""
from unittest.mock import patch

import pytest

from models.agent import Mode
from services.agent.model import get_endpoint


@patch("services.agent.model.smart_router")
def test_local_uses_smart_router(mock_smart):
    mock_smart.get_endpoint.return_value = {
        "url": "http://tablet:8082/v1/chat/completions",
        "headers": {"Content-Type": "application/json"},
        "model": "gemma-4-e2b",
        "source": "tablet",
    }
    ep = get_endpoint(Mode.LOCAL, task="chat")
    assert ep["source"] == "tablet"
    assert "tablet" in ep["url"]


@patch("services.agent.model.settings")
def test_api_openrouter(mock_settings):
    mock_settings.api_provider = "openrouter"
    mock_settings.openrouter_api_key = "or-key"
    mock_settings.api_model_openrouter = "nvidia/nemotron-3-super-120b-a12b:free"
    ep = get_endpoint(Mode.API, task="chat")
    assert ep["source"] == "openrouter"
    assert ep["headers"]["Authorization"] == "Bearer or-key"
    assert ep["url"].endswith("/chat/completions")
    assert ep["model"] == "nvidia/nemotron-3-super-120b-a12b:free"


@patch("services.agent.model.settings")
def test_api_anthropic(mock_settings):
    mock_settings.api_provider = "anthropic"
    mock_settings.anthropic_api_key = "ant-key"
    mock_settings.api_model_anthropic = "claude-sonnet-4-6"
    ep = get_endpoint(Mode.API, task="chat")
    assert ep["source"] == "anthropic"
    assert ep["headers"]["x-api-key"] == "ant-key"
    assert ep["headers"]["anthropic-version"] == "2023-06-01"


@patch("services.agent.model.settings")
def test_api_missing_key_raises(mock_settings):
    mock_settings.api_provider = "openrouter"
    mock_settings.openrouter_api_key = None
    with pytest.raises(RuntimeError, match="API key"):
        get_endpoint(Mode.API, task="chat")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && pytest tests/test_model_router.py -v`
Expected: ImportError.

- [ ] **Step 4: Implement the router**

Create `backend/services/agent/model.py`:
```python
"""Model router — two modes (Local / API). User toggles which is active.

Local mode reuses the existing SmartRouter (tablet primary, llama.cpp fallback).
API mode picks the user's configured cloud provider.
"""
from __future__ import annotations

from typing import Any, Literal

from core.config import settings
from models.agent import Mode
from services.router import smart_router


def get_endpoint(mode: Mode, task: Literal["chat", "classify"] = "chat") -> dict[str, Any]:
    """Return endpoint config: {url, headers, model, source}.

    Raises RuntimeError if the chosen mode is unusable (missing API key,
    no local backend reachable).
    """
    if mode == Mode.LOCAL:
        return smart_router.get_endpoint()

    # API mode
    provider = settings.api_provider
    if provider == "openrouter":
        if not settings.openrouter_api_key:
            raise RuntimeError("OpenRouter API key not configured")
        return {
            "url": "https://openrouter.ai/api/v1/chat/completions",
            "headers": {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.openrouter_api_key}",
            },
            "model": settings.api_model_openrouter,
            "source": "openrouter",
        }
    if provider == "anthropic":
        if not settings.anthropic_api_key:
            raise RuntimeError("Anthropic API key not configured")
        return {
            "url": "https://api.anthropic.com/v1/messages",
            "headers": {
                "Content-Type": "application/json",
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
            },
            "model": settings.api_model_anthropic,
            "source": "anthropic",
        }
    if provider == "openai":
        if not settings.openai_api_key:
            raise RuntimeError("OpenAI API key not configured")
        return {
            "url": "https://api.openai.com/v1/chat/completions",
            "headers": {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.openai_api_key}",
            },
            "model": settings.api_model_openai,
            "source": "openai",
        }
    raise RuntimeError(f"Unknown api_provider: {provider}")
```

- [ ] **Step 5: Run test**

Run: `cd backend && pytest tests/test_model_router.py -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/services/agent/model.py backend/tests/test_model_router.py backend/core/config.py
git commit -m "feat(agent): model router for Local/API modes"
```

---

### Task 8: Database migration 009 — local_only, chat_threads, mcp_servers, note_links

**Files:**
- Create: `supabase/migrations/009_ai_substrate.sql`

This migration is verified by **direct application** to a development Supabase project, not by pytest. Tests below verify the migration *runs* and that downstream code matches the schema.

- [ ] **Step 1: Write the SQL**

Create `supabase/migrations/009_ai_substrate.sql`:
```sql
-- Migration 009: AI substrate
-- Adds:
--   - notes.local_only         (D6 permission flag)
--   - notes.deleted_at         (soft delete; used by brain.delete_note)
--   - chat_sessions → chat_threads (renamed + title, pinned, model_mode, archived_at)
--   - mcp_servers              (registry for Phase 3, created now to avoid double migration)
--   - note_links               (typed links — used by brain.link_notes)

BEGIN;

-- ---- notes: local_only + soft delete ----

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS local_only BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS notes_local_only_idx
  ON notes(local_only) WHERE local_only = TRUE;

CREATE INDEX IF NOT EXISTS notes_deleted_at_idx
  ON notes(deleted_at) WHERE deleted_at IS NULL;


-- ---- chat_sessions → chat_threads ----

ALTER TABLE chat_sessions RENAME TO chat_threads;

ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS title         TEXT,
  ADD COLUMN IF NOT EXISTS pinned        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS model_mode    TEXT,
  ADD COLUMN IF NOT EXISTS archived_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS chat_threads_user_updated_idx
  ON chat_threads(user_id, updated_at DESC);


-- ---- mcp_servers (Phase 3 prep) ----

CREATE TABLE IF NOT EXISTS mcp_servers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  transport   TEXT        NOT NULL CHECK (transport IN ('stdio','http','sse')),
  command     TEXT,
  url         TEXT,
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  trust_level TEXT        NOT NULL DEFAULT 'read_only'
              CHECK (trust_level IN ('read_only','full')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mcp_servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY mcp_servers_owner_all ON mcp_servers
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ---- note_links (typed links between notes) ----

CREATE TABLE IF NOT EXISTS note_links (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  from_note_id  UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  to_note_id    UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  link_type     TEXT        NOT NULL CHECK (link_type IN ('prereq','related','backlink')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_note_id, to_note_id, link_type)
);

CREATE INDEX IF NOT EXISTS note_links_from_idx ON note_links(from_note_id);
CREATE INDEX IF NOT EXISTS note_links_to_idx   ON note_links(to_note_id);

ALTER TABLE note_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_links_owner_all ON note_links
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMIT;
```

- [ ] **Step 2: Apply the migration to your Supabase project**

Open the Supabase SQL editor (https://supabase.com/dashboard → your project → SQL Editor). Paste the migration content and run it. Verify success in the result panel.

If you use the Supabase CLI:
```bash
supabase db push
```

- [ ] **Step 3: Sanity-check the schema**

In the Supabase SQL editor, run:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'chat_threads' ORDER BY ordinal_position;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'notes' AND column_name IN ('local_only','deleted_at');

SELECT to_regclass('public.mcp_servers'), to_regclass('public.note_links');
```
Expected: `chat_threads` has `title`, `pinned`, `model_mode`, `archived_at`. `notes` has both new columns. Both new tables exist.

- [ ] **Step 4: Update existing retriever to exclude soft-deleted notes**

Read `backend/services/retriever.py` and locate the SQL functions called (`match_chunks`, `match_notes`). If those RPCs filter by `deleted_at IS NULL`, no change needed; otherwise update the RPC definition in a follow-up migration (defer — out of Phase 1 scope unless retriever returns deleted rows; verify by querying after deleting a test note).

Locally, in `backend/services/retriever.py`, add a final filter step after RPC returns:
```python
    rows = [r for r in rows if r.get("deleted_at") is None]
```
(insert after the `chunk_result.data or []` line)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/009_ai_substrate.sql backend/services/retriever.py
git commit -m "feat(db): migration 009 — local_only, chat_threads, mcp_servers, note_links"
```

---

### Task 9: Bundled skills — write the three markdown files

**Files:**
- Create: `backend/skills/cite-everything.md`
- Create: `backend/skills/note-author.md`
- Create: `backend/skills/interactive-block-author.md`

These bundled skills ship with the app. They are loaded at startup by the `SkillRegistry`.

- [ ] **Step 1: Create cite-everything.md**

Create `backend/skills/cite-everything.md`:
```markdown
---
name: cite-everything
description: Use whenever the answer draws on the user's notes. Forces inline citations as markdown links to deep_link URLs. Never invent note IDs.
priority: 5
---

When you reference information that came from a retrieved note, link to it
inline using the note's title and its `deep_link`:

  Markdown: `[Note Title](/brain/<uuid>)`

Rules:
- Cite at least one note per factual claim that came from retrieval.
- Maximum one citation per sentence — don't pile up links.
- Only use note IDs that appear in `<knowledge_context>`. If you need to
  reference something that wasn't retrieved, say so explicitly: "I don't
  have a note on this — explaining from first principles."
- When citing, prefer the user's own phrasing from the note over rewording.
- Group multiple supporting notes at the end of a paragraph if needed:
  "(see [Note A](/brain/a), [Note B](/brain/b))".

Never:
- Invent a UUID.
- Cite the same note twice in the same paragraph.
- Hide that an answer is unsupported by their notes — say so.
```

- [ ] **Step 2: Create note-author.md**

Create `backend/skills/note-author.md`:
```markdown
---
name: note-author
description: Use when writing structured note content — mastery guides, study notes, lecture-style summaries. Formats output for the BlockNote editor.
priority: 4
---

When you write content destined for a note (via `brain.create_note` or
`brain.update_note`), structure it for the block editor.

Two-layer pattern for every section:
- **Overview callout** (blue, 📋) — scannable in 2 minutes: What / How / Why / Takeaway.
- **Deep-dive toggles** (collapsible) — full explanation broken into sub-concepts.

Mark heading importance with `data-importance` on H2:
- 6 (red) — exam-critical
- 5 (orange) — central concept
- 4 (yellow) — must understand
- 3 (green) — part of the lesson
- 2 (blue) — context
- 1 (purple) — background only

Callout colors:
- red 🛑 — must-know / common failure
- orange ⚠️ — important distinction
- purple 💡 — non-obvious insight
- green ✅ — clarification
- yellow 📌 — key formula / rule
- blue 📋 — overview (default)
- gray ℹ️ — historical context

Use blocks the editor renders well: callouts, toggles (`<details>`), tables,
code blocks, blockquotes for definitions. Avoid long prose paragraphs.

Each toggle = one concept. 2–3 sentences of prose, supported by quotes,
callouts, tables, or code.

Never:
- Reorganize the source's section order.
- Use bullets for single items.
- Decorate with color; every color must answer "what kind of content?".
```

- [ ] **Step 3: Create interactive-block-author.md**

Create `backend/skills/interactive-block-author.md`:
```markdown
---
name: interactive-block-author
description: Use when generating an interactive HTML/JS block — simulation, quiz, chart, calculator, timeline. Constrained to vanilla JS in a sandboxed iframe.
priority: 4
---

When asked to generate an interactive block, output a single self-contained
HTML snippet that runs inside `<iframe sandbox="allow-scripts">` with no
network access.

Hard constraints:
- **No external URLs.** No CDN imports, no `fetch`, no `<script src=...>`.
- All CSS inline in `<style>` tags. All JS inline in `<script>` tags.
- Vanilla JavaScript only. Canvas API for graphics is fine.
- Target height ~300px. Compact layout.
- Use `system-ui, sans-serif` for typography. Clean colors, rounded corners.
- Must be interactive — not just static HTML. Add at least one input,
  button, or drag handle that does something visible.

Good examples by domain:
- Algorithms → animated comparison (bubble vs merge sort)
- Physics → live simulator with sliders (orbit, pendulum)
- Math → function plotter with adjustable parameters
- Quizzes → multiple-choice with instant feedback (see template below)
- Charts → Canvas-drawn bar/line chart with hover

Quiz template:
```html
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;padding:16px;background:#f8fafc}
.q{font-weight:600;font-size:15px;margin-bottom:14px;color:#1e293b}
.opts button{display:block;width:100%;text-align:left;padding:9px 13px;margin:5px 0;
  background:#fff;border:1.5px solid #e2e8f0;border-radius:8px;cursor:pointer;
  font-size:14px;transition:.15s}
.opts button:hover{border-color:#6366f1;background:#eef2ff}
.opts button.correct{background:#d1fae5;border-color:#10b981;color:#065f46;font-weight:600}
.opts button.wrong{background:#fee2e2;border-color:#ef4444;color:#7f1d1d}
#msg{margin-top:10px;font-size:13px;font-weight:500}
</style>
<div class="q">[Question]</div>
<div class="opts">
  <button onclick="check(this,true)">[Correct]</button>
  <button onclick="check(this,false)">[Plausible wrong]</button>
  <button onclick="check(this,false)">[Plausible wrong]</button>
</div>
<div id="msg"></div>
<script>
var done=false;
function check(btn,ok){
  if(done)return;done=true;
  btn.className=ok?'correct':'wrong';
  var m=document.getElementById('msg');
  m.textContent=ok?'✅ Correct!':'❌ Review the concept above.';
  m.style.color=ok?'#065f46':'#991b1b';
}
</script>
```

Never:
- Reference external resources.
- Output more than one block per request.
- Generate purely decorative content with no interaction.
```

- [ ] **Step 4: Verify skills load**

Run from `backend/`:
```bash
python -c "
from pathlib import Path
from services.agent.skills import SkillRegistry
reg = SkillRegistry.load([Path('backend/skills')])
for s in reg.all():
    print(f'{s.name}: {s.description[:60]}')
"
```
Expected output:
```
cite-everything: Use whenever the answer draws on the user's notes...
interactive-block-author: Use when generating an interactive HTML/JS block...
note-author: Use when writing structured note content — mastery guides...
```

- [ ] **Step 5: Commit**

```bash
git add backend/skills/cite-everything.md backend/skills/note-author.md backend/skills/interactive-block-author.md
git commit -m "feat(agent): bundled skills — cite-everything, note-author, interactive-block-author"
```

---

### Task 10: Agent Engine — core loop (OpenRouter / OpenAI-shaped backends)

**Files:**
- Create: `backend/services/agent/engine.py`
- Create: `backend/tests/test_engine.py`

The engine emits SSE events as an async iterator. Phase 1 supports OpenAI-compatible chat-completions APIs (OpenRouter, OpenAI, llama.cpp, LiteRT). Anthropic's `/messages` format support is **deferred to a follow-up** within this task's last step.

- [ ] **Step 1: Write failing tests covering the loop**

Create `backend/tests/test_engine.py`:
```python
"""Tests for the Agent Engine — covers skill activation, system-prompt build,
tool call handling, and SSE event sequence.

The LLM HTTP call is mocked at the httpx.AsyncClient.stream level.
"""
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from models.agent import AgentRequest, ChatMessage, Mode, Tier
from services.agent.engine import run_turn
from services.agent.skills import SkillRegistry, Skill


def _make_registry() -> SkillRegistry:
    skills = {
        "cite-everything": Skill(
            name="cite-everything",
            description="Use whenever the answer draws on the user's notes",
            body="Cite notes with markdown links.",
            tools=None, priority=5, source_path=Path("/x"),
        ),
    }
    return SkillRegistry(skills)


class _FakeStreamResp:
    def __init__(self, lines):
        self.status_code = 200
        self._lines = lines

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def aread(self):
        return b""


class _FakeStreamCM:
    def __init__(self, resp):
        self._resp = resp

    async def __aenter__(self):
        return self._resp

    async def __aexit__(self, *args):
        return None


class _FakeClient:
    def __init__(self, resp):
        self._resp = resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    def stream(self, *args, **kwargs):
        return _FakeStreamCM(self._resp)


def _openai_chunks(content_pieces, tool_calls=None):
    """Build SSE-shaped data: lines that mimic OpenAI streaming format."""
    out = []
    for piece in content_pieces:
        out.append(
            "data: " + json.dumps({
                "choices": [{"delta": {"content": piece}}]
            })
        )
    if tool_calls:
        for tc in tool_calls:
            out.append("data: " + json.dumps({
                "choices": [{"delta": {"tool_calls": [tc]}}]
            }))
    out.append("data: [DONE]")
    return out


@pytest.mark.asyncio
@patch("services.agent.engine.execute_brain_tool")
@patch("services.agent.engine.retrieve")
@patch("services.agent.engine.embed")
@patch("services.agent.engine.get_endpoint")
@patch("services.agent.engine.httpx.AsyncClient")
async def test_engine_streams_text_event(
    mock_client_cls, mock_endpoint, mock_embed, mock_retrieve, mock_exec,
):
    mock_endpoint.return_value = {
        "url": "http://x/chat/completions",
        "headers": {},
        "model": "fake",
        "source": "openrouter",
    }
    mock_embed.return_value = [0.1] * 768
    mock_retrieve.return_value = []
    chunks = _openai_chunks(["Hello", " world"])
    mock_client_cls.return_value = _FakeClient(_FakeStreamResp(chunks))

    req = AgentRequest(
        messages=[ChatMessage(role="user", content="hi")],
        query="hi",
        mode=Mode.API,
    )
    events = [e async for e in run_turn(req, user_id="u1",
                                        skill_registry=_make_registry())]
    text_events = [e for e in events if e["type"] == "text"]
    assert "".join(e["content"] for e in text_events) == "Hello world"
    # done event must come last and carry IDs
    assert events[-1]["type"] == "done"


@pytest.mark.asyncio
@patch("services.agent.engine.execute_brain_tool")
@patch("services.agent.engine.retrieve")
@patch("services.agent.engine.embed")
@patch("services.agent.engine.get_endpoint")
@patch("services.agent.engine.httpx.AsyncClient")
async def test_engine_activates_matching_skill(
    mock_client_cls, mock_endpoint, mock_embed, mock_retrieve, mock_exec,
):
    mock_endpoint.return_value = {"url": "u", "headers": {}, "model": "m",
                                  "source": "openrouter"}
    mock_embed.return_value = [0.0] * 768
    mock_retrieve.return_value = []
    chunks = _openai_chunks(["ok"])
    mock_client_cls.return_value = _FakeClient(_FakeStreamResp(chunks))

    req = AgentRequest(
        messages=[ChatMessage(role="user", content="cite from my notes")],
        query="cite from my notes",
        mode=Mode.API,
    )
    events = [e async for e in run_turn(req, user_id="u1",
                                        skill_registry=_make_registry())]
    # cite-everything has 'cite' and 'notes' in description; query has both
    skill_events = [e for e in events if e["type"] == "skill_active"]
    assert any(e["name"] == "cite-everything" for e in skill_events)


@pytest.mark.asyncio
@patch("services.agent.engine.execute_brain_tool")
@patch("services.agent.engine.retrieve")
@patch("services.agent.engine.embed")
@patch("services.agent.engine.get_endpoint")
@patch("services.agent.engine.httpx.AsyncClient")
async def test_engine_emits_error_when_endpoint_fails(
    mock_client_cls, mock_endpoint, mock_embed, mock_retrieve, mock_exec,
):
    mock_endpoint.side_effect = RuntimeError("API key not configured")
    req = AgentRequest(
        messages=[ChatMessage(role="user", content="hi")],
        query="hi",
        mode=Mode.API,
    )
    events = [e async for e in run_turn(req, user_id="u1",
                                        skill_registry=_make_registry())]
    error_events = [e for e in events if e["type"] == "error"]
    assert len(error_events) == 1
    assert "API key" in error_events[0]["content"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_engine.py -v`
Expected: ImportError or NotFound.

- [ ] **Step 3: Implement the Agent Engine**

Create `backend/services/agent/engine.py`:
```python
"""Agent Engine — the core loop.

run_turn(request) → AsyncIterator[dict] of stream events.

Loop:
  1. retrieve context (semantic search via existing retriever)
  2. classify skills (keyword overlap against skill descriptions)
  3. build system prompt (base + skill bodies + knowledge context)
  4. open SSE stream to the model endpoint (OpenAI-compatible chat-completions)
  5. yield text/tool_call/tool_result/error events
  6. close with a done event
"""
from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator

import httpx

from models.agent import AgentRequest, Mode, Tier
from services.agent.brain_tools import BRAIN_TOOL_SCHEMAS, execute_brain_tool
from services.agent.model import get_endpoint
from services.agent.permissions import Allow, Deny, check as permission_check
from services.agent.skills import SkillRegistry, classify_skills
from services.embedder import embed
from services.retriever import retrieve

MAX_TOOL_CALLS_PER_TURN = 10


BASE_PERSONA = """You are the Second Brain assistant. You help the user think
about, organize, and recall the contents of their personal knowledge base.

You have access to tools that can search and modify the user's notes. Prefer
to use tools rather than guess. When you cite a note, use its deep_link.

Always be concise. Never fabricate note IDs."""


def _tier_for_mode(mode: Mode) -> Tier:
    return Tier.INTERNAL_LOCAL if mode == Mode.LOCAL else Tier.INTERNAL_API


def _build_knowledge_context_xml(notes: list[dict]) -> str:
    if not notes:
        return ""
    parts = ["<knowledge_context>"]
    for n in notes:
        nid = n.get("id", "")
        title = n.get("title", "")
        link = n.get("deep_link", f"/brain/{nid}")
        snippet = (n.get("content_text") or n.get("summary") or "")[:400]
        parts.append(
            f'  <note id="{nid}" title="{title}" deep_link="{link}">\n'
            f'    {snippet}\n'
            f'  </note>'
        )
    parts.append("</knowledge_context>")
    return "\n".join(parts)


def _build_system_prompt(skill_bodies: list[str], knowledge_xml: str) -> str:
    sections = [BASE_PERSONA]
    if skill_bodies:
        sections.append("Active skills:\n\n" + "\n\n---\n\n".join(skill_bodies))
    if knowledge_xml:
        sections.append(knowledge_xml)
    return "\n\n".join(sections)


def _ev(payload: dict) -> dict:
    """Identity helper — exists so callers can grep for event creation sites."""
    return payload


async def run_turn(
    request: AgentRequest,
    user_id: str,
    skill_registry: SkillRegistry,
) -> AsyncIterator[dict[str, Any]]:
    thread_id = request.thread_id or str(uuid.uuid4())
    message_id = str(uuid.uuid4())
    tier = _tier_for_mode(request.mode)

    # 1. Retrieve context
    try:
        embedding = embed(request.query)
        notes = retrieve(embedding, user_id)
    except Exception as e:
        notes = []
        yield _ev({"type": "error", "content": f"retrieval failed: {e}"})

    yield _ev({"type": "context", "notes": notes})

    # 2. Skill activation
    matched = classify_skills(
        query=request.query,
        skills=skill_registry.all(),
        limit=3,
    )
    for s in matched:
        yield _ev({"type": "skill_active", "name": s.name})

    # 3. Build system prompt + tool schemas
    knowledge_xml = _build_knowledge_context_xml(notes)
    system_prompt = _build_system_prompt(
        skill_bodies=[s.body for s in matched],
        knowledge_xml=knowledge_xml,
    )

    # Restrict tool list per active-skill whitelists. If no skill restricts,
    # all brain tools are offered.
    whitelisted_names: set[str] | None = None
    for s in matched:
        if s.tools is not None:
            namespaced = {f"brain.{t}" if not t.startswith("brain.") else t
                          for t in s.tools}
            whitelisted_names = (
                whitelisted_names & namespaced
                if whitelisted_names is not None
                else namespaced
            )

    tool_schemas = (
        [t for t in BRAIN_TOOL_SCHEMAS if t["name"] in whitelisted_names]
        if whitelisted_names is not None
        else BRAIN_TOOL_SCHEMAS
    )

    # 4. Open the endpoint
    try:
        endpoint = get_endpoint(request.mode, task="chat")
    except RuntimeError as e:
        yield _ev({"type": "error", "content": str(e)})
        yield _ev({"type": "done", "thread_id": thread_id,
                  "message_id": message_id})
        return

    messages_payload = [{"role": "system", "content": system_prompt}]
    messages_payload += [m.model_dump() for m in request.messages]

    payload = {
        "model": endpoint["model"],
        "messages": messages_payload,
        "stream": True,
        "max_tokens": 2048,
        # OpenAI-shaped tool advertising:
        "tools": [{"type": "function", "function": t} for t in tool_schemas],
    }

    # 5. Drive the streaming loop
    tool_calls_made = 0
    async with httpx.AsyncClient(timeout=240) as client:
        async for ev in _stream_loop(
            client, endpoint, payload,
            messages_payload=messages_payload,
            tool_schemas=tool_schemas,
            tier=tier,
            user_id=user_id,
            tool_calls_made=tool_calls_made,
        ):
            yield ev

    # 6. Done
    yield _ev({"type": "done", "thread_id": thread_id, "message_id": message_id})


async def _stream_loop(
    client: httpx.AsyncClient,
    endpoint: dict[str, Any],
    payload: dict[str, Any],
    messages_payload: list[dict],
    tool_schemas: list[dict],
    tier: Tier,
    user_id: str,
    tool_calls_made: int,
) -> AsyncIterator[dict[str, Any]]:
    """Inner streaming loop — handles a single LLM call. Re-entered after
    each tool call to continue generation."""
    pending_tool_calls: list[dict[str, Any]] = []

    async with client.stream(
        "POST", endpoint["url"], headers=endpoint["headers"], json=payload
    ) as resp:
        if resp.status_code != 200:
            body = await resp.aread()
            yield _ev({"type": "error",
                       "content": f"LLM error {resp.status_code}: {body.decode()[:400]}"})
            return

        async for line in resp.aiter_lines():
            if not line.startswith("data: "):
                continue
            raw = line[6:]
            if raw == "[DONE]":
                break
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            delta = data.get("choices", [{}])[0].get("delta", {})

            # Text content
            text = delta.get("content")
            if text:
                yield _ev({"type": "text", "content": text})

            # Tool calls (OpenAI streaming format — accumulate by index)
            for tc in delta.get("tool_calls", []) or []:
                idx = tc.get("index", 0)
                while len(pending_tool_calls) <= idx:
                    pending_tool_calls.append({"id": "", "name": "", "args_buf": ""})
                slot = pending_tool_calls[idx]
                if tc.get("id"):
                    slot["id"] = tc["id"]
                fn = tc.get("function") or {}
                if fn.get("name"):
                    slot["name"] = fn["name"]
                if fn.get("arguments"):
                    slot["args_buf"] += fn["arguments"]

    # After stream finishes, execute any tool calls (one round in Phase 1;
    # multi-round will follow once we wire continue-on-tool-result).
    for slot in pending_tool_calls:
        if tool_calls_made >= MAX_TOOL_CALLS_PER_TURN:
            yield _ev({"type": "error",
                       "content": "tool call budget exhausted"})
            return
        tool = slot["name"]
        try:
            args = json.loads(slot["args_buf"] or "{}")
        except json.JSONDecodeError:
            yield _ev({"type": "tool_denied", "id": slot["id"], "tool": tool,
                       "reason": "invalid JSON arguments"})
            continue

        yield _ev({"type": "tool_call", "id": slot["id"],
                   "tool": tool, "args": args})

        # Permission check — note-targeted tools need note_meta
        note_meta: dict[str, Any] | None = None
        target_id = args.get("id") or args.get("note_id")
        if target_id and tool != "brain.search_brain":
            try:
                note_meta = execute_brain_tool(
                    "brain.get_note", args={"id": target_id}, user_id=user_id
                )
            except Exception:
                note_meta = None

        decision = permission_check(tool, tier, args, note_meta)
        if isinstance(decision, Deny):
            yield _ev({"type": "tool_denied", "id": slot["id"],
                       "tool": tool, "reason": decision.reason})
            continue

        try:
            result = execute_brain_tool(tool, args=args, user_id=user_id)
        except Exception as e:
            yield _ev({"type": "tool_denied", "id": slot["id"],
                       "tool": tool, "reason": f"execution error: {e}"})
            continue

        tool_calls_made += 1
        summary = _summarize_result(tool, result)
        yield _ev({"type": "tool_result", "id": slot["id"],
                   "summary": summary, "data": result})


def _summarize_result(tool: str, result: dict[str, Any]) -> str:
    """Compact human-readable summary used in the inline tool-event UI."""
    if tool == "brain.search_brain":
        n = len(result.get("matches", []))
        return f"{n} notes matched"
    if tool == "brain.list_notes":
        n = len(result.get("notes", []))
        return f"{n} notes"
    if tool in ("brain.create_note", "brain.update_note"):
        return f"note {result.get('id', '?')} {'created' if 'create' in tool else 'updated'}"
    if tool == "brain.delete_note":
        return f"note {result.get('id', '?')} moved to trash"
    return tool.split(".")[-1] + " ok"
```

- [ ] **Step 4: Run tests**

Run: `cd backend && pytest tests/test_engine.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/agent/engine.py backend/tests/test_engine.py
git commit -m "feat(agent): Agent Engine with skill activation, retrieval, tool calls"
```

---

### Task 11: Agent router — `POST /agent` SSE endpoint

**Files:**
- Create: `backend/routers/agent.py`
- Modify: `backend/main.py`
- Modify: `backend/core/config.py` (already added in Task 7; nothing new here)

- [ ] **Step 1: Add the router**

Create `backend/routers/agent.py`:
```python
"""POST /agent — SSE-streaming endpoint that runs the Agent Engine.

Replaces the old POST /chat endpoint. Saves the assistant message to
chat_threads on completion.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Header
from fastapi.responses import StreamingResponse

from models.agent import AgentRequest, Mode
from routers.ingest import get_user_id  # JWT helper, already exists
from services.agent.engine import run_turn
from services.agent.skills import SkillRegistry
from services.database import get_supabase

router = APIRouter(prefix="/agent", tags=["agent"])


_BUNDLED_SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
_USER_SKILLS_DIR = Path.home() / ".secondbrain" / "skills"


def _get_registry() -> SkillRegistry:
    return SkillRegistry.load([_BUNDLED_SKILLS_DIR, _USER_SKILLS_DIR])


@router.post("")
async def agent_endpoint(
    body: AgentRequest,
    authorization: str = Header(),
):
    user_id = get_user_id(authorization)
    registry = _get_registry()

    thread_id = body.thread_id or str(uuid.uuid4())
    # Append user message to thread (or create thread)
    _append_user_message_to_thread(thread_id, user_id, body)

    async def stream():
        last_assistant_text = ""
        async for ev in run_turn(body, user_id=user_id, skill_registry=registry):
            # Override thread_id with our own so the row matches the SSE
            if ev.get("type") == "done":
                ev = {**ev, "thread_id": thread_id}
            if ev.get("type") == "text":
                last_assistant_text += ev["content"]
            yield "data: " + json.dumps(ev) + "\n\n"

        # Persist assistant message after stream completes
        _append_assistant_message_to_thread(thread_id, last_assistant_text)
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


def _append_user_message_to_thread(
    thread_id: str, user_id: str, body: AgentRequest
) -> None:
    """Either update an existing thread's messages or create a new one."""
    supabase = get_supabase()
    existing = (
        supabase.table("chat_threads")
        .select("id, messages")
        .eq("id", thread_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
        .data
    )
    new_message = {"role": "user", "content": body.query}
    if existing:
        messages = existing["messages"] + [new_message]
        supabase.table("chat_threads").update({"messages": messages}).eq(
            "id", thread_id
        ).execute()
    else:
        supabase.table("chat_threads").insert({
            "id": thread_id,
            "user_id": user_id,
            "messages": [new_message],
            "model_mode": body.mode.value,
            "title": body.query[:60],  # placeholder; replaced after first reply
        }).execute()


def _append_assistant_message_to_thread(thread_id: str, content: str) -> None:
    if not content:
        return
    supabase = get_supabase()
    existing = (
        supabase.table("chat_threads")
        .select("id, messages, title")
        .eq("id", thread_id)
        .maybe_single()
        .execute()
        .data
    )
    if not existing:
        return
    messages = existing["messages"] + [{"role": "assistant", "content": content}]
    update: dict = {"messages": messages}
    # First assistant reply → set a short auto-title if the title was the
    # truncated user query.
    if existing["title"] and len(existing["messages"]) == 1:
        first_user = existing["messages"][0]["content"]
        if existing["title"] == first_user[:60]:
            update["title"] = _auto_title(first_user)
    supabase.table("chat_threads").update(update).eq("id", thread_id).execute()


def _auto_title(first_user_msg: str) -> str:
    """Fast deterministic title from the first user message.

    Phase 1: take the first sentence (or ≤6 words). A small-LLM title is a
    nice-to-have in Phase 2.
    """
    head = first_user_msg.strip().split(".")[0]
    words = head.split()
    return " ".join(words[:6]) + ("…" if len(words) > 6 else "")
```

- [ ] **Step 2: Register the router**

Read `backend/main.py` to locate where existing routers are registered, then add:
```python
from routers.agent import router as agent_router
app.include_router(agent_router)
```

- [ ] **Step 3: Smoke-test the endpoint locally**

Start the backend:
```bash
cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000
```

In another terminal, with a valid JWT in `$JWT`:
```bash
curl -N -X POST http://localhost:8000/agent \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"query":"hello","messages":[{"role":"user","content":"hello"}],"mode":"api"}'
```
Expected: a stream of `data: {...}\n\n` lines. The first few should include `context`, `skill_active` (if any match "hello"), then `text` events with the assistant reply, then `done`, then `[DONE]`.

- [ ] **Step 4: Commit**

```bash
git add backend/routers/agent.py backend/main.py
git commit -m "feat(agent): POST /agent SSE endpoint with thread persistence"
```

---

### Task 12: Remove old chat router and tutor prompt

**Files:**
- Delete: `backend/routers/chat.py`
- Delete: `backend/prompts/tutor.py`
- Modify: `backend/main.py`
- Modify: `backend/mcp_server.py` (if it imports `prompts.tutor`)

- [ ] **Step 1: Confirm no other callers**

Run from `backend/`:
```bash
grep -rn "from routers.chat\|import routers.chat\|from prompts.tutor\|import prompts.tutor" .
```
Expected: results only inside `main.py` and (possibly) `mcp_server.py`.

- [ ] **Step 2: Remove imports from main.py**

In `backend/main.py`, delete:
```python
from routers.chat import router as chat_router
```
and the corresponding `app.include_router(chat_router)` line.

- [ ] **Step 3: Update mcp_server.py if needed**

Read `backend/mcp_server.py`. If it imports `build_knowledge_context_xml` from `prompts.tutor`, replace with a local inline implementation:
```python
def build_knowledge_context_xml(notes: list[dict]) -> str:
    if not notes:
        return ""
    tags = []
    for n in notes:
        nid = n.get("id", "")
        title = n.get("title", "")
        link = n.get("deep_link", f"/brain/{nid}")
        snippet = (n.get("content_text") or n.get("summary") or "")[:400]
        tags.append(
            f'  <note id="{nid}" title="{title}" deep_link="{link}">\n'
            f'    {snippet}\n  </note>'
        )
    return "<knowledge_context>\n" + "\n".join(tags) + "\n</knowledge_context>"
```
Then remove its import of `prompts.tutor`.

- [ ] **Step 4: Delete the files**

```bash
rm backend/routers/chat.py backend/prompts/tutor.py
```

- [ ] **Step 5: Re-run all backend tests**

```bash
cd backend && pytest -q
```
Expected: every test still passes.

- [ ] **Step 6: Commit**

```bash
git add -A backend/
git commit -m "refactor: remove old chat router and tutor prompt"
```

---

## Frontend — Markdown rendering

### Task 13: Install markdown dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Add the libraries**

From `frontend/`:
```bash
npm install react-markdown@^9 remark-gfm@^4 remark-math@^6 \
            rehype-katex@^7 rehype-prism-plus@^2 katex@^0.16 \
            unified@^11 unist-util-visit@^5
```

- [ ] **Step 2: Verify install**

Run: `npm list react-markdown rehype-katex katex`
Expected: each appears with the installed version, no peer dep warnings that block install.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "deps(frontend): markdown libs for chat renderer"
```

---

### Task 14: Markdown fence parser (`:::callout`, `:::interactive`, `:::note-ref`)

**Files:**
- Create: `frontend/lib/markdown/fences.ts`
- Create: `frontend/lib/markdown/__tests__/fences.test.ts` (vitest-compatible — tests are runnable via Playwright as a separate suite OR via `ts-node`; this plan uses ts-node smoke runs since the codebase has no unit-test runner yet)

A remark plugin walks parsed markdown AST nodes and transforms `:::name attrs\n...\n:::` containers into a custom node type the React renderer maps to a component.

- [ ] **Step 1: Implement the parser**

Create `frontend/lib/markdown/fences.ts`:
```typescript
/**
 * Remark plugin: parses ":::name attr=val attr=\"q v\"" fenced directives into
 * a custom `customFence` mdast node carrying { name, attrs, children }.
 *
 * Container syntax:
 *   :::callout color=blue icon=📋
 *   This is the body — may contain **markdown**.
 *   :::
 *
 *   :::interactive title="Live derivative plotter"
 *   <html-block-here>
 *   :::
 *
 *   :::note-ref id=uuid title="Calculus"
 *   :::
 */
import { visit } from "unist-util-visit";
import type { Root, Node, Parent } from "unist";

const OPEN = /^:::([a-zA-Z][a-zA-Z0-9_-]*)\s*(.*)$/;
const CLOSE = /^:::\s*$/;

interface CustomFenceNode extends Node {
  type: "customFence";
  name: string;
  attrs: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children: any[];
  raw: string;  // raw inner content (for HTML-only fences like interactive)
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

export function remarkCustomFences() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: Root) => {
    visit(tree, "paragraph", (node: any, index: number, parent: Parent | undefined) => {
      if (!parent || typeof index !== "number") return;
      const firstChild = node.children?.[0];
      if (!firstChild || firstChild.type !== "text") return;
      const m = OPEN.exec(firstChild.value.split("\n")[0]);
      if (!m) return;

      const name = m[1];
      const attrs = parseAttrs(m[2]);

      // Collect siblings until a closing ::: paragraph is found
      const innerNodes: any[] = [];
      const rawLines: string[] = [];
      let end = index + 1;
      while (end < parent.children.length) {
        const sib: any = parent.children[end];
        if (sib.type === "paragraph") {
          const txt = sib.children?.[0]?.value ?? "";
          if (CLOSE.test(txt.trim())) break;
        }
        innerNodes.push(sib);
        if (sib.type === "paragraph") {
          for (const c of sib.children ?? []) {
            if (c.value) rawLines.push(c.value);
          }
        }
        end++;
      }

      const fenceNode: CustomFenceNode = {
        type: "customFence",
        name,
        attrs,
        children: innerNodes,
        raw: rawLines.join("\n"),
      };
      parent.children.splice(index, end - index + 1, fenceNode as any);
    });
  };
}
```

- [ ] **Step 2: Quick smoke check**

From `frontend/`:
```bash
node --loader ts-node/esm -e '
  import("unified").then(async ({ unified }) => {
    const remarkParse = (await import("remark-parse")).default;
    const { remarkCustomFences } = await import("./lib/markdown/fences.ts");
    const tree = unified().use(remarkParse).use(remarkCustomFences).parse(`
:::callout color=blue
hello
:::
`);
    console.log(JSON.stringify(tree, null, 2).slice(0, 400));
  })
'
```
Expected: the printed tree contains a `customFence` node with `name: "callout"` and `attrs: { color: "blue" }`. If `ts-node` isn't installed, skip this smoke check — it's verified by the integration test in Task 16.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/markdown/fences.ts
git commit -m "feat(markdown): remark plugin for ::: custom fences"
```

---

### Task 15: Markdown component + fence renderers

**Files:**
- Create: `frontend/lib/markdown/components/Callout.tsx`
- Create: `frontend/lib/markdown/components/NoteRef.tsx`
- Create: `frontend/components/interactive/InteractiveFrame.tsx`
- Create: `frontend/lib/markdown/Markdown.tsx`

- [ ] **Step 1: Create the Callout component**

Create `frontend/lib/markdown/components/Callout.tsx`:
```tsx
"use client";

import type { ReactNode } from "react";

const COLORS: Record<string, { bg: string; border: string; text: string }> = {
  blue:   { bg: "bg-blue-50 dark:bg-blue-900/20",   border: "border-blue-300 dark:border-blue-700",   text: "text-blue-900 dark:text-blue-100" },
  red:    { bg: "bg-red-50 dark:bg-red-900/20",     border: "border-red-300 dark:border-red-700",     text: "text-red-900 dark:text-red-100" },
  orange: { bg: "bg-orange-50 dark:bg-orange-900/20", border: "border-orange-300 dark:border-orange-700", text: "text-orange-900 dark:text-orange-100" },
  yellow: { bg: "bg-yellow-50 dark:bg-yellow-900/20", border: "border-yellow-300 dark:border-yellow-700", text: "text-yellow-900 dark:text-yellow-100" },
  green:  { bg: "bg-green-50 dark:bg-green-900/20", border: "border-green-300 dark:border-green-700", text: "text-green-900 dark:text-green-100" },
  purple: { bg: "bg-purple-50 dark:bg-purple-900/20", border: "border-purple-300 dark:border-purple-700", text: "text-purple-900 dark:text-purple-100" },
  gray:   { bg: "bg-gray-50 dark:bg-gray-800/30",   border: "border-gray-300 dark:border-gray-600",   text: "text-gray-900 dark:text-gray-100" },
};

interface Props {
  color?: string;
  icon?: string;
  children: ReactNode;
}

export function Callout({ color = "blue", icon, children }: Props) {
  const c = COLORS[color] ?? COLORS.blue;
  return (
    <div
      className={`my-3 rounded-lg border-l-4 px-4 py-3 ${c.bg} ${c.border} ${c.text}`}
      role="note"
    >
      {icon && <span className="mr-2 text-base" aria-hidden>{icon}</span>}
      <span className="text-sm leading-relaxed">{children}</span>
    </div>
  );
}
```

- [ ] **Step 2: Create the NoteRef component**

Create `frontend/lib/markdown/components/NoteRef.tsx`:
```tsx
"use client";

import Link from "next/link";

interface Props {
  id: string;
  title?: string;
  icon?: string;
}

export function NoteRef({ id, title = "Untitled", icon = "📄" }: Props) {
  return (
    <Link
      href={`/brain/${id}`}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-sm hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
    >
      <span aria-hidden>{icon}</span>
      <span className="font-medium">{title}</span>
    </Link>
  );
}
```

- [ ] **Step 3: Create the shared InteractiveFrame component**

Create `frontend/components/interactive/InteractiveFrame.tsx`:
```tsx
"use client";

interface Props {
  title?: string;
  html: string;
  height?: number;
}

export function InteractiveFrame({ title = "Interactive", html, height = 300 }: Props) {
  return (
    <div className="my-4 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold">
        <span>⚡</span><span>{title}</span>
      </div>
      <iframe
        srcDoc={html}
        sandbox="allow-scripts"
        className="w-full border-none block bg-white dark:bg-gray-900"
        style={{ height }}
        title={title}
      />
    </div>
  );
}
```

- [ ] **Step 4: Create the main Markdown wrapper**

Create `frontend/lib/markdown/Markdown.tsx`:
```tsx
"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypePrism from "rehype-prism-plus";
import "katex/dist/katex.min.css";

import { remarkCustomFences } from "./fences";
import { Callout } from "./components/Callout";
import { NoteRef } from "./components/NoteRef";
import { InteractiveFrame } from "@/components/interactive/InteractiveFrame";

interface Props {
  children: string;
}

const components: Components = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customFence: (({ node, children }: any) => {
    const name = node.name as string;
    const attrs = (node.attrs ?? {}) as Record<string, string>;
    if (name === "callout") {
      return <Callout color={attrs.color} icon={attrs.icon}>{children}</Callout>;
    }
    if (name === "interactive") {
      return (
        <InteractiveFrame
          title={attrs.title}
          html={node.raw}
          height={attrs.height ? parseInt(attrs.height, 10) : 300}
        />
      );
    }
    if (name === "note-ref") {
      return <NoteRef id={attrs.id} title={attrs.title} icon={attrs.icon} />;
    }
    return <>{children}</>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any,
  // Tight typography in chat
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>,
  h1: ({ children }) => <h1 className="mt-5 mb-2 text-xl font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 mb-2 text-lg font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>,
  code: ({ inline, className, children, ...props }: { inline?: boolean; className?: string; children?: React.ReactNode }) =>
    inline ? (
      <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[13px] font-mono text-indigo-600 dark:text-indigo-300" {...props}>{children}</code>
    ) : (
      <code className={className} {...props}>{children}</code>
    ),
  pre: ({ children }) => <pre className="my-3 p-3 rounded-lg bg-slate-900 text-slate-100 text-[13px] overflow-x-auto">{children}</pre>,
  table: ({ children }) => <table className="my-3 border-collapse text-sm w-full">{children}</table>,
  th: ({ children }) => <th className="border border-gray-300 dark:border-gray-700 px-2 py-1 bg-gray-50 dark:bg-gray-800 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-gray-300 dark:border-gray-700 px-2 py-1">{children}</td>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-indigo-300 pl-3 italic text-gray-600 dark:text-gray-400">{children}</blockquote>,
  a: ({ href, children }) => (
    <a href={href} className="text-indigo-600 dark:text-indigo-400 hover:underline">{children}</a>
  ),
};

export function Markdown({ children }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkCustomFences]}
      rehypePlugins={[rehypeKatex, [rehypePrism, { ignoreMissing: true }]]}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/markdown/Markdown.tsx \
        frontend/lib/markdown/components/Callout.tsx \
        frontend/lib/markdown/components/NoteRef.tsx \
        frontend/components/interactive/InteractiveFrame.tsx
git commit -m "feat(markdown): unified renderer with callout/interactive/note-ref fences"
```

---

## Frontend — Threads API + Chat UI

### Task 16: Next.js API routes for threads

**Files:**
- Create: `frontend/app/api/threads/route.ts`
- Create: `frontend/app/api/threads/[id]/route.ts`

- [ ] **Step 1: List + create**

Create `frontend/app/api/threads/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("chat_threads")
    .select("id, title, pinned, model_mode, created_at, updated_at, archived_at")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ threads: data ?? [] });
}
```

- [ ] **Step 2: Single-thread GET/PATCH/DELETE**

Create `frontend/app/api/threads/[id]/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("chat_threads")
    .select("id, title, messages, pinned, model_mode, context_note_ids, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const allowed: Record<string, unknown> = {};
  if (typeof body.title === "string") allowed.title = body.title;
  if (typeof body.pinned === "boolean") allowed.pinned = body.pinned;

  const { data, error } = await supabase
    .from("chat_threads")
    .update(allowed)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("chat_threads")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/threads/
git commit -m "feat(threads): list/get/patch/archive thread API routes"
```

---

### Task 17: Next.js API proxy to `/agent`

**Files:**
- Create: `frontend/app/api/agent/route.ts`

- [ ] **Step 1: Implement the proxy**

Create `frontend/app/api/agent/route.ts`:
```typescript
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const fastApiUrl = process.env.FASTAPI_URL ?? "http://localhost:8000";

  let res: Response;
  try {
    res = await fetch(`${fastApiUrl}/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: req.body,
      // @ts-expect-error — Node 18+ streaming bodies
      duplex: "half",
    });
  } catch (e) {
    const refused = e instanceof Error && e.message.includes("ECONNREFUSED");
    return new Response(
      JSON.stringify({
        error: refused
          ? "Backend not running. Start it with: cd backend && uvicorn main:app --reload"
          : `Failed to reach backend: ${e instanceof Error ? e.message : String(e)}`,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/api/agent/route.ts
git commit -m "feat(agent): Next.js SSE proxy for /api/agent"
```

---

### Task 18: ModeToggle component

**Files:**
- Create: `frontend/components/ai/ModeToggle.tsx`

- [ ] **Step 1: Implement the toggle**

Create `frontend/components/ai/ModeToggle.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";

export type Mode = "local" | "api";

const KEY = "secondbrain:mode";

export function useMode(): [Mode, (m: Mode) => void] {
  const [mode, setMode] = useState<Mode>("api");
  useEffect(() => {
    const v = localStorage.getItem(KEY) as Mode | null;
    if (v === "local" || v === "api") setMode(v);
  }, []);
  const update = (m: Mode) => {
    setMode(m);
    localStorage.setItem(KEY, m);
  };
  return [mode, update];
}

interface Props {
  mode: Mode;
  onChange: (m: Mode) => void;
}

export function ModeToggle({ mode, onChange }: Props) {
  return (
    <button
      onClick={() => onChange(mode === "local" ? "api" : "local")}
      title={`Current mode: ${mode}. Click to switch.`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      aria-label={`AI mode: ${mode}`}
    >
      <span className="text-sm" aria-hidden>{mode === "local" ? "📱" : "☁️"}</span>
      <span className="capitalize">{mode}</span>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ai/ModeToggle.tsx
git commit -m "feat(ai): ModeToggle pill (Local/API) with localStorage persistence"
```

---

### Task 19: ToolEvent + SkillBadge + MessageList

**Files:**
- Create: `frontend/components/ai/ToolEvent.tsx`
- Create: `frontend/components/ai/SkillBadge.tsx`
- Create: `frontend/components/ai/MessageList.tsx`

- [ ] **Step 1: ToolEvent**

Create `frontend/components/ai/ToolEvent.tsx`:
```tsx
"use client";

import { useState } from "react";

interface Props {
  tool: string;
  args: Record<string, unknown>;
  summary?: string;
  deniedReason?: string;
}

const TOOL_ICONS: Record<string, string> = {
  "brain.search_brain": "🔍",
  "brain.get_note":     "📖",
  "brain.list_notes":   "📚",
  "brain.create_note":  "✨",
  "brain.update_note":  "✏️",
  "brain.delete_note":  "🗑️",
  "brain.link_notes":   "🔗",
  "brain.set_mastery":  "🎯",
  "brain.get_backlinks":"🪞",
};

export function ToolEvent({ tool, args, summary, deniedReason }: Props) {
  const [open, setOpen] = useState(false);
  const icon = TOOL_ICONS[tool] ?? "🛠️";
  const label = tool.split(".").slice(1).join(".").replace(/_/g, " ");

  return (
    <div className="my-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-xs flex items-center gap-2 px-2 py-1 rounded-md transition-colors ${
          deniedReason
            ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100"
            : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100"
        }`}
      >
        <span>{icon}</span>
        <span>{label}</span>
        {summary && <span className="text-gray-400">— {summary}</span>}
        {deniedReason && <span>· denied</span>}
        <span className="ml-1 text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1 ml-6 p-2 rounded-md bg-gray-50 dark:bg-gray-800 text-[11px] font-mono text-gray-600 dark:text-gray-300">
          <div><b>args:</b> {JSON.stringify(args)}</div>
          {deniedReason && <div className="text-red-600 mt-1"><b>denied:</b> {deniedReason}</div>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: SkillBadge**

Create `frontend/components/ai/SkillBadge.tsx`:
```tsx
"use client";

interface Props { name: string }

export function SkillBadge({ name }: Props) {
  return (
    <div className="my-2 inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
      <span aria-hidden>🧩</span>
      <span>Loaded skill: <span className="font-semibold">{name}</span></span>
    </div>
  );
}
```

- [ ] **Step 3: MessageList**

Create `frontend/components/ai/MessageList.tsx`:
```tsx
"use client";

import { Markdown } from "@/lib/markdown/Markdown";
import { ToolEvent } from "./ToolEvent";
import { SkillBadge } from "./SkillBadge";

export type StreamItem =
  | { kind: "user"; id: string; content: string }
  | { kind: "assistant"; id: string; content: string; streaming?: boolean }
  | { kind: "skill"; id: string; name: string }
  | { kind: "tool"; id: string; tool: string; args: Record<string, unknown>; summary?: string; denied?: string };

interface Props {
  items: StreamItem[];
}

export function MessageList({ items }: Props) {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {items.map((item) => {
        if (item.kind === "user") {
          return (
            <div key={item.id} className="flex justify-end mb-5">
              <div className="max-w-[78%] bg-slate-100 dark:bg-slate-800 text-gray-900 dark:text-gray-100 rounded-2xl rounded-br-md px-4 py-3 text-sm">
                <p className="whitespace-pre-wrap">{item.content}</p>
              </div>
            </div>
          );
        }
        if (item.kind === "skill") {
          return <SkillBadge key={item.id} name={item.name} />;
        }
        if (item.kind === "tool") {
          return (
            <ToolEvent
              key={item.id}
              tool={item.tool}
              args={item.args}
              summary={item.summary}
              deniedReason={item.denied}
            />
          );
        }
        // assistant
        return (
          <div key={item.id} className="flex gap-3 mb-5">
            <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
              <span className="text-[11px] text-white font-bold">AI</span>
            </div>
            <div className="flex-1 min-w-0 text-sm">
              <Markdown>{item.content}</Markdown>
              {item.streaming && (
                <span className="inline-block w-0.5 h-[1.1em] bg-indigo-400 animate-pulse ml-0.5 align-middle rounded-full" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ai/ToolEvent.tsx \
        frontend/components/ai/SkillBadge.tsx \
        frontend/components/ai/MessageList.tsx
git commit -m "feat(ai): MessageList with tool events, skill badges, streaming cursor"
```

---

### Task 20: ThreadHistory

**Files:**
- Create: `frontend/components/ai/ThreadHistory.tsx`

- [ ] **Step 1: Implement the panel**

Create `frontend/components/ai/ThreadHistory.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { Pin, Trash2, Pencil, Plus } from "lucide-react";

interface Thread {
  id: string;
  title: string | null;
  pinned: boolean;
  model_mode: string | null;
  updated_at: string;
}

interface Props {
  activeThreadId: string | null;
  onSelect: (id: string | null) => void;
}

export function ThreadHistory({ activeThreadId, onSelect }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    const res = await fetch("/api/threads");
    const data = await res.json();
    setThreads(data.threads ?? []);
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  async function togglePin(t: Thread) {
    await fetch(`/api/threads/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !t.pinned }),
    });
    reload();
  }

  async function rename(t: Thread) {
    const next = prompt("Rename thread:", t.title ?? "");
    if (next === null) return;
    await fetch(`/api/threads/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next.trim() || null }),
    });
    reload();
  }

  async function remove(t: Thread) {
    if (!confirm("Archive this thread?")) return;
    await fetch(`/api/threads/${t.id}`, { method: "DELETE" });
    if (activeThreadId === t.id) onSelect(null);
    reload();
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          History
        </h2>
        <button
          onClick={() => onSelect(null)}
          className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-500"
          title="Start new thread"
        >
          <Plus size={13} /> New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-gray-400">Loading…</div>
        ) : threads.length === 0 ? (
          <div className="p-4 text-xs text-gray-400">No past threads.</div>
        ) : (
          <ul className="py-1">
            {threads.map((t) => (
              <li
                key={t.id}
                className={`group flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${
                  t.id === activeThreadId
                    ? "bg-indigo-50 dark:bg-indigo-950/30"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onClick={() => onSelect(t.id)}
              >
                {t.pinned && <span className="text-xs text-amber-500">📌</span>}
                <span className="flex-1 truncate text-gray-700 dark:text-gray-200">
                  {t.title ?? "Untitled"}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); togglePin(t); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-amber-500"
                  title={t.pinned ? "Unpin" : "Pin"}
                >
                  <Pin size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); rename(t); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-500"
                  title="Rename"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(t); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"
                  title="Archive"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ai/ThreadHistory.tsx
git commit -m "feat(ai): ThreadHistory sidebar (list, pin, rename, archive)"
```

---

### Task 21: Chat component

**Files:**
- Create: `frontend/components/ai/Chat.tsx`

- [ ] **Step 1: Implement the chat**

Create `frontend/components/ai/Chat.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { MessageList, type StreamItem } from "./MessageList";
import { ThreadHistory } from "./ThreadHistory";
import { ModeToggle, useMode } from "./ModeToggle";

export function Chat() {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [mode, setMode] = useMode();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  // Load thread on switch
  useEffect(() => {
    if (!threadId) { setItems([]); return; }
    (async () => {
      const res = await fetch(`/api/threads/${threadId}`);
      if (!res.ok) return;
      const t = await res.json();
      const loaded: StreamItem[] = (t.messages ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m: any, i: number) => m.role === "user"
          ? { kind: "user" as const, id: `h-${i}`, content: m.content }
          : { kind: "assistant" as const, id: `h-${i}`, content: m.content }
      );
      setItems(loaded);
    })();
  }, [threadId]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const query = input.trim();
    if (!query || loading) return;

    const userMsg: StreamItem = { kind: "user", id: crypto.randomUUID(), content: query };
    const assistantId = crypto.randomUUID();
    setItems((prev) => [...prev, userMsg,
      { kind: "assistant", id: assistantId, content: "", streaming: true }]);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          query,
          mode,
          messages: [
            ...items.filter((i) => i.kind === "user" || i.kind === "assistant")
                  .map((i) => ({ role: i.kind, content: (i as { content: string }).content })),
            { role: "user", content: query },
          ],
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Server ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") break;
          let ev: { type: string; [k: string]: unknown };
          try { ev = JSON.parse(raw); } catch { continue; }

          if (ev.type === "text") {
            setItems((prev) => prev.map((it) =>
              it.kind === "assistant" && it.id === assistantId
                ? { ...it, content: it.content + (ev.content as string) }
                : it
            ));
          } else if (ev.type === "skill_active") {
            setItems((prev) => insertBefore(prev, assistantId, {
              kind: "skill", id: crypto.randomUUID(), name: ev.name as string,
            }));
          } else if (ev.type === "tool_call") {
            setItems((prev) => insertBefore(prev, assistantId, {
              kind: "tool", id: ev.id as string, tool: ev.tool as string,
              args: ev.args as Record<string, unknown>,
            }));
          } else if (ev.type === "tool_result") {
            setItems((prev) => prev.map((it) =>
              it.kind === "tool" && it.id === ev.id
                ? { ...it, summary: ev.summary as string }
                : it
            ));
          } else if (ev.type === "tool_denied") {
            setItems((prev) => prev.map((it) =>
              it.kind === "tool" && it.id === ev.id
                ? { ...it, denied: ev.reason as string }
                : it
            ));
          } else if (ev.type === "done") {
            if (ev.thread_id && !threadId) setThreadId(ev.thread_id as string);
          } else if (ev.type === "error") {
            setError(ev.content as string);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setItems((prev) => prev.map((it) =>
        it.kind === "assistant" && it.id === assistantId
          ? { ...it, streaming: false }
          : it
      ));
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40">
        <ThreadHistory activeThreadId={threadId} onSelect={(id) => { setThreadId(id); }} />
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0" role="log" aria-live="polite">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-5 shadow-lg">
                <span className="text-3xl" aria-hidden>🧠</span>
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                What do you want to know?
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
                Ask anything — answers are grounded in your notes.
              </p>
            </div>
          ) : (
            <MessageList items={items} />
          )}
          {error && (
            <div className="max-w-2xl mx-auto px-6 mb-4">
              <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">{error}</div>
            </div>
          )}
        </div>

        <div className="px-4 md:px-8 pb-5 pt-2 shrink-0">
          <div className="max-w-2xl mx-auto">
            <form onSubmit={send} className="flex items-end gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3 shadow-sm">
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask anything about your notes…"
                disabled={loading}
                aria-label="Message input"
                className="flex-1 resize-none text-sm bg-transparent border-none outline-none disabled:opacity-50 placeholder-gray-400"
                style={{ minHeight: "1.5rem" }}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Send"
                className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                  input.trim() && !loading
                    ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed"
                }`}
              >
                {loading
                  ? <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  : <Send size={14} strokeWidth={2.5} />}
              </button>
            </form>
            <p className="text-center text-[11px] text-gray-400 mt-2">
              Enter to send · Shift+Enter for newline
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function insertBefore(prev: StreamItem[], pivotId: string, item: StreamItem): StreamItem[] {
  const idx = prev.findIndex((p) => p.kind === "assistant" && p.id === pivotId);
  if (idx < 0) return [...prev, item];
  return [...prev.slice(0, idx), item, ...prev.slice(idx)];
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/ai/Chat.tsx
git commit -m "feat(ai): Chat component with streaming + history + mode toggle"
```

---

### Task 22: Replace `/brain/chat` page

**Files:**
- Modify: `frontend/app/(brain)/brain/chat/page.tsx`

- [ ] **Step 1: Read current page**

Read `frontend/app/(brain)/brain/chat/page.tsx` to understand its current structure (it currently renders `ChatInterface`).

- [ ] **Step 2: Replace contents**

Overwrite `frontend/app/(brain)/brain/chat/page.tsx`:
```tsx
import { Chat } from "@/components/ai/Chat";

export default function ChatPage() {
  return (
    <div className="h-full">
      <Chat />
    </div>
  );
}
```

- [ ] **Step 3: Delete the old chat components**

```bash
rm -r frontend/components/chat
rm -r frontend/app/api/chat
```

- [ ] **Step 4: Verify no broken imports**

From `frontend/`:
```bash
grep -rn "components/chat\|api/chat" app components lib 2>&1 | grep -v node_modules
```
Expected: no results.

- [ ] **Step 5: Type-check and build**

```bash
npm run build
```
Expected: success. If errors, fix them inline before committing.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "refactor: replace /brain/chat with new Chat component"
```

---

### Task 23: LocalOnlyBadge in NoteProperties

**Files:**
- Create: `frontend/components/editor/LocalOnlyBadge.tsx`
- Modify: `frontend/components/editor/NoteProperties.tsx`
- Modify: `frontend/lib/types/database.ts` (add `local_only` field)

- [ ] **Step 1: Update the type**

Read `frontend/lib/types/database.ts`, locate the `Note` type, and add:
```typescript
  local_only: boolean;
  deleted_at: string | null;
```

- [ ] **Step 2: Create the badge component**

Create `frontend/components/editor/LocalOnlyBadge.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Lock, Unlock } from "lucide-react";

interface Props {
  noteId: string;
  initialValue: boolean;
}

export function LocalOnlyBadge({ noteId, initialValue }: Props) {
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    const next = !value;
    setValue(next);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ local_only: next }),
      });
      if (!res.ok) setValue(!next); // revert
    } catch {
      setValue(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      title={value
        ? "Local-only: this note is hidden from cloud AI"
        : "Make this note local-only (hidden from cloud AI)"}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        value
          ? "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200"
          : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700"
      }`}
    >
      {value ? <Lock size={11} /> : <Unlock size={11} />}
      {value ? "Local only" : "Local-only off"}
    </button>
  );
}
```

- [ ] **Step 3: Wire badge into NoteProperties**

Read `frontend/components/editor/NoteProperties.tsx` and identify where properties are rendered. Add an import and a row:
```tsx
import { LocalOnlyBadge } from "./LocalOnlyBadge";
// …
<LocalOnlyBadge noteId={note.id} initialValue={note.local_only ?? false} />
```

- [ ] **Step 4: Update the notes PATCH route to accept local_only**

Read `frontend/app/api/notes/[noteId]/route.ts`. Add `local_only` to the allowed fields in the PATCH handler:
```typescript
if (typeof body.local_only === "boolean") allowed.local_only = body.local_only;
```

- [ ] **Step 5: Build and verify**

```bash
cd frontend && npm run build
```
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(notes): local_only flag with toggle in NoteProperties"
```

---

## Integration

### Task 24: End-to-end smoke test

**Files:**
- Create: `frontend/e2e/agent-chat.spec.ts`

- [ ] **Step 1: Locate the existing Playwright tests**

Run from `frontend/`:
```bash
find e2e tests -name "*.spec.ts" 2>/dev/null | head -10
ls
```
If `e2e/` exists, add the new spec there. Otherwise create it.

- [ ] **Step 2: Write the smoke test**

Create `frontend/e2e/agent-chat.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";

test.describe("Agent Chat — Phase 1", () => {
  test("sends a question and streams a response with skill badge", async ({ page }) => {
    // Assumes the project's existing auth fixture seeds a logged-in session.
    // If not, adapt by hitting /login and signing in with test credentials.
    await page.goto("/brain/chat");
    await expect(page.getByRole("heading", { name: /what do you want to know/i }))
      .toBeVisible();

    const input = page.getByRole("textbox", { name: /message input/i });
    await input.fill("Cite some notes from my brain about anything");
    await page.getByRole("button", { name: /^send$/i }).click();

    // User bubble appears
    await expect(page.getByText("Cite some notes from my brain about anything"))
      .toBeVisible();

    // Skill badge appears (cite-everything matches by "cite" and "notes")
    await expect(page.locator("text=/Loaded skill:.*cite-everything/"))
      .toBeVisible({ timeout: 30000 });

    // Wait for streaming to complete — assistant message visible
    await expect(page.locator("[role=log] >> text=AI").first())
      .toBeVisible({ timeout: 60000 });
  });

  test("can switch model mode", async ({ page }) => {
    await page.goto("/brain/chat");
    const toggle = page.getByRole("button", { name: /AI mode/i });
    await expect(toggle).toBeVisible();
    const before = await toggle.textContent();
    await toggle.click();
    const after = await toggle.textContent();
    expect(after).not.toBe(before);
  });
});
```

- [ ] **Step 3: Run the test**

Start backend + frontend (two terminals), then:
```bash
cd frontend && npx playwright test e2e/agent-chat.spec.ts -v
```
Expected: both tests pass. If auth fixtures need wiring, the test scaffolds the assertions correctly — adapt the auth approach to match other passing specs in `e2e/`.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/agent-chat.spec.ts
git commit -m "test(e2e): smoke test for streaming agent chat + mode toggle"
```

---

### Task 25: Android WebView validation

**Files:**
- None to create. This is a manual validation step.

- [ ] **Step 1: Start backend + frontend on the laptop**

In the project root:
```bash
cd backend && source .venv/bin/activate && uvicorn main:app --host 0.0.0.0 --reload &
cd frontend && npm run dev -- --hostname 0.0.0.0
```

- [ ] **Step 2: Open on Android**

On the Android tablet:
- **If the Phase 4 WebView is in place** (`NoteEditorActivity.kt` exists and loads `assets/editor/index.html`): point its base URL at `http://<laptop-ip>:3000/brain/chat` for this validation.
- **Otherwise** (Phase 4 still in progress): open Chrome on the tablet and navigate to `http://<laptop-ip>:3000/brain/chat`. The PWA installation prompt should work too.

Both routes use the same web app — Phase 1 validation only needs to confirm streaming and the mode toggle work over the LAN connection.

- [ ] **Step 3: Verify streaming works**

Type a query into the chat input. Observe:
- Tokens stream in (not buffered until complete)
- Skill badge appears when applicable
- Tool events appear and are tappable (expand args/result)
- Mode toggle pill is tap-able and switches Local ↔ API

- [ ] **Step 4: Verify local_only honored**

Mark a note as `local_only` via the badge in NoteProperties. Switch to API mode. Ask: "What does my note X say?" — agent should respond with a `tool_denied` event saying the note is local_only.

- [ ] **Step 5: Document outcome**

Append a short note to `STATUS.md` under "Phase Tracker" listing the AI Substrate Phase 1 state ("Complete" with date).

- [ ] **Step 6: Final commit (status update only)**

```bash
git add STATUS.md
git commit -m "docs: AI Substrate Phase 1 complete"
```

---

## Self-Review Notes

After writing this plan, I cross-checked the spec section-by-section:

| Spec section | Plan task(s) |
|---|---|
| D1 — three surfaces | Task 21–22 (chat surface; ⌘K + inline are Phase 2) |
| D2 — L4 reach | Tasks 5, 6 (brain tools); MCP client is Phase 3 |
| D3 — composable skills | Tasks 3, 9 |
| D4 — rendering | Tasks 14–15 (chat); BlockNote xl-ai is Phase 2 |
| D5 — local/api toggle | Tasks 7, 18 |
| D6 — three tiers | Task 4 (gate) + Task 8 (local_only column) |
| D7 — streaming everywhere | Tasks 10, 11, 21 (chat); ingest is Phase 3 |
| D8 — persistence (threads + history) | Tasks 11, 16, 20 |
| D9 — web + Android parallel | Task 25 |
| D10 — replacements | Tasks 12, 22 (chat replaced); ingest is Phase 3 |
| §3.5 tool matrix | Tasks 5, 6 |
| §5 data model | Task 8 |

Replacements honored:
- `prompts/tutor.py` → deleted (Task 12), replaced by `cite-everything.md` + base persona
- `prompts/mastery_guide.py` → kept; replaced in Phase 3 when ingest goes agentic
- `routers/chat.py` → deleted (Task 12)
- Hand-rolled `MessageBubble.tsx` parser → deleted (Task 22)

Out-of-scope tasks correctly deferred: inline `/ai`, ⌘K, ingest, MCP, skills UI.
