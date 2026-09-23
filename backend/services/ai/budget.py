"""A spending ceiling for one piece of work.

The run log says what something cost after the fact. A budget is the other
half: it stops the work before the bill arrives. Two shapes, because two things
go wrong:

  pre-flight   — a single huge call. 180,000 characters of sources is a known
                 quantity before anything is sent, so a run that would blow the
                 cap is refused with the number in the message, not attempted.
  running      — an agent turn that keeps calling tools. Each round is cheap;
                 five rounds with a large context are not. The loop checks
                 between rounds and stops with an error event.

Deliberately not a hard kill: nothing here cancels an in-flight HTTP request.
A call already paid for is left to finish, because tearing it down wastes the
spend without saving it.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Iterator


class BudgetExceeded(RuntimeError):
    """Raised by pre-flight checks. The message is user-facing: it names the
    estimate, the cap, and the setting that changes it."""


@dataclass
class Budget:
    max_usd: float | None = None
    spent_usd: float = 0.0
    #: calls whose model had no published price — counted, never priced
    unpriced_calls: int = 0

    def record(self, usd: float | None) -> None:
        if usd is None:
            self.unpriced_calls += 1
        else:
            self.spent_usd += usd

    @property
    def remaining_usd(self) -> float | None:
        if self.max_usd is None:
            return None
        return max(self.max_usd - self.spent_usd, 0.0)

    @property
    def exceeded(self) -> bool:
        return self.max_usd is not None and self.spent_usd >= self.max_usd

    def would_exceed(self, estimated_usd: float | None) -> bool:
        """An unpriced model can never trip the cap — refusing work because a
        price list is incomplete would be the wrong failure."""
        if self.max_usd is None or estimated_usd is None:
            return False
        return self.spent_usd + estimated_usd > self.max_usd


_budget: ContextVar[Budget | None] = ContextVar("ai_budget", default=None)


@contextmanager
def limit(max_usd: float | None) -> Iterator[Budget]:
    """Cap everything inside this block. Nests: an inner block gets its own
    ceiling, and its spend is also charged to the outer one."""
    outer = _budget.get()
    budget = Budget(max_usd=max_usd)
    token = _budget.set(budget)
    try:
        yield budget
    finally:
        _budget.reset(token)
        if outer is not None:
            outer.spent_usd += budget.spent_usd
            outer.unpriced_calls += budget.unpriced_calls


def current() -> Budget | None:
    return _budget.get()


def record(usd: float | None) -> None:
    """Called by usage.track once a call's cost is known."""
    budget = _budget.get()
    if budget is not None:
        budget.record(usd)


def check(estimated_usd: float | None, what: str = "This run",
          setting: str = "MAX_USD_PER_RUN") -> None:
    """Refuse work that would exceed the ceiling, before it is sent."""
    budget = _budget.get()
    if budget is None or not budget.would_exceed(estimated_usd):
        return
    raise BudgetExceeded(
        f"{what} would cost about ${estimated_usd:.2f}, over the "
        f"${budget.max_usd:.2f} limit"
        + (f" (${budget.spent_usd:.2f} already spent here)"
           if budget.spent_usd else "")
        + f". Raise {setting} or use fewer sources."
    )
