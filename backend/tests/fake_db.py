"""A small in-memory stand-in for the Supabase client, for state-machine tests.

MagicMock chains prove that a call was made; they cannot prove that a guarded
UPDATE hands a job to exactly one caller. This keeps real rows, so a test can
run the worker twice and count what happened.
"""
from __future__ import annotations

import copy
import itertools
import uuid
from types import SimpleNamespace


class FakeDB:
    #: column defaults the real tables have, applied on insert
    DEFAULTS = {"ai_jobs": {"status": "queued", "attempts": 0, "ran_late": False,
                            "focus": "", "trigger": "run_later", "price_mode": "normal",
                            "provider_batch_id": None, "started_at": None,
                            "source_ids": [], "result_meta": {}}}

    def __init__(self, **tables: list[dict]):
        self.tables = {k: [copy.deepcopy(r) for r in v] for k, v in tables.items()}

    def table(self, name: str) -> "Query":
        return Query(self.tables.setdefault(name, []), self.DEFAULTS.get(name, {}))


class Query:
    def __init__(self, rows: list[dict], defaults: dict | None = None):
        self._rows = rows
        self._defaults = defaults or {}
        self._filters = []
        self._op = "select"
        self._payload = None
        self._order = None
        self._limit = None
        self._range = None

    def select(self, *_):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def update(self, payload):
        self._op, self._payload = "update", payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, col, val):
        self._filters.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        self._filters.append(lambda r: r.get(col) in vals)
        return self

    @property
    def not_(self):
        outer = self

        class _Not:
            def is_(self, col, val):
                want_null = val == "null"
                outer._filters.append(lambda r: (r.get(col) is None) != want_null)
                return outer

            def in_(self, col, vals):
                outer._filters.append(lambda r: r.get(col) not in vals)
                return outer
        return _Not()

    def gte(self, col, val):
        self._filters.append(lambda r: r.get(col) is not None and r.get(col) >= val)
        return self

    def like(self, col, pattern):
        prefix = pattern.rstrip("%")
        self._filters.append(lambda r: str(r.get(col) or "").startswith(prefix))
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def lte(self, col, val):
        self._filters.append(lambda r: r.get(col) is not None and r.get(col) <= val)
        return self

    def is_(self, col, val):
        want_null = val == "null"
        self._filters.append(lambda r: (r.get(col) is None) == want_null)
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def _matching(self):
        return [r for r in self._rows if all(f(r) for f in self._filters)]

    def execute(self):
        if self._op == "insert":
            row = {"id": str(uuid.uuid4()), **copy.deepcopy(self._defaults),
                   **copy.deepcopy(self._payload)}
            self._rows.append(row)
            return SimpleNamespace(data=[copy.deepcopy(row)])
        hit = self._matching()
        if self._op == "update":
            for r in hit:
                r.update(copy.deepcopy(self._payload))
            return SimpleNamespace(data=[copy.deepcopy(r) for r in hit])
        if self._op == "delete":
            for r in hit:
                self._rows.remove(r)
            return SimpleNamespace(data=[copy.deepcopy(r) for r in hit])
        if self._order:
            col, desc = self._order
            hit = sorted(hit, key=lambda r: r.get(col) or "", reverse=desc)
        if self._range is not None:
            hit = hit[self._range[0]: self._range[1] + 1]
        if self._limit is not None:
            hit = hit[: self._limit]
        return SimpleNamespace(data=[copy.deepcopy(r) for r in hit])
