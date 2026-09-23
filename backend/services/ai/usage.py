"""The run log: what every model call cost, written from one place.

Three pieces:

  annotate(...)   callers say what a call is FOR (surface, job, note, trigger).
                  A context manager, so nested calls inherit and restore.
  report(...)     the client says what the provider actually charged, when the
                  provider tells us. Estimates are marked as estimates.
  track(...)      wraps one call: times it, collects the two above, prices it,
                  and writes one `ai_runs` row.

Design rules learned the hard way:
  - Telemetry never breaks a user-facing call. Every failure here is swallowed
    and logged once.
  - A missing `ai_runs` table (migration 020 not applied yet) is not an error
    worth shouting about on every request — it logs once and the app runs on.
  - Reported usage and estimated usage are different things and the row says
    which it is. Averaging the two would be a measurement of nothing.
"""
from __future__ import annotations

import logging
import time
import uuid as _uuid
from contextlib import contextmanager
from collections import deque
from contextvars import ContextVar
from dataclasses import asdict, dataclass, field
from typing import Any, Iterator

from services.ai import budget as budget_guard
from services.ai.pricing import estimate_usd, tokens_from_chars

logger = logging.getLogger(__name__)


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    #: the provider told us these numbers (as opposed to us estimating them)
    reported: bool = False
    #: numbers are present at all — reported or estimated
    filled: bool = False

    def add(self, **counts: int) -> None:
        for name, value in counts.items():
            if value and hasattr(self, name):
                setattr(self, name, getattr(self, name) + int(value))
        self.reported = True
        self.filled = True

    def set_estimate(self, input_tokens: int, output_tokens: int) -> None:
        """Last resort for providers that report nothing. Leaves `reported`
        False so the row, and any comparison built on it, stays honest."""
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.filled = True


@dataclass
class RunContext:
    """What a call is for. Set by callers, inherited by nested calls."""
    surface: str | None = None       # workspace | chat | ingest | inline | agent | eval
    job: str | None = None           # summarize_text | chat | formula_ocr | ...
    skill: str | None = None
    trigger: str | None = None       # user | auto | automation | eval
    note_id: str | None = None
    user_id: str | None = None
    eval_case: str | None = None
    eval_config: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


_context: ContextVar[RunContext] = ContextVar("ai_run_context", default=RunContext())
_usage: ContextVar[Usage | None] = ContextVar("ai_usage", default=None)

_missing_table_warned = False
_seen_write_errors: set[str] = set()

#: The last rows written, in this process. The eval runner reads its numbers
#: from here so measuring works before migration 020 is applied — and it is a
#: useful thing to dump when debugging a run that cost more than it should.
RECENT: deque[dict] = deque(maxlen=200)


@contextmanager
def annotate(**fields: Any) -> Iterator[RunContext]:
    """Describe the calls made inside this block.

    Fields not given are inherited from the enclosing annotate(), so a router
    that knows the job can nest inside a service that knows the note.
    """
    current = _context.get()
    merged = RunContext(**{**asdict(current), **{k: v for k, v in fields.items()
                                                 if v is not None}})
    token = _context.set(merged)
    try:
        yield merged
    finally:
        _context.reset(token)


def report(**counts: int) -> None:
    """Called by the client when a provider reports real token usage."""
    usage = _usage.get()
    if usage is not None:
        usage.add(**counts)


def report_openai_usage(data: dict) -> None:
    """Pull usage off an OpenAI-compatible stream chunk.

    Lives here rather than in the client because the agent engine streams its
    own HTTP (it needs tool_calls, which the client does not carry yet) and
    both paths must produce identical rows.
    """
    u = data.get("usage") or {}
    if not u:
        return
    details = u.get("prompt_tokens_details") or {}
    report(input_tokens=u.get("prompt_tokens") or 0,
           output_tokens=u.get("completion_tokens") or 0,
           cache_read_tokens=details.get("cached_tokens") or 0)


@contextmanager
def track(provider: str | None, model: str | None,
          estimate_chars: tuple[int, int] | None = None) -> Iterator[Usage]:
    """Wrap one model call and write its `ai_runs` row.

    `estimate_chars` is (prompt_chars, 0) — the fallback used when a provider
    reports no usage, so a run is never missing from the log entirely. Rows
    filled this way carry usage_reported = false.
    """
    usage = Usage()
    token = _usage.set(usage)
    started = time.monotonic()
    status, error = "ok", None
    try:
        yield usage
    except Exception as e:                      # noqa: BLE001 — re-raised below
        status, error = "error", f"{type(e).__name__}: {e}"[:500]
        raise
    finally:
        _usage.reset(token)
        latency_ms = int((time.monotonic() - started) * 1000)
        if not usage.filled and estimate_chars:
            prompt_chars, output_chars = estimate_chars
            usage.set_estimate(tokens_from_chars(prompt_chars),
                               tokens_from_chars(output_chars))
        _write_row(provider, model, usage, latency_ms, status, error)


def _as_uuid(value: str | None) -> str | None:
    """`user_id` and `note_id` are uuid columns. A caller that passes something
    else — the eval runner passed the literal "eval" — makes Postgres reject
    the whole row with an error that never mentions ai_runs, which is how an
    entire day of eval runs went unlogged without a word of complaint."""
    if not value:
        return None
    try:
        return str(_uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        return None


def _write_row(provider: str | None, model: str | None, usage: Usage,
               latency_ms: int, status: str, error: str | None) -> None:
    global _missing_table_warned
    ctx = _context.get()
    row = {
        "user_id": _as_uuid(ctx.user_id),
        "surface": ctx.surface,
        "job": ctx.job,
        "skill": ctx.skill,
        "trigger": ctx.trigger,
        "note_id": _as_uuid(ctx.note_id),
        "provider": provider,
        "model": model,
        "status": status,
        "error": error,
        "latency_ms": latency_ms,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "cache_read_tokens": usage.cache_read_tokens,
        "cache_write_tokens": usage.cache_write_tokens,
        "estimated_usd": estimate_usd(model, usage.input_tokens,
                                      usage.output_tokens,
                                      usage.cache_read_tokens),
        "usage_reported": usage.reported,
        "eval_case": ctx.eval_case,
        "eval_config": ctx.eval_config,
    }
    # Charge the active budget before anything can fail: a call that happened
    # counts whether or not its row reaches the database.
    budget_guard.record(row["estimated_usd"])
    RECENT.append(row)
    try:
        from services.database import get_supabase
        get_supabase().table("ai_runs").insert(row).execute()
    except Exception as e:                      # noqa: BLE001
        message = str(e)
        if "ai_runs" in message and not _missing_table_warned:
            _missing_table_warned = True
            logger.warning(
                "ai_runs not written (%s). Apply supabase/migrations/020_ai_runs.sql "
                "to start measuring; the app works without it.", message[:200])
        elif message[:80] not in _seen_write_errors:
            # Warn once per distinct failure, not debug. Silent telemetry is
            # how a whole day of runs went missing: the row was rejected, the
            # log said nothing, and the scoreboard looked merely empty.
            _seen_write_errors.add(message[:80])
            logger.warning("ai_runs insert failed: %s", message[:200])
